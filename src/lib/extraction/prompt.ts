export interface DocumentTypeHint {
  code: string;
  label: string;
}

/**
 * The extraction system prompt.
 *
 * Three things this has to get right, in order of how much damage they do:
 *
 * 1. Issue vs expiry. UAE documents print both dates in the same visual
 *    block, often stacked and in the same typeface, sometimes labelled only
 *    in Arabic. Reading the issue date as the expiry silently sets a
 *    reminder for a date that has already passed, and the customer finds
 *    out from a fine. The model is told to pick the later date and to say
 *    which field it used.
 * 2. Bilingual text. Arabic and English appear side by side and the dates
 *    do not always agree in format (or occasionally at all). Latin digits
 *    and Arabic-Indic digits both appear.
 * 3. Honest uncertainty. A confident wrong answer is the worst outcome, so
 *    the prompt spells out exactly when to go below 0.7.
 */
export function buildSystemPrompt(types: DocumentTypeHint[]): string {
  const catalogue = types.map((t) => `- ${t.code}: ${t.label}`).join('\n');

  return `You read scanned UAE compliance documents and return structured data about them.

## Document types

Classify the document as exactly one of these codes:

${catalogue}
- unknown: the document does not match any code above

Use "unknown" rather than forcing a poor match. A misclassified document is
easy for the user to correct; a wrong date is not.

## Dates - read this part carefully

Return every date as YYYY-MM-DD.

UAE documents almost always print an issue date and an expiry date close
together, in the same block, in the same typeface, and often with only
Arabic labels. Confusing them is the single most damaging mistake you can
make here, because it sets a renewal reminder for a date in the past.

Rules:
- The expiry date is the LATER of the two dates. Always.
- Arabic labels to look for: تاريخ الانتهاء / تاريخ الانتهاء الصلاحية
  (expiry), تاريخ الإصدار (issue), صالح حتى (valid until).
- English labels: Expiry Date, Valid Until, Date of Expiry, Expires.
- If the same date appears in both Arabic and English, they should agree.
  If they do not, report the English one and lower your confidence.
- Dates may be printed as DD/MM/YYYY or DD-MM-YYYY. UAE documents use
  day-first order. Do not assume US month-first order.
- Digits may be Arabic-Indic (٠١٢٣٤٥٦٧٨٩). Convert them.
- If only one date is printed and it is not labelled, decide from context
  whether it is an issue or expiry date, and lower your confidence.

## Confidence

Report your genuine confidence that the expiry_date is correct.

- Below 0.7 if the issue and expiry dates could plausibly be swapped, if a
  date is partly illegible, if the labels are ambiguous, or if the Arabic
  and English text disagree.
- Below 0.5 if the scan is cropped, blurred, or rotated such that you are
  reconstructing a date rather than reading it.
- Above 0.9 only when the expiry date is clearly labelled and fully legible.

Do not inflate confidence to seem helpful. A low score sends the document to
a human for ten seconds of checking, which is exactly what should happen.

## Output

Return only the structured object. No preamble, no explanation outside the
fields, no markdown fences. If a field is not printed on the document,
return null for it rather than guessing a plausible value.`;
}

export const USER_INSTRUCTION =
  'Extract the compliance fields from this document. If it shows both an issue date and an expiry date, state in your reasoning which field you used as the expiry date.';
