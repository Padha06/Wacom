// Shared report rendering for S&K Supermarche Signature Monitoring Portal.

function fmtDate(v) {
  if (!v) return '';
  var s = String(v);
  if (s.indexOf('T') >= 0) s = s.slice(0, 10);
  var parts = s.split('-');
  if (parts.length === 3) return parts[2] + '/' + parts[1] + '/' + parts[0];
  return s;
}

function fmtAmount(v) {
  if (v == null || v === '') return '0.00';
  var n = Number(v);
  if (isNaN(n)) return String(v);
  return n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function sumLines(lines, key) {
  var total = 0;
  (lines || []).forEach(function (l) {
    var n = Number(l[key]);
    if (!isNaN(n)) total += n;
  });
  return total;
}

// Build the corporate S&K Supermarche report paper into container.
function renderReport(container, rec) {
  container.innerHTML = '';

  var paper = document.createElement('div');
  paper.className = 'paper';

  // 1. Corporate Header
  var header = document.createElement('div');
  header.className = 'paper-corp-header';

  var logoBox = document.createElement('div');
  logoBox.className = 'corp-logo-box';
  var logoImg = document.createElement('img');
  logoImg.src = '/logo.png';
  logoImg.alt = 'S&K Supermarche';
  logoImg.className = 'corp-logo-img';
  logoBox.appendChild(logoImg);

  var corpInfo = document.createElement('div');
  corpInfo.className = 'corp-info';
  corpInfo.innerHTML = 
    '<div class="corp-name">S&K SUPERMARCHE RDC</div>' +
    '<div class="corp-details">Distribution &bull; Kinshasa &bull; Lubumbashi &bull; Goma &bull; RDC</div>' +
    '<div class="corp-dept">DIRECTION FINANCIÈRE &bull; DÉPARTEMENT TRÉSORERIE</div>';

  header.appendChild(logoBox);
  header.appendChild(corpInfo);
  paper.appendChild(header);

  // 2. Voucher Title & Badge
  var titleRow = document.createElement('div');
  titleRow.className = 'paper-title-row';
  titleRow.innerHTML = 
    '<div class="title-main">BON DE PAIEMENT / TREASURY TRANSACTION</div>' +
    '<div class="doc-badge">DOC: ' + (rec.documentNo || '—') + '</div>';
  paper.appendChild(titleRow);

  // 3. Document Metadata Grid
  var meta = document.createElement('div');
  meta.className = 'paper-meta';
  meta.appendChild(field('N° Document / Doc No.', rec.documentNo));
  meta.appendChild(field('Type de Transaction', rec.transactionType));
  meta.appendChild(field('Type de Document', rec.documentType || 'Paiement'));
  meta.appendChild(field('Date de Comptabilisation', fmtDate(rec.postingDate)));
  paper.appendChild(meta);

  // 4. Beneficiary & Account Grid
  var party = document.createElement('div');
  party.className = 'paper-party';
  var pLeft = document.createElement('div');
  pLeft.className = 'party-col';
  pLeft.appendChild(field('Bénéficiaire / Vendor', rec.vendorName || '—'));
  pLeft.appendChild(field('Client / Customer', rec.customerName || '—'));
  pLeft.appendChild(field('Contact Principal', rec.primaryContactCode || '—'));

  var pRight = document.createElement('div');
  pRight.className = 'party-col';
  pRight.appendChild(field('N° Compte / Account No.', rec.accountNo));
  pRight.appendChild(field('Type de Compte', rec.accountType));
  pRight.appendChild(field('Compte de Contrepartie', rec.balAccountNo));

  party.appendChild(pLeft);
  party.appendChild(pRight);
  paper.appendChild(party);

  // 5. Financial Summary Grid
  var fin = document.createElement('div');
  fin.className = 'paper-meta fin-meta';
  fin.appendChild(field('Devise / Currency', rec.currencyCode || 'USD'));
  fin.appendChild(field('Montant / Amount', fmtAmount(rec.amount) + ' ' + (rec.currencyCode || '')));
  fin.appendChild(field('Montant en Devise Locale (LCY)', fmtAmount(rec.amountLCY) + ' CDF'));
  fin.appendChild(field('Taux / Currency Factor', rec.currencyFactor ? fmtAmount(rec.currencyFactor) : '1.00'));
  paper.appendChild(fin);

  // 6. Transaction Lines Table
  var lines = document.createElement('table');
  lines.className = 'lines';
  var thead = document.createElement('thead');
  thead.innerHTML = '<tr>' +
    '<th>Ligne</th><th>N° Compte</th><th>Description</th><th>Date</th><th>Devise</th>' +
    '<th class="num">Montant Prévu</th><th class="num">Montant Réel</th><th class="num">Écart FX</th>' +
    '</tr>';
  lines.appendChild(thead);
  
  var tbody = document.createElement('tbody');
  var lineItems = rec.lines || [];
  if (lineItems.length === 0) {
    var trEmpty = document.createElement('tr');
    trEmpty.innerHTML = '<td colspan="8" class="empty-lines">Aucune ligne détaillée &bull; Transaction au comptant / Single Header Entry</td>';
    tbody.appendChild(trEmpty);
  } else {
    lineItems.forEach(function (l) {
      var tr = document.createElement('tr');
      tr.appendChild(td(l.lineNo));
      tr.appendChild(td(l.accountNo));
      tr.appendChild(td(l.description || 'Paiement Fournisseur'));
      tr.appendChild(td(fmtDate(l.postingDate)));
      tr.appendChild(td(l.currencyCode || rec.currencyCode || 'USD'));
      tr.appendChild(td(fmtAmount(l.expectedUSD), 'num'));
      tr.appendChild(td(fmtAmount(l.actualUSD), 'num'));
      tr.appendChild(td(fmtAmount(l.fxDifference), 'num'));
      tbody.appendChild(tr);
    });

    var totalRow = document.createElement('tr');
    totalRow.className = 'totals';
    totalRow.appendChild(td(''));
    totalRow.appendChild(td(''));
    totalRow.appendChild(td('TOTAL'));
    totalRow.appendChild(td(''));
    totalRow.appendChild(td(''));
    totalRow.appendChild(td(fmtAmount(sumLines(lineItems, 'expectedUSD')), 'num'));
    totalRow.appendChild(td(fmtAmount(sumLines(lineItems, 'actualUSD')), 'num'));
    totalRow.appendChild(td(fmtAmount(sumLines(lineItems, 'fxDifference')), 'num'));
    tbody.appendChild(totalRow);
  }
  lines.appendChild(tbody);
  paper.appendChild(lines);

  // 7. Signature Area
  var footer = document.createElement('div');
  footer.className = 'paper-footer';

  var certif = document.createElement('div');
  certif.className = 'paper-certif';
  certif.textContent = 'Par la présente, le bénéficiaire soussigné confirme la réception exacte du montant indiqué ci-dessus de S&K Supermarche RDC.';
  footer.appendChild(certif);

  var signRow = document.createElement('div');
  signRow.className = 'sign-row';

  var box = document.createElement('div');
  box.className = 'sign-box';

  var boxHeader = document.createElement('div');
  boxHeader.className = 'sign-box-header';
  boxHeader.innerHTML = 
    '<span class="sign-tag">SIGNATURE MANUSCRITE DU BÉNÉFICIAIRE</span>' +
    '<span class="sign-pen-icon">✍</span>';
  box.appendChild(boxHeader);

  var canvas = document.createElement('canvas');
  canvas.className = 'sig-canvas';
  box.appendChild(canvas);

  var line = document.createElement('div');
  line.className = 'sign-line';
  line.innerHTML = '<span>Signer à l\'aide du stylet Wacom &bull; Sign with pen</span>';
  box.appendChild(line);

  signRow.appendChild(box);
  footer.appendChild(signRow);
  paper.appendChild(footer);

  container.appendChild(paper);
  return paper;
}

function field(label, value) {
  var d = document.createElement('div');
  d.className = 'field';
  var s = document.createElement('span');
  s.textContent = label;
  s.className = 'field-label';
  var v = document.createElement('div');
  v.textContent = value == null || value === '' ? '—' : String(value);
  v.className = 'field-value';
  d.appendChild(s);
  d.appendChild(v);
  return d;
}

function td(value, cls) {
  var el = document.createElement('td');
  el.textContent = value == null ? '' : String(value);
  if (cls) el.className = cls;
  return el;
}

// Build the picker table for monitor.
function renderPicker(tableBody, records) {
  tableBody.innerHTML = '';
  if (!records || records.length === 0) {
    var tr = document.createElement('tr');
    var c = document.createElement('td');
    c.colSpan = 6;
    c.textContent = 'Aucune transaction en attente / No treasury transactions found.';
    c.className = 'empty';
    tr.appendChild(c);
    tableBody.appendChild(tr);
    return;
  }
  records.forEach(function (t) {
    var tr = document.createElement('tr');
    tr.className = 'pick-row';
    tr.setAttribute('data-tt', t.transactionType);
    tr.setAttribute('data-dn', t.documentNo);
    tr.appendChild(td(t.documentNo));
    tr.appendChild(td(t.transactionType));
    tr.appendChild(td(fmtDate(t.postingDate)));
    tr.appendChild(td(t.vendorName || t.customerName || ''));
    tr.appendChild(td(t.accountNo || ''));
    tr.appendChild(td(fmtAmount(t.amountLCY) + ' ' + (t.currencyCode || 'CDF'), 'num'));
    tableBody.appendChild(tr);
    tr.addEventListener('click', function () {
      document.dispatchEvent(new CustomEvent('select-transaction', {
        detail: { transactionType: t.transactionType, documentNo: t.documentNo }
      }));
    });
  });
}