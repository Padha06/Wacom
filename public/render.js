// Shared report rendering for the Signature Monitoring portal.

function fmtDate(v) {
  if (!v) return '';
  var s = String(v);
  if (s.indexOf('T') >= 0) s = s.slice(0, 10);
  var parts = s.split('-');
  if (parts.length === 3) return parts[2] + '.' + parts[1] + '.' + parts[0];
  return s;
}

function fmtAmount(v) {
  if (v == null || v === '') return '';
  var n = Number(v);
  if (isNaN(n)) return String(v);
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function sumLines(lines, key) {
  var total = 0;
  (lines || []).forEach(function (l) {
    var n = Number(l[key]);
    if (!isNaN(n)) total += n;
  });
  return total;
}

// Build the report paper (header, lines, footer) into container.
function renderReport(container, rec) {
  container.innerHTML = '';

  var paper = document.createElement('div');
  paper.className = 'paper';

  var title = document.createElement('div');
  title.className = 'paper-title';
  title.textContent = 'TREASURY TRANSACTION';
  paper.appendChild(title);

  var meta = document.createElement('div');
  meta.className = 'paper-meta';
  meta.appendChild(field('Document No.', rec.documentNo));
  meta.appendChild(field('Transaction Type', rec.transactionType));
  meta.appendChild(field('Document Type', rec.documentType));
  meta.appendChild(field('Posting Date', fmtDate(rec.postingDate)));
  paper.appendChild(meta);

  var party = document.createElement('div');
  party.className = 'paper-party';
  var pLeft = document.createElement('div');
  pLeft.appendChild(field('Vendor', rec.vendorName));
  pLeft.appendChild(field('Customer', rec.customerName));
  pLeft.appendChild(field('Primary Contact Code', rec.primaryContactCode));
  var pRight = document.createElement('div');
  pRight.appendChild(field('Account No.', rec.accountNo));
  pRight.appendChild(field('Account Type', rec.accountType));
  pRight.appendChild(field('Bal. Account No.', rec.balAccountNo));
  party.appendChild(pLeft);
  party.appendChild(pRight);
  paper.appendChild(party);

  var fin = document.createElement('div');
  fin.className = 'paper-meta';
  fin.appendChild(field('Currency', rec.currencyCode));
  fin.appendChild(field('Amount', fmtAmount(rec.amount)));
  fin.appendChild(field('Amount (LCY)', fmtAmount(rec.amountLCY)));
  fin.appendChild(field('Currency Factor', fmtAmount(rec.currencyFactor)));
  paper.appendChild(fin);

  var lines = document.createElement('table');
  lines.className = 'lines';
  var thead = document.createElement('thead');
  thead.innerHTML = '<tr>' +
    '<th>Line</th><th>Account No.</th><th>Description</th><th>Posting Date</th><th>Currency</th>' +
    '<th>Expected USD</th><th>Actual USD</th><th>FX Difference</th>' +
    '</tr>';
  lines.appendChild(thead);
  var tbody = document.createElement('tbody');
  (rec.lines || []).forEach(function (l) {
    var tr = document.createElement('tr');
    tr.appendChild(td(l.lineNo));
    tr.appendChild(td(l.accountNo));
    tr.appendChild(td(l.description));
    tr.appendChild(td(fmtDate(l.postingDate)));
    tr.appendChild(td(l.currencyCode));
    tr.appendChild(td(fmtAmount(l.expectedUSD)));
    tr.appendChild(td(fmtAmount(l.actualUSD)));
    tr.appendChild(td(fmtAmount(l.fxDifference)));
    tbody.appendChild(tr);
  });
  var totalRow = document.createElement('tr');
  totalRow.className = 'totals';
  totalRow.appendChild(td(''));
  totalRow.appendChild(td(''));
  totalRow.appendChild(td('Totals'));
  totalRow.appendChild(td(''));
  totalRow.appendChild(td(''));
  totalRow.appendChild(td(fmtAmount(sumLines(rec.lines, 'expectedUSD'))));
  totalRow.appendChild(td(fmtAmount(sumLines(rec.lines, 'actualUSD'))));
  totalRow.appendChild(td(fmtAmount(sumLines(rec.lines, 'fxDifference'))));
  tbody.appendChild(totalRow);
  lines.appendChild(tbody);
  paper.appendChild(lines);

  // Footer: signature area (canvas is injected by the page)
  var footer = document.createElement('div');
  footer.className = 'paper-footer';
  var fTitle = document.createElement('div');
  fTitle.className = 'footer-title';
  fTitle.textContent = 'AUTHORIZED SIGNATURE';
  footer.appendChild(fTitle);
  var signRow = document.createElement('div');
  signRow.className = 'sign-row';
  var box = document.createElement('div');
  box.className = 'sign-box';
  var canvas = document.createElement('canvas');
  canvas.className = 'sig-canvas';
  box.appendChild(canvas);
  var line = document.createElement('div');
  line.className = 'sign-line';
  line.textContent = 'Signature';
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
  var v = document.createElement('b');
  v.textContent = value == null || value === '' ? '—' : String(value);
  v.className = 'field-value';
  d.appendChild(s);
  d.appendChild(v);
  return d;
}

function td(value) {
  var el = document.createElement('td');
  el.textContent = value == null ? '' : String(value);
  return el;
}

// Build the picker table.
function renderPicker(tableBody, records) {
  tableBody.innerHTML = '';
  if (!records || records.length === 0) {
    var tr = document.createElement('tr');
    var c = document.createElement('td');
    c.colSpan = 6;
    c.textContent = 'No treasury transactions found.';
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
    tr.appendChild(td(fmtAmount(t.amountLCY) + ' ' + (t.currencyCode || '')));
    tableBody.appendChild(tr);
    tr.addEventListener('click', function () {
      document.dispatchEvent(new CustomEvent('select-transaction', {
        detail: { transactionType: t.transactionType, documentNo: t.documentNo }
      }));
    });
  });
}