import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { buildSystemPrompt, USER_INSTRUCTION, type DocumentTypeHint } from './prompt';
import { ExtractionSchema, REVIEW_THRESHOLD, type ExtractionOutcome, type ExtractionPayload } from './schema';
import { dubaiToday, isValidIsoDate } from '@/lib/dates';

const DEFAULT_MODEL = 'claude-sonnet-5';

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const;
type ImageMediaType = (typeof IMAGE_TYPES)[number];

function isImageMediaType(value: string): value is ImageMediaType {
  return (IMAGE_TYPES as readonly string[]).includes(value);
}

/**
 * Deterministic checks applied on top of the model's self-reported score.
 *
 * Self-reported confidence is a useful signal but it is not evidence. These
 * checks can only ever LOWER the confidence, never raise it, so a
 * cheerfully wrong 0.95 still gets caught when the dates contradict
 * themselves.
 */
export function sanityCheck(
  payload: ExtractionPayload,
  knownCodes: Set<string>,
  now: Date = new Date(),
): { confidence: number; warnings: string[] } {
  const warnings: string[] = [];
  let confidence = Number.isFinite(payload.confidence)
    ? Math.min(Math.max(payload.confidence, 0), 1)
    : 0;

  const cap = (ceiling: number, warning: string) => {
    warnings.push(warning);
    confidence = Math.min(confidence, ceiling);
  };

  if (!payload.expiry_date) {
    cap(0, 'No expiry date was found on the document.');
    return { confidence, warnings };
  }

  if (!isValidIsoDate(payload.expiry_date)) {
    cap(0, `The expiry date came back unreadable ("${payload.expiry_date}").`);
    return { confidence, warnings };
  }

  if (payload.issue_date && !isValidIsoDate(payload.issue_date)) {
    cap(0.5, 'The issue date came back unreadable.');
  }

  // The exact failure the prompt warns about: the two dates got swapped.
  if (
    payload.issue_date &&
    isValidIsoDate(payload.issue_date) &&
    payload.issue_date >= payload.expiry_date
  ) {
    cap(0.3, 'The issue date is not before the expiry date, so the two may have been swapped.');
  }

  if (!knownCodes.has(payload.document_type_code) && payload.document_type_code !== 'unknown') {
    cap(0.6, `The model returned an unrecognised document type ("${payload.document_type_code}").`);
  }

  if (payload.document_type_code === 'unknown') {
    cap(0.7, 'The document type could not be identified.');
  }

  const today = dubaiToday(now);
  const yearsOut = (Number(payload.expiry_date.slice(0, 4)) - Number(today.slice(0, 4)));

  if (yearsOut > 20) {
    cap(0.4, `The expiry date is ${yearsOut} years away, which is unusual for a UAE document.`);
  }
  if (yearsOut < -10) {
    cap(0.4, 'The expiry date is more than ten years in the past.');
  }

  return { confidence, warnings };
}

/**
 * Run one document through the model.
 *
 * Never throws. A failed extraction returns a `failed` outcome so the upload
 * that triggered it still completes - the user can always type the date in
 * by hand, and an API outage must not stop them recording a document.
 */
export async function extractDocumentFields(params: {
  data: Buffer;
  mediaType: string;
  documentTypes: DocumentTypeHint[];
  now?: Date;
}): Promise<ExtractionOutcome> {
  const model = process.env.ANTHROPIC_EXTRACTION_MODEL || DEFAULT_MODEL;
  const base: ExtractionOutcome = {
    status: 'failed', payload: null, confidence: 0,
    warnings: [], error: null, model, raw: null,
  };

  if (!process.env.ANTHROPIC_API_KEY) {
    return { ...base, error: 'ANTHROPIC_API_KEY is not configured.' };
  }

  const base64 = params.data.toString('base64');
  let contentBlock: Anthropic.ContentBlockParam;

  if (params.mediaType === 'application/pdf') {
    contentBlock = {
      type: 'document',
      source: { type: 'base64', media_type: 'application/pdf', data: base64 },
    };
  } else if (isImageMediaType(params.mediaType)) {
    contentBlock = {
      type: 'image',
      source: { type: 'base64', media_type: params.mediaType, data: base64 },
    };
  } else {
    return { ...base, error: `Sanad cannot read ${params.mediaType} files.` };
  }

  try {
    const client = new Anthropic();

    const response = await client.messages.parse({
      model,
      max_tokens: 4096,
      system: buildSystemPrompt(params.documentTypes),
      messages: [
        {
          role: 'user',
          // Document first, instruction after: the model reads the image in
          // the context of the task rather than the other way round.
          content: [contentBlock, { type: 'text', text: USER_INSTRUCTION }],
        },
      ],
      output_config: { format: zodOutputFormat(ExtractionSchema), effort: 'medium' },
    });

    const payload = response.parsed_output;

    if (!payload) {
      return {
        ...base,
        raw: response,
        error: 'The model did not return a usable result.',
      };
    }

    const knownCodes = new Set(params.documentTypes.map((t) => t.code));
    const { confidence, warnings } = sanityCheck(payload, knownCodes, params.now);

    return {
      status: confidence >= REVIEW_THRESHOLD ? 'succeeded' : 'needs_review',
      payload,
      confidence,
      warnings,
      error: null,
      model,
      raw: response,
    };
  } catch (err) {
    const message =
      err instanceof Anthropic.APIError
        ? `Extraction service error (${err.status}): ${err.message}`
        : (err as Error).message;
    return { ...base, error: message };
  }
}
