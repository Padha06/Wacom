// Signpad (Wacom): shows the current document's report and captures the signature.
var STATION = '';
(function () {
  var m = window.location.pathname.match(/^\/[sm]\/([A-Za-z0-9_-]+)/i);
  if (m) STATION = m[1].toUpperCase();
})();
function apiUrl(p) { return p; }

var pad = null;
var currentSession = null;
var handledId = null;
var saving = false;

function setStatus(text, cls) {
  var el = document.getElementById('status');
  el.textContent = text;
  el.className = 'status ' + (cls || 'waiting');
}

function showNoSession() {
  document.getElementById('noSession').classList.remove('hidden');
  document.getElementById('signView').classList.add('hidden');
  document.getElementById('successBox').classList.add('hidden');
  document.getElementById('btnClear').disabled = true;
  document.getElementById('btnSave').disabled = true;
}

function showSession(s) {
  document.getElementById('noSession').classList.add('hidden');
  document.getElementById('successBox').classList.add('hidden');
  document.getElementById('signView').classList.remove('hidden');

  var paper = renderReport(document.getElementById('reportPaper'), s.record);
  var canvas = paper.querySelector('.sig-canvas');
  pad = new SignaturePad(canvas, {
    lineWidth: 2.5,
    onStrokeEnd: function (points) { postStroke(points); }
  });
  pad.resize();
  window.addEventListener('resize', function () { if (pad) pad.resize(); });
  document.getElementById('btnClear').disabled = false;
  document.getElementById('btnSave').disabled = false;
}

function canvasRect() {
  var canvas = document.querySelector('.sig-canvas');
  return canvas.getBoundingClientRect();
}

function normalize(points) {
  var rect = canvasRect();
  return points.map(function (p) {
    return { x: (p.x / rect.width).toFixed(4), y: (p.y / rect.height).toFixed(4) };
  });
}

async function postStroke(points) {
  if (!currentSession) return;
  try {
    await fetch(apiUrl('/api/session/stroke'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ points: normalize(points) })
    });
  } catch (e) {}
}

function initPad() {
  document.getElementById('btnClear').addEventListener('click', function () {
    if (pad) pad.clear();
  });

  document.getElementById('btnSave').addEventListener('click', async function () {
    if (saving || !currentSession || !pad) return;
    if (pad.isEmpty()) {
      setStatus('Please sign before saving.', 'waiting');
      return;
    }
    saving = true;
    setStatus('Saving signature…', 'saving');
    try {
      var res = await fetch(apiUrl('/api/session/save'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ base64: pad.dataUrl() })
      });
      if (!res.ok) {
        var err = await res.json();
        setStatus('Save failed: ' + (err.error || res.status), 'error');
        saving = false;
        return;
      }
      document.getElementById('signView').classList.add('hidden');
      document.getElementById('successBox').classList.remove('hidden');
      document.getElementById('sDoc').textContent = currentSession.record.documentNo;
      setStatus('Signed', 'signed');
      saving = false;
      setTimeout(function () {
        currentSession = null;
        handledId = null;
        showNoSession();
        setStatus('Waiting for a signature request…', 'waiting');
      }, 5000);
    } catch (e) {
      setStatus('Save failed: ' + e.message, 'error');
      saving = false;
    }
  });
}

async function poll() {
  if (saving) return;
  try {
    var res = await fetch(apiUrl('/api/session/current'));
    if (res.status === 401) {
      setStatus('Session expired - redirecting to login…', 'error');
      setTimeout(function () { window.location.href = '/login'; }, 800);
      return;
    }
    if (res.status === 404) {
      if (currentSession) { currentSession = null; handledId = null; showNoSession(); setStatus('Waiting for a signature request…', 'waiting'); }
      return;
    }
    var s = await res.json();
    if (s.id !== handledId) {
      handledId = s.id;
      currentSession = s;
      if (s.status === 'signed') {
        showNoSession();
        setStatus('Done', 'signed');
      } else {
        showSession(s);
        setStatus(s.status === 'saving' ? 'Saving…' : 'Please sign with the pen', s.status === 'saving' ? 'saving' : 'ready');
      }
    }
  } catch (e) {
    setStatus('Cannot reach signing server.', 'error');
  }
}

initPad();
(function () {
  var tag = document.getElementById('stationTag');
  if (tag) tag.textContent = STATION || 'NO STATION';
})();
if (STATION) {
  poll();
  setInterval(poll, 1000);
} else {
  setStatus('Invalid URL: missing station. Use /s/<STATION>.', 'error');
}