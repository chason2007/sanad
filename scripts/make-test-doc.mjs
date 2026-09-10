import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { writeFileSync } from 'node:fs';

const doc = await PDFDocument.create();
const page = doc.addPage([595, 842]);
const bold = await doc.embedFont(StandardFonts.HelveticaBold);
const reg = await doc.embedFont(StandardFonts.Helvetica);

const T = (t, x, y, size = 11, f = reg, c = rgb(0.1,0.1,0.1)) =>
  page.drawText(t, { x, y, size, font: f, color: c });

page.drawRectangle({ x: 40, y: 640, width: 515, height: 150, borderColor: rgb(0.2,0.3,0.5), borderWidth: 2 });
T('GOVERNMENT OF DUBAI', 60, 755, 13, bold);
T('Department of Economy and Tourism', 60, 736, 10);
T('TRADE LICENCE', 60, 700, 20, bold);
T('Commercial', 60, 676, 10);

T('Licence Number', 60, 600, 9, bold);
T('CN-1099234', 60, 583, 12);

T('Company Name', 60, 545, 9, bold);
T('Al Noor Contracting LLC', 60, 528, 12);

// The classic trap: issue and expiry stacked in the same block,
// same typeface, bilingual labels.
T('Issue Date', 60, 470, 9, bold);
T('15/03/2024', 60, 453, 12);
T('Expiry Date', 260, 470, 9, bold);
T('14/03/2027', 260, 453, 12);

T('Legal Form', 60, 400, 9, bold);
T('Limited Liability Company', 60, 383, 11);

T('Registered Address', 60, 345, 9, bold);
T('Warehouse 4, JAFZA, Dubai, UAE', 60, 328, 11);

T('This licence is valid until the expiry date shown above.', 60, 180, 9, reg, rgb(0.4,0.4,0.4));

writeFileSync('trade-licence-test.pdf', await doc.save());
console.log('wrote trade-licence-test.pdf');
