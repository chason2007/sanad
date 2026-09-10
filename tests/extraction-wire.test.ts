import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';

/**
 * Wire-level extraction tests.
 *
 * These run the REAL Anthropic SDK against a local server standing in for
 * api.anthropic.com, so everything except Anthropic's own inference is
 * exercised for free: request construction, base64 document encoding, the
 * structured-output schema, response parsing, our sanity checks, and every
 * failure path.
 *
 * That leaves exactly one thing unverified - whether the model reads the
 * right date off a real scan - instead of leaving the whole pipeline
 * unverified. It also means a change that breaks the request shape fails
 * here rather than in production at 07:00 Dubai time.
 */

let server: Server;
let port: number;
let lastRequest: any = null;
let nextResponse: { status: number; body: unknown } = { status: 200, body: {} };

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      lastRequest = {
        method: req.method,
        url: req.url,
        headers: req.headers,
        body: raw ? JSON.parse(raw) : null,
      };
      res.writeHead(nextResponse.status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(nextResponse.body));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as any).port;

  process.env.ANTHROPIC_API_KEY = 'sk-ant-test-not-a-real-key';
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${port}`;
  process.env.ANTHROPIC_EXTRACTION_MODEL = 'claude-sonnet-5';
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

/** A Messages API response carrying the model's JSON answer. */
function modelSays(fields: Record<string, unknown>) {
  return {
    status: 200,
    body: {
      id: 'msg_test',
      type: 'message',
      role: 'assistant',
      model: 'claude-sonnet-5',
      content: [{ type: 'text', text: JSON.stringify(fields) }],
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: 2431, output_tokens: 118 },
    },
  };
}

const GOOD = {
  document_type_code: 'trade_licence',
  document_number: 'CN-1099234',
  holder_name: 'Al Noor Contracting LLC',
  issue_date: '2024-03-15',
  expiry_date: '2027-03-14',
  confidence: 0.94,
  reasoning: 'Read the field labelled Expiry Date, which is the later of the two dates.',
};

const TYPES = [
  { code: 'trade_licence', label: 'Trade Licence' },
  { code: 'employee_visa', label: 'Employee Residence Visa' },
  { code: 'emirates_id', label: 'Emirates ID' },
];

async function run(file = 'trade-licence-test.pdf', mediaType = 'application/pdf') {
  const { extractDocumentFields } = await import('@/lib/extraction/extract');
  return extractDocumentFields({
    data: readFileSync(file),
    mediaType,
    documentTypes: TYPES,
  });
}

describe('the request we actually put on the wire', () => {
  it('sends the PDF as a base64 document block', async () => {
    nextResponse = modelSays(GOOD);
    await run();

    const content = lastRequest.body.messages[0].content;
    const doc = content.find((b: any) => b.type === 'document');
    expect(doc).toBeTruthy();
    expect(doc.source.type).toBe('base64');
    expect(doc.source.media_type).toBe('application/pdf');
    // Round-trips to the real file bytes, not a truncated or re-encoded copy.
    expect(Buffer.from(doc.source.data, 'base64').subarray(0, 5).toString()).toBe('%PDF-');
    expect(Buffer.from(doc.source.data, 'base64').length)
      .toBe(readFileSync('trade-licence-test.pdf').length);
  });

  it('sends an image as an image block with the right media type', async () => {
    nextResponse = modelSays(GOOD);
    const { extractDocumentFields } = await import('@/lib/extraction/extract');
    await extractDocumentFields({
      data: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
      mediaType: 'image/png',
      documentTypes: TYPES,
    });

    const block = lastRequest.body.messages[0].content.find((b: any) => b.type === 'image');
    expect(block.source.media_type).toBe('image/png');
  });

  it('puts the document before the instruction', async () => {
    nextResponse = modelSays(GOOD);
    await run();
    const content = lastRequest.body.messages[0].content;
    expect(content[0].type).toBe('document');
    expect(content[1].type).toBe('text');
  });

  it('uses the configured model', async () => {
    nextResponse = modelSays(GOOD);
    await run();
    expect(lastRequest.body.model).toBe('claude-sonnet-5');
  });

  it('passes every valid document code into the system prompt', async () => {
    nextResponse = modelSays(GOOD);
    await run();
    const system = JSON.stringify(lastRequest.body.system);
    for (const t of TYPES) expect(system).toContain(t.code);
    expect(system).toContain('unknown');
  });

  it('carries the bilingual and date-order instructions', async () => {
    nextResponse = modelSays(GOOD);
    await run();
    const system = JSON.stringify(lastRequest.body.system);
    expect(system).toContain('LATER of the two dates');
    expect(system).toContain('day-first');
    expect(system).toMatch(/\\u0627\\u0644\\u0627\\u0646\\u062a\\u0647\\u0627\\u0621|تاريخ/); // Arabic expiry label
  });

  it('constrains the output with a strict JSON schema', async () => {
    nextResponse = modelSays(GOOD);
    await run();

    const format = lastRequest.body.output_config?.format;
    expect(format?.type).toBe('json_schema');
    expect(format.schema.additionalProperties).toBe(false);
    for (const field of ['document_type_code', 'expiry_date', 'issue_date', 'confidence']) {
      expect(format.schema.required).toContain(field);
    }
  });

  it('authenticates with the api key header', async () => {
    nextResponse = modelSays(GOOD);
    await run();
    expect(lastRequest.headers['x-api-key']).toBe('sk-ant-test-not-a-real-key');
    expect(lastRequest.url).toContain('/v1/messages');
  });
});

describe('handling the response', () => {
  it('parses a clean read and keeps the confidence', async () => {
    nextResponse = modelSays(GOOD);
    const out = await run();

    expect(out.status).toBe('succeeded');
    expect(out.payload?.expiry_date).toBe('2027-03-14');
    expect(out.payload?.issue_date).toBe('2024-03-15');
    expect(out.confidence).toBe(0.94);
    expect(out.warnings).toEqual([]);
  });

  it('catches a swapped issue/expiry pair even at high confidence', async () => {
    // The failure the whole prompt is written to avoid, arriving anyway.
    nextResponse = modelSays({ ...GOOD, issue_date: '2027-03-14', expiry_date: '2024-03-15', confidence: 0.97 });
    const out = await run();

    expect(out.status).toBe('needs_review');
    expect(out.confidence).toBeLessThanOrEqual(0.3);
    expect(out.warnings.join(' ')).toMatch(/swapped/i);
  });

  it('sends a low-confidence read to review', async () => {
    nextResponse = modelSays({ ...GOOD, confidence: 0.55 });
    const out = await run();
    expect(out.status).toBe('needs_review');
  });

  it('flags an unknown document type', async () => {
    nextResponse = modelSays({ ...GOOD, document_type_code: 'unknown' });
    const out = await run();
    expect(out.status).toBe('needs_review');
  });

  it('records token usage for cost tracking', async () => {
    nextResponse = modelSays(GOOD);
    const out = await run();
    expect((out.raw as any).usage.input_tokens).toBe(2431);
  });
});

describe('failure never blocks the upload', () => {
  it('survives a rate limit', async () => {
    nextResponse = { status: 429, body: { type: 'error', error: { type: 'rate_limit_error', message: 'slow down' } } };
    const out = await run();
    expect(out.status).toBe('failed');
    expect(out.error).toMatch(/429|rate/i);
    expect(out.payload).toBeNull();
  });

  it('survives a server error', async () => {
    nextResponse = { status: 500, body: { type: 'error', error: { type: 'api_error', message: 'boom' } } };
    const out = await run();
    expect(out.status).toBe('failed');
  });

  it('survives an unparseable response', async () => {
    nextResponse = { status: 200, body: { id: 'x', type: 'message', role: 'assistant', content: [{ type: 'text', text: 'sorry, I cannot read this' }], stop_reason: 'end_turn', usage: {} } };
    const out = await run();
    expect(out.status).toBe('failed');
    expect(out.payload).toBeNull();
  });

  it('refuses an unsupported file type without calling the API', async () => {
    const { extractDocumentFields } = await import('@/lib/extraction/extract');
    lastRequest = null;
    const out = await extractDocumentFields({
      data: Buffer.from('x'), mediaType: 'application/msword', documentTypes: TYPES,
    });
    expect(out.status).toBe('failed');
    expect(lastRequest).toBeNull(); // no request was made, so no money spent
  });
});
