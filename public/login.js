// Login page for the hosted signing site.
(function () {
  var form = document.getElementById('loginForm');
  var userEl = document.getElementById('username');
  var passEl = document.getElementById('password');
  var errEl = document.getElementById('loginError');
  var btn = document.getElementById('loginBtn');
  var infoEl = document.getElementById('loginInfo');

  if (!form || !userEl || !passEl || !btn) return;

  function showError(msg) {
    errEl.textContent = msg;
    errEl.classList.remove('hidden');
  }

  function showInfo(msg) {
    if (!infoEl) return;
    infoEl.textContent = msg;
    infoEl.classList.remove('hidden');
  }

  // After a successful login, go to the intended station page. The server appends
  // ?redirect=/m/CON001 when a logged-out user tries to open a station page; fall
  // back to document.referrer or this user's monitor.
  function returnTo(dest, station, token) {
    var tokenSuffix = token ? '?token=' + encodeURIComponent(token) : '';
    if (dest) {
      try {
        var u = new URL(dest, window.location.origin);
        if (u.origin === window.location.origin && u.pathname.match(/^\/[sm]\//)) {
          window.location.replace(u.pathname + tokenSuffix);
          return true;
        }
      } catch (e) {}
    }
    if (station) {
      window.location.replace('/s/' + encodeURIComponent(station) + tokenSuffix);
      return true;
    }
    return false;
  }

  form.addEventListener('submit', async function (ev) {
    ev.preventDefault();
    var stationEl = document.getElementById('stationCode');
    var username = userEl.value.trim();
    var stationCode = stationEl ? stationEl.value.trim() : '';
    var password = passEl.value;
    if (!username && !stationCode) { showError('Enter your username or station code.'); return; }
    btn.disabled = true;
    errEl.classList.add('hidden');
    try {
      var res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username, stationCode: stationCode, password: password })
      });
      var j = await res.json().catch(function () { return {}; });
      if (!res.ok) {
        showError(j.error || 'Login failed. Please check your credentials.');
        btn.disabled = false;
        return;
      }
      if (j.token && typeof localStorage !== 'undefined') {
        localStorage.setItem('ws_token', j.token);
      }
      showInfo('Sign-in successful for station ' + (j.station || stationCode || username) + ' — opening…');
      var qdest = new URLSearchParams(window.location.search).get('redirect');
      setTimeout(function () {
        returnTo(qdest, j.station || stationCode || username, j.token);
      }, 150);
    } catch (e) {
      showError('Cannot reach the server: ' + e.message);
      btn.disabled = false;
    }
  });
})();
