const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const fs = require('fs');
const path = require('path');

// Standard A4 dimensions
const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 36;
const W = PAGE_W - 2 * MARGIN;

function stripPrefix(b64) {
  const s = String(b64 || '');
  const comma = s.indexOf(',');
  return comma >= 0 ? s.slice(comma + 1) : s;
}

function fmtDate(v) {
  if (!v) return '\u2014';
  const s = String(v);
  const d = s.indexOf('T') >= 0 ? s.slice(0, 10) : s;
  const parts = d.split('-');
  if (parts.length === 3) return parts[2] + '/' + parts[1] + '/' + parts[0];
  return d;
}

function fmtAmount(v) {
  if (v == null || v === '') return '0,00';
  const n = Number(v);
  if (isNaN(n)) return String(v).replace(/[\u202f\u00a0]/g, ' ');
  return n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
          .replace(/[\u202f\u00a0]/g, ' ');
}

function safeStr(v) {
  if (v == null || v === '') return '';
  return String(v)
    .replace(/[\u202f\u00a0]/g, ' ')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"');
}

function sumLines(lines, key) {
  let total = 0;
  (lines || []).forEach(function (l) {
    const n = Number(l[key]);
    if (!isNaN(n)) total += n;
  });
  return total;
}

// Clean and truncate text to prevent overflow
function fitText(font, text, maxW, size) {
  let s = safeStr(text);
  if (!s) return '\u2014';
  if (font.widthOfTextAtSize(s, size) <= maxW) return s;
  while (s.length > 3 && font.widthOfTextAtSize(s + '\u2026', size) > maxW) {
    s = s.slice(0, -1);
  }
  return s + '\u2026';
}

/**
 * Builds an authentic corporate PDF voucher for S&K Supermarche
 * matching the modern web layout pixel-by-pixel.
 */
async function buildSignedPdf(rec, signatureImageBase64) {
  rec = rec || {};
  const doc = await PDFDocument.create();
  const page = doc.addPage([PAGE_W, PAGE_H]);

  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const italic = await doc.embedFont(StandardFonts.HelveticaOblique);

  // Exact corporate color palette
  const cNavy = rgb(15 / 255, 23 / 255, 42 / 255);        // #0f172a
  const cDark = rgb(30 / 255, 41 / 255, 59 / 255);        // #1e293b
  const cBlue = rgb(29 / 255, 78 / 255, 216 / 255);       // #1d4ed8
  const cAmber = rgb(245 / 255, 158 / 255, 11 / 255);     // #f59e0b
  const cGrayLabel = rgb(100 / 255, 116 / 255, 139 / 255);// #64748b
  const cGrayText = rgb(71 / 255, 85 / 255, 105 / 255);   // #475569
  const cCardBg = rgb(248 / 255, 250 / 255, 252 / 255);   // #f8fafc
  const cCardBorder = rgb(226 / 255, 232 / 255, 240 / 255);// #e2e8f0
  const cGreenBg = rgb(240 / 255, 253 / 255, 244 / 255);  // #f0fdf4
  const cGreenBorder = rgb(187 / 255, 247 / 255, 208 / 255);// #bbf7d0
  const cTableHdrBg = rgb(241 / 255, 245 / 255, 249 / 255);// #f1f5f9
  const cTableBorder = rgb(203 / 255, 213 / 255, 225 / 255);// #cbd5e1
  const cSigBg = rgb(248 / 255, 250 / 255, 255 / 255);    // #f8faff
  const cSigBorder = rgb(29 / 255, 78 / 255, 216 / 255);  // #1d4ed8
  const cSigCanvasBorder = rgb(219 / 255, 234 / 255, 254 / 255);// #dbeafe
  const cWhite = rgb(1, 1, 1);

  let curY = PAGE_H - 24;

  // 1. Top Decorative Brand Stripe
  page.drawRectangle({ x: MARGIN, y: curY - 3, width: W * 0.45, height: 3, color: cBlue });
  page.drawRectangle({ x: MARGIN + W * 0.45, y: curY - 3, width: W * 0.1, height: 3, color: cAmber });
  page.drawRectangle({ x: MARGIN + W * 0.55, y: curY - 3, width: W * 0.45, height: 3, color: cBlue });
  curY -= 14;

  // 2. Corporate Header with S&K Logo & Corporate Identity
  const logoPath = path.join(__dirname, 'public', 'logo.png');
  let logoDrawn = false;
  if (fs.existsSync(logoPath)) {
    try {
      const logoImg = await doc.embedPng(fs.readFileSync(logoPath));
      const scaled = logoImg.scaleToFit(65, 46);
      page.drawImage(logoImg, {
        x: MARGIN,
        y: curY - scaled.height,
        width: scaled.width,
        height: scaled.height
      });
      logoDrawn = true;
    } catch (e) {
      console.warn('[pdf] could not embed logo:', e.message);
    }
  }

  const textX = MARGIN + (logoDrawn ? 74 : 0);
  page.drawText('S&K SUPERMARCHE RDC', {
    x: textX, y: curY - 14, size: 15, font: bold, color: cNavy
  });
  page.drawText('Distribution \u2022 Kinshasa \u2022 Lubumbashi \u2022 Goma \u2022 RDC', {
    x: textX, y: curY - 27, size: 8, font: font, color: cGrayText
  });
  page.drawText('DIRECTION FINANCI\u00c8RE \u2022 D\u00c9PARTEMENT TR\u00c9SORERIE', {
    x: textX, y: curY - 40, size: 8, font: bold, color: cBlue
  });

  curY -= 54;
  page.drawLine({ start: { x: MARGIN, y: curY }, end: { x: MARGIN + W, y: curY }, thickness: 1.5, color: cNavy });
  curY -= 20;

  // 3. Document Title & Badge Row
  page.drawText('BON DE PAIEMENT / TREASURY TRANSACTION', {
    x: MARGIN, y: curY - 12, size: 12.5, font: bold, color: cDark
  });

  const badgeText = 'DOC: ' + (rec.documentNo || '\u2014');
  const badgeW = bold.widthOfTextAtSize(badgeText, 8.5) + 16;
  const badgeH = 18;
  const badgeX = MARGIN + W - badgeW;
  const badgeY = curY - 16;
  page.drawRectangle({
    x: badgeX, y: badgeY, width: badgeW, height: badgeH,
    color: cTableHdrBg, borderColor: cTableBorder, borderWidth: 1
  });
  page.drawText(badgeText, {
    x: badgeX + 8, y: badgeY + 5, size: 8.5, font: bold, color: cNavy
  });
  curY -= 28;

  // 4. Document Metadata Grid (Card 1)
  const metaH = 40;
  const metaY = curY - metaH;
  page.drawRectangle({
    x: MARGIN, y: metaY, width: W, height: metaH,
    color: cCardBg, borderColor: cCardBorder, borderWidth: 1
  });
  const colW4 = W / 4;
  const drawCol = (colIdx, label, val) => {
    const cx = MARGIN + colIdx * colW4 + 10;
    const maxValW = colW4 - 16;
    page.drawText(label, { x: cx, y: metaY + 26, size: 6.5, font: bold, color: cGrayLabel });
    page.drawText(fitText(bold, val, maxValW, 9), { x: cx, y: metaY + 10, size: 9, font: bold, color: cNavy });
  };
  drawCol(0, 'N\u00b0 DOCUMENT / DOC NO.', rec.documentNo || '\u2014');
  drawCol(1, 'TYPE DE TRANSACTION', rec.transactionType || '\u2014');
  drawCol(2, 'TYPE DE DOCUMENT', rec.documentType || 'Paiement');
  drawCol(3, 'DATE DE COMPTABILISATION', fmtDate(rec.postingDate));
  curY = metaY - 12;

  // 5. Beneficiary & Account Grid (Card 2 - 2 Columns)
  const partyH = 82;
  const partyY = curY - partyH;
  const partyGap = 12;
  const partyColW = (W - partyGap) / 2;

  // Left card: Vendor / Customer / Contact
  page.drawRectangle({
    x: MARGIN, y: partyY, width: partyColW, height: partyH,
    color: cCardBg, borderColor: cCardBorder, borderWidth: 1
  });
  const maxPartyValW = partyColW - 20;
  const drawPartyRowL = (rowIdx, label, val, isBold) => {
    const rx = MARGIN + 10;
    const ry = partyY + partyH - 12 - rowIdx * 24;
    page.drawText(label, { x: rx, y: ry, size: 6.5, font: bold, color: cGrayLabel });
    page.drawText(fitText(isBold ? bold : font, val, maxPartyValW, isBold ? 9 : 8.5), {
      x: rx, y: ry - 11, size: isBold ? 9 : 8.5, font: isBold ? bold : font, color: cNavy
    });
  };
  drawPartyRowL(0, 'B\u00c9N\u00c9FICIAIRE / VENDOR', rec.vendorName || '\u2014', true);
  drawPartyRowL(1, 'CLIENT / CUSTOMER', rec.customerName || '\u2014', false);
  drawPartyRowL(2, 'CONTACT PRINCIPAL', rec.primaryContactCode || '\u2014', false);

  // Right card: Account / Type / Bal Account
  const rCardX = MARGIN + partyColW + partyGap;
  page.drawRectangle({
    x: rCardX, y: partyY, width: partyColW, height: partyH,
    color: cCardBg, borderColor: cCardBorder, borderWidth: 1
  });
  const drawPartyRowR = (rowIdx, label, val, isBold) => {
    const rx = rCardX + 10;
    const ry = partyY + partyH - 12 - rowIdx * 24;
    page.drawText(label, { x: rx, y: ry, size: 6.5, font: bold, color: cGrayLabel });
    page.drawText(fitText(isBold ? bold : font, val, maxPartyValW, isBold ? 9 : 8.5), {
      x: rx, y: ry - 11, size: isBold ? 9 : 8.5, font: isBold ? bold : font, color: cNavy
    });
  };
  drawPartyRowR(0, 'N\u00b0 COMPTE / ACCOUNT NO.', rec.accountNo || '\u2014', true);
  drawPartyRowR(1, 'TYPE DE COMPTE', rec.accountType || '\u2014', false);
  drawPartyRowR(2, 'COMPTE DE CONTREPARTIE', rec.balAccountNo || '\u2014', false);
  curY = partyY - 12;

  // 6. Financial Summary Grid (Card 3 - Green)
  const finH = 42;
  const finY = curY - finH;
  page.drawRectangle({
    x: MARGIN, y: finY, width: W, height: finH,
    color: cGreenBg, borderColor: cGreenBorder, borderWidth: 1
  });
  const drawFinCol = (colIdx, label, val) => {
    const cx = MARGIN + colIdx * colW4 + 10;
    const maxFinW = colW4 - 16;
    page.drawText(label, { x: cx, y: finY + 27, size: 6.5, font: bold, color: cGrayLabel });
    page.drawText(fitText(bold, val, maxFinW, 9), { x: cx, y: finY + 11, size: 9, font: bold, color: cNavy });
  };
  drawFinCol(0, 'DEVISE / CURRENCY', rec.currencyCode || 'USD');
  drawFinCol(1, 'MONTANT / AMOUNT', fmtAmount(rec.amount) + ' ' + (rec.currencyCode || ''));
  drawFinCol(2, 'MONTANT EN DEVISE LOCALE (LCY)', fmtAmount(rec.amountLCY) + ' CDF');
  drawFinCol(3, 'TAUX / CURRENCY FACTOR', rec.currencyFactor ? fmtAmount(rec.currencyFactor) : '1,00');
  curY = finY - 16;

  // 7. Lines Table
  const tblHdrH = 20;
  const tblHdrY = curY - tblHdrH;
  page.drawRectangle({
    x: MARGIN, y: tblHdrY, width: W, height: tblHdrH,
    color: cTableHdrBg, borderColor: cTableBorder, borderWidth: 1
  });
  const cols = [
    { label: 'LIGNE', w: 36, align: 'left' },
    { label: 'N\u00b0 COMPTE', w: 64, align: 'left' },
    { label: 'DESCRIPTION', w: 140, align: 'left' },
    { label: 'DATE', w: 58, align: 'left' },
    { label: 'DEVISE', w: 42, align: 'left' },
    { label: 'MONTANT PR\u00c9VU', w: 60, align: 'right' },
    { label: 'MONTANT R\u00c9EL', w: 60, align: 'right' },
    { label: '\u00c9CART FX', w: 63, align: 'right' }
  ];
  let curColX = MARGIN;
  cols.forEach(c => {
    const textW = bold.widthOfTextAtSize(c.label, 6.5);
    const tx = c.align === 'right' ? curColX + c.w - textW - 6 : curColX + 6;
    page.drawText(c.label, { x: tx, y: tblHdrY + 6, size: 6.5, font: bold, color: cGrayText });
    curColX += c.w;
  });

  // Table Body
  const lines = rec.lines || [];
  if (lines.length === 0) {
    const emptyH = 28;
    const emptyY = tblHdrY - emptyH;
    page.drawRectangle({
      x: MARGIN, y: emptyY, width: W, height: emptyH,
      color: cWhite, borderColor: cCardBorder, borderWidth: 1
    });
    const emptyMsg = 'Aucune ligne d\u00e9taill\u00e9e \u2022 Transaction au comptant / Single Header Entry';
    const msgW = italic.widthOfTextAtSize(emptyMsg, 8);
    page.drawText(emptyMsg, { x: MARGIN + (W - msgW) / 2, y: emptyY + 10, size: 8, font: italic, color: cGrayLabel });
    curY = emptyY - 20;
  } else {
    let rowY = tblHdrY;
    lines.forEach((l, idx) => {
      const rowH = 18;
      rowY -= rowH;
      const bg = (idx % 2 === 1) ? cCardBg : cWhite;
      page.drawRectangle({ x: MARGIN, y: rowY, width: W, height: rowH, color: bg, borderColor: cCardBorder, borderWidth: 0.5 });
      const rowVals = [
        { v: String(l.lineNo || ''), w: 36, align: 'left' },
        { v: String(l.accountNo || ''), w: 64, align: 'left' },
        { v: String(l.description || 'Paiement Fournisseur'), w: 140, align: 'left' },
        { v: fmtDate(l.postingDate), w: 58, align: 'left' },
        { v: String(l.currencyCode || rec.currencyCode || 'USD'), w: 42, align: 'left' },
        { v: fmtAmount(l.expectedUSD), w: 60, align: 'right' },
        { v: fmtAmount(l.actualUSD), w: 60, align: 'right' },
        { v: fmtAmount(l.fxDifference), w: 63, align: 'right' }
      ];
      let rx = MARGIN;
      rowVals.forEach(cell => {
        let txt = cell.v;
        if (cell.align === 'left' && font.widthOfTextAtSize(txt, 7.5) > cell.w - 10) {
          while (txt.length > 3 && font.widthOfTextAtSize(txt + '\u2026', 7.5) > cell.w - 10) {
            txt = txt.slice(0, -1);
          }
          txt += '\u2026';
        }
        const tw = font.widthOfTextAtSize(txt, 7.5);
        const tx = cell.align === 'right' ? rx + cell.w - tw - 6 : rx + 6;
        page.drawText(txt, { x: tx, y: rowY + 5, size: 7.5, font: font, color: cNavy });
        rx += cell.w;
      });
    });

    // Totals row
    const totH = 20;
    rowY -= totH;
    page.drawRectangle({ x: MARGIN, y: rowY, width: W, height: totH, color: cCardBg, borderColor: cNavy, borderWidth: 1 });
    page.drawText('TOTAL', { x: MARGIN + 104, y: rowY + 6, size: 8, font: bold, color: cNavy });

    const totExpected = fmtAmount(sumLines(lines, 'expectedUSD'));
    const totActual = fmtAmount(sumLines(lines, 'actualUSD'));
    const totFx = fmtAmount(sumLines(lines, 'fxDifference'));

    const teW = bold.widthOfTextAtSize(totExpected, 8);
    const taW = bold.widthOfTextAtSize(totActual, 8);
    const tfW = bold.widthOfTextAtSize(totFx, 8);

    page.drawText(totExpected, { x: MARGIN + 340 + 60 - teW - 6, y: rowY + 6, size: 8, font: bold, color: cNavy });
    page.drawText(totActual, { x: MARGIN + 400 + 60 - taW - 6, y: rowY + 6, size: 8, font: bold, color: cNavy });
    page.drawText(totFx, { x: MARGIN + 460 + 63 - tfW - 6, y: rowY + 6, size: 8, font: bold, color: cNavy });

    curY = rowY - 20;
  }

  // 8. Footer: Legal Notice on Left & Signature Box on Right
  const noticeMaxW = W - 264;
  page.drawLine({ start: { x: MARGIN, y: curY - 5 }, end: { x: MARGIN, y: curY - 45 }, thickness: 2.5, color: cTableBorder });
  page.drawText('Par la pr\u00e9sente, le b\u00e9n\u00e9ficiaire soussign\u00e9 confirme la r\u00e9ception exacte du montant', {
    x: MARGIN + 8, y: curY - 18, size: 7.5, font: italic, color: cGrayLabel
  });
  page.drawText('indiqu\u00e9 ci-dessus de S&K Supermarche RDC.', {
    x: MARGIN + 8, y: curY - 28, size: 7.5, font: italic, color: cGrayLabel
  });

  // Signature Box
  const sigBoxW = 246;
  const sigBoxH = 120;
  const sigBoxX = MARGIN + W - sigBoxW;
  const sigBoxY = curY - sigBoxH;

  // Background
  page.drawRectangle({
    x: sigBoxX, y: sigBoxY, width: sigBoxW, height: sigBoxH,
    color: cSigBg
  });

  // Dashed border around signature box
  const dOpt = { thickness: 1.2, color: cSigBorder, dashArray: [4, 3] };
  page.drawLine({ start: { x: sigBoxX, y: sigBoxY }, end: { x: sigBoxX + sigBoxW, y: sigBoxY }, ...dOpt });
  page.drawLine({ start: { x: sigBoxX + sigBoxW, y: sigBoxY }, end: { x: sigBoxX + sigBoxW, y: sigBoxY + sigBoxH }, ...dOpt });
  page.drawLine({ start: { x: sigBoxX + sigBoxW, y: sigBoxY + sigBoxH }, end: { x: sigBoxX, y: sigBoxY + sigBoxH }, ...dOpt });
  page.drawLine({ start: { x: sigBoxX, y: sigBoxY + sigBoxH }, end: { x: sigBoxX, y: sigBoxY }, ...dOpt });

  // Signature Box Header
  page.drawText('SIGNATURE MANUSCRITE DU B\u00c9N\u00c9FICIAIRE', {
    x: sigBoxX + 10, y: sigBoxY + sigBoxH - 14, size: 7, font: bold, color: cBlue
  });

  // Inner White Canvas Box
  const canW = sigBoxW - 16;
  const canH = 82;
  const canX = sigBoxX + 8;
  const canY = sigBoxY + 18;
  page.drawRectangle({
    x: canX, y: canY, width: canW, height: canH,
    color: cWhite, borderColor: cSigCanvasBorder, borderWidth: 1
  });

  // Embed Signature Image inside canvas
  const sigB64 = stripPrefix(signatureImageBase64);
  if (sigB64) {
    let sigImg = null;
    try {
      sigImg = await doc.embedPng(sigB64);
    } catch (e1) {
      try {
        sigImg = await doc.embedJpg(sigB64);
      } catch (e2) {
        sigImg = null;
      }
    }
    if (sigImg) {
      const scaled = sigImg.scaleToFit(canW - 12, canH - 12);
      const imgX = canX + (canW - scaled.width) / 2;
      const imgY = canY + (canH - scaled.height) / 2;
      page.drawImage(sigImg, {
        x: imgX,
        y: imgY,
        width: scaled.width,
        height: scaled.height
      });
    } else {
      page.drawText('Signature captur\u00e9e', {
        x: canX + 20, y: canY + 36, size: 8.5, font: font, color: cGrayLabel
      });
    }
  }

  // Subtitle
  const subTxt = 'Signer \u00e0 l\'aide du stylet Wacom \u2022 Sign with pen';
  const subW = font.widthOfTextAtSize(subTxt, 6.5);
  page.drawText(subTxt, {
    x: sigBoxX + (sigBoxW - subW) / 2, y: sigBoxY + 7, size: 6.5, font: font, color: cGrayLabel
  });

  const bytes = await doc.save();
  return Buffer.from(bytes).toString('base64');
}

module.exports = { buildSignedPdf };
