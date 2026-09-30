// Login page for S&K Supermarche Wacom Signing Portal
(function () {
  var form = document.getElementById('loginForm');
  var userEl = document.getElementById('username');
  var errEl = document.getElementById('loginError');
  var btn = document.getElementById('loginBtn');
  var infoEl = document.getElementById('loginInfo');

  if (!form || !userEl || !btn) return;

  function showError(msg) {
    if (errEl) {
      errEl.textContent = msg;
      errEl.classList.remove('hidden');
    }
    if (infoEl) infoEl.classList.add('hidden');
  }

  function showInfo(msg) {
    if (infoEl) {
      infoEl.textContent = msg;
      infoEl.classList.remove('hidden');
    }
    if (errEl) errEl.classList.add('hidden');
  }

  // After a successful login, redirect to the station kiosk page
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

    if (!username && !stationCode) {
      showError('Please enter your Business Central Username or Station Code.');
      return;
    }

    btn.disabled = true;
    btn.classList.add('loading');
    if (errEl) errEl.classList.add('hidden');

    try {
      var res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username, stationCode: stationCode })
      });
      var j = await res.json().catch(function () { return {}; });

      if (!res.ok) {
        showError(j.error || 'Login failed. Please check your username or station setup.');
        btn.disabled = false;
        btn.classList.remove('loading');
        return;
      }

      if (j.token && typeof localStorage !== 'undefined') {
        localStorage.setItem('ws_token', j.token);
      }

      var targetStation = j.station || stationCode || username;
      showInfo('Connected to station ' + targetStation + ' — Opening kiosk…');

      var qdest = new URLSearchParams(window.location.search).get('redirect');
      setTimeout(function () {
        returnTo(qdest, targetStation, j.token);
      }, 200);
    } catch (e) {
      showError('Cannot connect to signing server: ' + e.message);
      btn.disabled = false;
      btn.classList.remove('loading');
    }
  });
})();
