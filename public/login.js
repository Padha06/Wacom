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
  function returnTo(dest) {
    var target = null;
    if (dest) {
      try {
        var u = new URL(dest, window.location.origin);
        if (u.origin === window.location.origin && u.pathname.match(/^\/[sm]\//)) target = u.href;
      } catch (e) {}
    }
    if (!target) {
      var ref = document.referrer;
      try {
        var v = new URL(ref, window.location.origin);
        if (v.origin === window.location.origin && v.pathname !== '/login') target = v.href;
      } catch (e) {}
    }
    if (target) { window.location.href = target; return true; }
    return false;
  }

  form.addEventListener('submit', async function (ev) {
    ev.preventDefault();
    var username = userEl.value.trim();
    var password = passEl.value;
    if (!username || !password) { showError('Enter username and password.'); return; }
    btn.disabled = true;
    errEl.classList.add('hidden');
    try {
      var res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username, password: password })
      });
      var j = await res.json().catch(function () { return {}; });
      if (!res.ok) {
        showError(j.error || 'Login failed. Check your username and password.');
        btn.disabled = false;
        return;
      }
      var qdest = new URLSearchParams(window.location.search).get('redirect');
      if (!returnTo(qdest)) {
        // Default: send this user to their own station's kiosk (sign) page.
        showInfo('Sign-in successful for ' + j.station + ' — redirecting…');
        setTimeout(function () {
          window.location.replace('/s/' + encodeURIComponent(j.station));
        }, 250);
      }
    } catch (e) {
      showError('Cannot reach the server: ' + e.message);
      btn.disabled = false;
    }
  });
})();
