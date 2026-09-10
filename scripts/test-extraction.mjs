/**
 * Run one real extraction against a document and grade the result.
 *
 * Usage:  node scripts/test-extraction.mjs [path-to-file]
 *
 * Reads ANTHROPIC_API_KEY from the environment or .env.local. The key is
 * never printed - only whether one was found.
 *
 * Grades the answer against the fixture's known trap: a trade licence with
 * "Issue Date 15/03/2024" and "Expiry Date 14/03/2027" side by side in the
 * same block, same typeface. Reading the issue date as the expiry is the
 * single most damaging mistake this product can make, so that is what the
 * pass/fail below actually measures.
 */
import { readFileSync, existsSync } from 'node:fs';
import { register } from 'node:module';

// Load .env.local without a dependency.
if (existsSync('.env.local')) {
  for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const key = process.env.ANTHROPIC_API_KEY;
if (!key) {
  console.error('ANTHROPIC_API_KEY is not set. Add it to .env.local and re-run.');
  process.exit(1);
}
console.log(`key found (${key.slice(0, 7)}…, ${key.length} chars)`);
console.log(`model: ${process.env.ANTHROPIC_EXTRACTION_MODEL || 'claude-sonnet-5'}\n`);

const file = process.argv[2] || 'trade-licence-test.pdf';
const data = readFileSync(file);
const mediaType = file.endsWith('.pdf') ? 'application/pdf'
  : file.match(/\.(jpe?g)$/i) ? 'image/jpeg'
  : file.match(/\.png$/i) ? 'image/png' : 'application/pdf';

// Import the app's real extraction path, not a reimplementation.
const { extractDocumentFields } = await import('../src/lib/extraction/extract.ts');

const DOCUMENT_TYPES = [
  { code: 'trade_licence', label: 'Trade Licence' },
  { code: 'establishment_card', label: 'Establishment Card (Immigration Card)' },
  { code: 'employee_visa', label: 'Employee Residence Visa' },
  { code: 'emirates_id', label: 'Emirates ID' },
  { code: 'labour_card', label: 'Labour Card / Work Permit' },
  { code: 'medical_insurance', label: 'Medical Insurance' },
  { code: 'ejari', label: 'Ejari Tenancy Contract' },
  { code: 'vehicle_mulkiya', label: 'Vehicle Registration (Mulkiya)' },
  { code: 'civil_defence', label: 'Civil Defence Certificate' },
  { code: 'iso_certificate', label: 'ISO Certificate' },
  { code: 'passport', label: 'Passport' },
  { code: 'vat_registration', label: 'VAT Registration Certificate' },
];

console.log(`reading ${file} (${data.length} bytes)…\n`);
const started = Date.now();
const outcome = await extractDocumentFields({ data, mediaType, documentTypes: DOCUMENT_TYPES });
const ms = Date.now() - started;

if (outcome.error) {
  console.error('FAILED:', outcome.error);
  process.exit(1);
}

const p = outcome.payload;
console.log('--- what the model returned ---');
console.log(JSON.stringify({
  document_type_code: p.document_type_code,
  document_number: p.document_number,
  holder_name: p.holder_name,
  issue_date: p.issue_date,
  expiry_date: p.expiry_date,
  confidence: p.confidence,
  reasoning: p.reasoning,
}, null, 2));

console.log('\n--- after our own sanity checks ---');
console.log(`status:              ${outcome.status}`);
console.log(`confidence:          ${outcome.confidence}  (self-reported ${p.confidence})`);
console.log(`warnings:            ${outcome.warnings.length ? outcome.warnings.join('; ') : 'none'}`);
console.log(`needs_review:        ${outcome.confidence < 0.8}`);
console.log(`latency:             ${ms} ms`);
if (outcome.raw?.usage) {
  console.log(`tokens:              in ${outcome.raw.usage.input_tokens}, out ${outcome.raw.usage.output_tokens}`);
}

// Grade against the fixture's known answer.
if (file.endsWith('trade-licence-test.pdf')) {
  const checks = [
    ['expiry is the LATER date (2027-03-14)', p.expiry_date === '2027-03-14'],
    ['did NOT read the issue date as expiry', p.expiry_date !== '2024-03-15'],
    ['issue date read correctly (2024-03-15)', p.issue_date === '2024-03-15'],
    ['classified as trade_licence', p.document_type_code === 'trade_licence'],
    ['licence number read', p.document_number?.includes('1099234') ?? false],
    ['day-first order, not US month-first', p.expiry_date !== '2027-14-03'],
  ];
  console.log('\n--- graded against the fixture ---');
  let failed = 0;
  for (const [label, ok] of checks) {
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`);
    if (!ok) failed += 1;
  }
  console.log(`\n${failed === 0 ? 'ALL CHECKS PASSED' : `${failed} CHECK(S) FAILED`}`);
  process.exit(failed === 0 ? 0 : 1);
}
