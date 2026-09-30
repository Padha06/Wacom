// Monitor (laptop): shows ONLY the document dispatched from Business Central as a report,
// with a live view of the signature being captured on the signpad.
var STATION = '';
(function () {
  var m = window.location.pathname.match(/^\/[sm]\/([A-Za-z0-9_-]+)/i);
  if (m) STATION = m[1].toUpperCase();
  var q = new URLSearchParams(window.location.search);
  var tok = q.get('token');
  if (tok && typeof localStorage !== 'undefined') {
    localStorage.setItem('ws_token', tok);
  }
})();

function apiUrl(p) {
  var q = new URLSearchParams(window.location.search);
  var tok = q.get('token') || (typeof localStorage !== 'undefined' ? localStorage.getItem('ws_token') : '');
  var params = [];
  if (STATION) params.push('station=' + encodeURIComponent(STATION));
  if (tok) params.push('token=' + encodeURIComponent(tok));
  if (params.length === 0) return p;
  return p + (p.indexOf('?') >= 0 ? '&' : '?') + params.join('&');
}

var monitor = null;
var session = null;
var es = null;
var polling = false;

function setStatus(text, cls) {
  var el = document.getElementById('mStatus');
  el.textContent = text;
  el.className = 'status ' + (cls || 'waiting');
}

function setToken(text, cls) {
  var el = document.getElementById('tokenChip');
  el.textContent = text;
  el.className = 'status ' + (cls || 'waiting');
}

function showWaiting() {
  document.getElementById('waitView').classList.remove('hidden');
  document.getElementById('reportView').classList.add('hidden');
  document.title = 'Signing Monitor';
}

function showReport(rec) {
  document.getElementById('waitView').classList.add('hidden');
  document.getElementById('reportView').classList.remove('hidden');
  document.getElementById('sessionDoc').textContent = rec.documentNo + ' · ' + rec.transactionType;

  var paper = renderReport(document.getElementById('reportPaper'), rec);
  var canvas = paper.querySelector('.sig-canvas');
  monitor = new ScaleCanvas(canvas);
  monitor.resize();
  window.addEventListener('resize', function () { if (monitor) monitor.resize(); });
}

function closeStream() {
  if (es) { es.close(); es = null; }
}

async function refreshTokenStatus() {
  try {
    var res = await fetch(apiUrl('/api/status'));
    if (!res.ok) return;
    var j = await res.json();
    if (j.token && j.token.cached) {
      setToken('Token: refreshed · ' + j.token.expiresInSeconds + 's left', 'ready');
    } else {
      setToken('Token: none yet', 'waiting');
    }
  } catch (e) {}
}

function alertUser() {
  try {
    var ctx = new (window.AudioContext || window.webkitAudioContext)();
    var o = ctx.createOscillator();
    var g = ctx.createGain();
    o.connect(g);
    g.connect(ctx.destination);
    o.frequency.value = 880;
    g.gain.value = 0.25;
    o.start();
    o.frequency.exponentialRampToValueAtTime(1320, ctx.currentTime + 0.25);
    o.stop(ctx.currentTime + 0.35);
    o.onended = function () { try { ctx.close(); } catch (e) {} };
  } catch (e) {}
  try { window.focus(); } catch (e) {}
  document.title = '! SIGN HERE - Signing Monitor';
}

function setPageTitle(t) {
  document.title = t;
}

async function waitForDispatch() {
  if (polling) return;
  polling = true;
  try {
    setStatus('Waiting for a dispatch from Business Central…', 'waiting');
    var res = await fetch(apiUrl('/api/session'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    if (res.status === 404) {
      closeStream();
      if (session) { session = null; if (monitor) { monitor.clear(); monitor = null; } showWaiting(); }
      setStatus('No pending document'.length > 0 ? 'Waiting for a document from Business Central…' : '', 'waiting');
      return;
    }
    if (!res.ok) {
      if (res.status === 401 || res.status === 404) {
        setStatus('Station ' + (STATION || '') + ': Ready & waiting for document…', 'waiting');
        return;
      }
      var err = await res.json();
      setStatus(err.error || 'Failed to load document.', 'error');
      return;
    }
    var s = await res.json();
    if (session && session.id === s.id) return;
    session = s;
    showReport(session.record);
    setStatus(s.status === 'signed' ? 'Signed — ready for the next document.' : 'Waiting for the customer to sign…', 'waiting');
    if (s.status !== 'signed') alertUser();
    refreshTokenStatus();
    openStream();
  } catch (e) {
    setStatus('Cannot reach signing server: ' + e.message, 'error');
  } finally {
    polling = false;
  }
}

function endSession() {
  fetch(apiUrl('/api/session'), { method: 'DELETE' }).catch(function () {});
  closeStream();
  if (monitor) { monitor.clear(); monitor = null; }
  session = null;
  document.getElementById('btnEndSession').disabled = true;
  document.getElementById('sessionDoc').textContent = '';
  document.getElementById('sigState').className = 'status waiting';
  showWaiting();
}

function openStream() {
  closeStream();
  es = new EventSource(apiUrl('/api/session/events'));
  es.addEventListener('snapshot', function (ev) {
    var d = JSON.parse(ev.data);
    if (monitor) monitor.clear();
    (d.strokes || []).forEach(function (st) { if (monitor) monitor.drawStroke(st); });
    if (d.status === 'signing') sig('Signing…', 'signing');
    if (d.status === 'saving') sig('Saving…', 'saving');
    if (d.status === 'signed') sig('Signed', 'signed');
    if (d.error) sig('Error: ' + d.error, 'error');
  });
  es.addEventListener('stroke', function (ev) {
    var d = JSON.parse(ev.data);
    if (monitor) monitor.drawStroke(d.points);
    sig('Signing…', 'signing');
  });
  es.addEventListener('saved', function () {
    sig('Signed', 'signed');
  });
  es.addEventListener('error', function (ev) {
    try { var d = JSON.parse(ev.data); sig('Error: ' + d.message, 'error'); } catch (e) {}
  });
  es.onerror = function () {
    setTimeout(function () {
      if (session) { closeStream(); openStream(); }
    }, 3000);
  };
}

function sig(text, cls) {
  var el = document.getElementById('sigState');
  el.textContent = text;
  el.className = 'status ' + (cls || 'waiting');
}

function init() {
  var sc = document.getElementById('stationChip');
  if (sc) {
    var txt = sc.querySelector('.chip-text');
    if (txt) txt.textContent = 'Station: ' + (STATION || 'NONE');
    else sc.textContent = 'Station: ' + (STATION || 'NONE');
  }
  document.getElementById('btnEndSession').addEventListener('click', endSession);
  showWaiting();
  if (!STATION) {
    setStatus('Invalid URL: missing station. Use /m/<STATION>.', 'error');
    return;
  }
  waitForDispatch();
  setInterval(waitForDispatch, 1000);
  setInterval(refreshTokenStatus, 30000);
}

init();