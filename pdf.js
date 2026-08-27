const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN = 46;

function stripPrefix(b64) {
  const s = String(b64 || '');
  const comma = s.indexOf(',');
  return comma >= 0 ? s.slice(comma + 1) : s;
}

function fmtDate(v) {
  if (!v) return '';
  const s = String(v);
  const d = s.indexOf('T') >= 0 ? s.slice(0, 10) : s;
  const parts = d.split('-');
  if (parts.length === 3) return parts[2] + '.' + parts[1] + '.' + parts[0];
  return d;
}

function fmtAmount(v) {
  if (v == null || v === '') return '';
  const n = Number(v);
  if (isNaN(n)) return String(v);
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function sumLines(lines, key) {
  let t = 0;
  (lines || []).forEach(function (l) {
    const n = Number(l[key]);
    if (!isNaN(n)) t += n;
  });
  return t;
}

// Draw a label/value row. Returns the new y (bottom of the row).
function drawField(page, font, label, value, x, y, colW) {
  const gray = rgb(0.42, 0.42, 0.42);
  const dark = rgb(0.07, 0.07, 0.07);
  page.drawText(String(label).toUpperCase(), { x: x, y: y, size: 7, font: font, color: gray });
  page.drawText(value == null || value === '' ? '\u2014' : String(value), {
    x: x, y: y - 11, size: 9.5, font: font, color: dark
  });
  return y - 27;
}

// Draw the lines table and totals. Returns the new y.
function drawLines(page, font, bold, lines, y) {
  const dark = rgb(0.07, 0.07, 0.07);
  const gray = rgb(0.45, 0.45, 0.45);
  const border = rgb(0.82, 0.82, 0.82);

  const col0 = 10, col1 = 90, col2 = 130, col3 = 340, col4 = 425, col5 = 468, col6 = 512, col7 = 560;

  y -= 8;
  page.drawText('LINE', { x: col0, y: y, size: 7, font: bold, color: gray });
  page.drawText('ACCOUNT NO.', { x: col1, y: y, size: 7, font: bold, color: gray });
  page.drawText('DESCRIPTION', { x: col2, y: y, size: 7, font: bold, color: gray });
  page.drawText('POSTING DATE', { x: col3, y: y, size: 7, font: bold, color: gray });
  page.drawText('CURRENCY', { x: col4, y: y, size: 7, font: bold, color: gray });
  page.drawText('EXPECTED USD', { x: col5, y: y, size: 7, font: bold, color: gray });
  page.drawText('ACTUAL USD', { x: col6, y: y, size: 7, font: bold, color: gray });
  page.drawText('FX DIFF', { x: col7, y: y, size: 7, font: bold, color: gray });
  y -= 13;

  (lines || []).forEach(function (l) {
    if (y < 90) return;
    page.drawText(String(l.lineNo == null ? '' : l.lineNo), { x: col0, y: y, size: 8, font: font, color: dark });
    page.drawText(String(l.accountNo == null ? '' : l.accountNo), { x: col1, y: y, size: 8, font: font, color: dark });
    let desc = String(l.description == null ? '' : l.description);
    if (desc.length > 42) desc = desc.slice(0, 42) + '\u2026';
    page.drawText(desc, { x: col2, y: y, size: 8, font: font, color: dark });
    page.drawText(fmtDate(l.postingDate), { x: col3, y: y, size: 8, font: font, color: dark });
    page.drawText(String(l.currencyCode || ''), { x: col4, y: y, size: 8, font: font, color: dark });
    page.drawText(fmtAmount(l.expectedUSD), { x: col5, y: y, size: 8, font: font, color: dark });
    page.drawText(fmtAmount(l.actualUSD), { x: col6, y: y, size: 8, font: font, color: dark });
    page.drawText(fmtAmount(l.fxDifference), { x: col7, y: y, size: 8, font: font, color: dark });
    y -= 13;
  });

  // Totals row
  y -= 2;
  page.drawLine({ start: { x: MARGIN + 10, y: y }, end: { x: PAGE_W - MARGIN, y: y }, thickness: 1.2, color: border });
  y -= 12;
  page.drawText('Totals', { x: col2, y: y, size: 8.5, font: bold, color: dark });
  page.drawText(fmtAmount(sumLines(lines, 'expectedUSD')), { x: col5, y: y, size: 8.5, font: bold, color: dark });
  page.drawText(fmtAmount(sumLines(lines, 'actualUSD')), { x: col6, y: y, size: 8.5, font: bold, color: dark });
  page.drawText(fmtAmount(sumLines(lines, 'fxDifference')), { x: col7, y: y, size: 8.5, font: bold, color: dark });

  return y - 16;
}

// Build a signed PDF (base64) of the treasury report with the signature embedded.
async function buildSignedPdf(rec, signatureImageBase64) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([PAGE_W, PAGE_H]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const dark = rgb(0.07, 0.07, 0.07);
  const gray = rgb(0.42, 0.42, 0.42);
  const border = rgb(0.82, 0.82, 0.82);

  let y = PAGE_H - MARGIN;

  // Title
  const title = 'TREASURY TRANSACTION';
  const titleW = bold.widthOfTextAtSize(title, 16);
  page.drawText(title, { x: (PAGE_W - titleW) / 2, y: y, size: 16, font: bold, color: dark });
  y -= 24;
  page.drawLine({ start: { x: MARGIN, y: y }, end: { x: PAGE_W - MARGIN, y: y }, thickness: 1.4, color: dark });
  y -= 24;

  // Meta fields (2 columns)
  const colL = MARGIN;
  const colR = MARGIN + (PAGE_W - 2 * MARGIN) / 2 + 8;
  const colW = (PAGE_W - 2 * MARGIN) / 2 - 8;

  y = drawField(page, font, 'Document No.', rec.documentNo, colL, y, colW);
  y = drawField(page, font, 'Transaction Type', rec.transactionType, colR, y, colW);
  y = drawField(page, font, 'Document Type', rec.documentType, colL, y, colW);
  y = drawField(page, font, 'Posting Date', fmtDate(rec.postingDate), colR, y, colW);
  y = drawField(page, font, 'Vendor', rec.vendorName, colL, y, colW);
  y = drawField(page, font, 'Customer', rec.customerName, colR, y, colW);
  y = drawField(page, font, 'Primary Contact', rec.primaryContactCode, colL, y, colW);
  y = drawField(page, font, 'Account No.', rec.accountNo, colR, y, colW);
  y = drawField(page, font, 'Account Type', rec.accountType, colL, y, colW);
  y = drawField(page, font, 'Bal. Account No.', rec.balAccountNo, colR, y, colW);
  y = drawField(page, font, 'Currency', rec.currencyCode, colL, y, colW);
  y = drawField(page, font, 'Amount', fmtAmount(rec.amount), colR, y, colW);
  y = drawField(page, font, 'Amount (LCY)', fmtAmount(rec.amountLCY), colL, y, colW);
  y = drawField(page, font, 'Currency Factor', fmtAmount(rec.currencyFactor), colR, y, colW);

  page.drawLine({ start: { x: MARGIN, y: y }, end: { x: PAGE_W - MARGIN, y: y }, thickness: 0.8, color: border });

  y = drawLines(page, font, bold, rec.lines, y);

  // Signature block
  page.drawText('AUTHORIZED SIGNATURE', { x: MARGIN + 10, y: y, size: 10, font: bold, color: dark });
  y -= 4;
  page.drawRectangle({
    x: PAGE_W - MARGIN - 240, y: y - 96, width: 240, height: 96,
    borderColor: dark, borderWidth: 1, color: rgb(1, 1, 1)
  });

  // Embed signature image
  const sigB64 = stripPrefix(signatureImageBase64);
  if (sigB64) {
    let sigImg = null;
    try { sigImg = await doc.embedPng(sigB64); } catch (e1) {
      try { sigImg = await doc.embedJpg(sigB64); } catch (e2) { sigImg = null; }
    }
    if (sigImg) {
      const scaled = sigImg.scaleToFit(220, 74);
      page.drawImage(sigImg, {
        x: PAGE_W - MARGIN - 230, y: y - 88,
        width: scaled.width, height: scaled.height
      });
    } else {
      page.drawText('Signature not embedded', { x: PAGE_W - MARGIN - 180, y: y - 52, size: 9, font: font, color: gray });
    }
  }
  page.drawText('Signature', { x: PAGE_W - MARGIN - 230, y: y - 100, size: 8, font: font, color: gray });

  const bytes = await doc.save();
  return Buffer.from(bytes).toString('base64');
}

module.exports = { buildSignedPdf };
