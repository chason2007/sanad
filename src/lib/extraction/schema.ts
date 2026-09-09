// zod/v4: the SDK's zodOutputFormat helper is built against the v4 API.
import * as z from 'zod/v4';

/**
 * The shape the model must return.
 *
 * Enforced with structured outputs (output_config.format) rather than by
 * asking politely for "JSON only, no markdown fences". The request cannot
 * come back as prose or a fenced block, so the whole class of "strip the
 * ```json wrapper and hope" parsing bugs never arises. The prompt still
 * says it, because belt and braces costs nothing here.
 */
export const ExtractionSchema = z.object({
  document_type_code: z
    .string()
    .describe('One of the provided codes, or "unknown" if it matches none of them.'),
  document_number: z
    .string()
    .nullable()
    .describe('The primary reference number printed on the document, or null.'),
  holder_name: z
    .string()
    .nullable()
    .describe('The person or asset the document belongs to, in Latin script if available.'),
  issue_date: z
    .string()
    .nullable()
    .describe('Issue date as YYYY-MM-DD, or null if not printed.'),
  expiry_date: z
    .string()
    .nullable()
    .describe('Expiry date as YYYY-MM-DD. The LATER of the two dates. Null if not printed.'),
  confidence: z
    .number()
    .describe('0.0 to 1.0. Below 0.7 if the issue and expiry dates could be confused.'),
  reasoning: z
    .string()
    .describe('One sentence: which field you read as the expiry date and why.'),
});

export type ExtractionPayload = z.infer<typeof ExtractionSchema>;

export interface ExtractionOutcome {
  status: 'succeeded' | 'needs_review' | 'failed';
  payload: ExtractionPayload | null;
  /** Confidence after our own sanity checks, which can only lower it. */
  confidence: number;
  /** Human-readable reasons the confidence was reduced. Shown to the user. */
  warnings: string[];
  error: string | null;
  model: string | null;
  raw: unknown;
}

/**
 * A wrong expiry date is worse than no expiry date - the product promise is
 * that the alert fires on the right day. Anything under this goes to the
 * user for confirmation before it can ever drive an alert.
 */
export const REVIEW_THRESHOLD = 0.8;
