module.exports = function (config) {
  const tenantId = config.tenantId;
  const environment = config.environment;
  const clientId = config.clientId;
  const clientSecret = config.clientSecret;
  const scope = 'https://api.businesscentral.dynamics.com/.default';
  const authority = 'https://login.microsoftonline.com/' + tenantId + '/oauth2/v2.0/token';

  console.log('[bc] init tenantId=' + (tenantId ? 'SET(' + tenantId.length + ')' : 'EMPTY') +
    ' environment=' + (environment ? 'SET' : 'EMPTY') +
    ' clientId=' + (clientId ? 'SET' : 'EMPTY') +
    ' clientSecret=' + (clientSecret ? 'SET' : 'EMPTY') +
    ' authority=' + authority);

  const apiBase = 'https://api.businesscentral.dynamics.com/v2.0/' + tenantId + '/' + environment;
  const treasuryBase = apiBase + '/api/DCSPL/treasury/v2.0/';
  const companyPath = 'Companies(' + (config.companyGuid || '') + ')';
  const companyQuery = 'company=' + encodeURIComponent(config.company || '');

  let token = null;
  let tokenExpiresAt = 0;

  // Token is cached in memory and reused until near expiry, then refreshed.
  async function acquireToken() {
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
      scope: scope
    });
    const res = await fetch(authority, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString()
    });
    if (!res.ok) {
      const bodyText = (await res.text()).slice(0, 300);
      console.error('[bc] token fetch failed: status=' + res.status + ' url=' + authority + ' body=' + bodyText);
      throw new Error('Token acquisition failed: ' + res.status + ' ' + bodyText);
    }
    const j = await res.json();
    token = j.access_token;
    tokenExpiresAt = Date.now() + (j.expires_in - 60) * 1000;
    return token;
  }

  async function ensureToken() {
    if (!token || Date.now() >= tokenExpiresAt) await acquireToken();
    return token;
  }

  async function api(urlPath, options, useCompanyQuery) {
    options = options || {};
    const tok = await ensureToken();
    const headers = Object.assign({ Authorization: 'Bearer ' + tok }, options.headers || {});
    let url = urlPath + (urlPath.indexOf('?') >= 0 ? '&' : '?') + companyQuery;
    let res = await fetch(url, Object.assign({}, options, { headers: headers }));
    if (res.status === 401) {
      await acquireToken();
      headers.Authorization = 'Bearer ' + tok;
      res = await fetch(url, Object.assign({}, options, { headers: headers }));
    }
    const text = await res.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch (e) { body = text; }
    if (!res.ok) throw new Error('BC API ' + urlPath + ' failed: ' + res.status + ' ' + (body && body.error ? (body.error.message || JSON.stringify(body.error)) : text));
    return body;
  }

  function esc(v) {
    return String(v).replace(/'/g, "''");
  }

  return {
    tokenInfo() {
      return {
        cached: !!token,
        expiresAt: token ? tokenExpiresAt : 0,
        expiresInSeconds: token ? Math.max(0, Math.round((tokenExpiresAt - Date.now()) / 1000)) : 0
      };
    },

    // GET report data (header + lines) for a treasury transaction
    async getTreasuryTransaction(transactionType, documentNo) {
      const path = treasuryBase + companyPath + '/treasuryTransactions?$expand=treasuryTransactionLines&$filter=transactionType eq \'' + esc(transactionType) + '\' and documentNo eq \'' + esc(documentNo) + '\'';
      const body = await api(path);
      if (!body.value || body.value.length === 0) {
        throw new Error('No treasury transaction for ' + transactionType + '/' + documentNo);
      }
      return body.value[0];
    },

    // GET the full list for the monitoring portal picker
    async listTreasuryTransactions() {
      const path = treasuryBase + companyPath + '/treasuryTransactions?$expand=treasuryTransactionLines';
      const body = await api(path);
      return body.value || [];
    },

    // GET the open signpad dispatch for a specific station (from the "Take Vendor
    // Signature" action). Dispatches are routed to a station in BC via
    // Signpad Station Users -> user's Station Code, and filtered here by Station_Code.
    async getOpenDispatch(station) {
      let filter = "Status eq 'Open'";
      if (station) filter += " and Station_Code eq '" + esc(station) + "'";
      const path = apiBase + '/api/signpad/treasury/v1.0/signpadDispatches?$filter=' + encodeURIComponent(filter) + '&$orderby=Assigned_On desc';
      const body = await api(path);
      const list = body.value || [];
      for (const d of list) {
        if (d.Transaction_Type && d.Document_No) {
          return { transactionType: d.Transaction_Type, documentNo: d.Document_No };
        }
      }
      return null;
    },

    // Close a dispatch after the signature has been saved
    async completeDispatch(transactionType, documentNo) {
      const path = apiBase + '/api/signpad/treasury/v1.0/signpadDispatches(Transaction_Type=\'' + encodeURIComponent(transactionType) + '\',Document_No=\'' + encodeURIComponent(documentNo) + '\')';
      await api(path, { method: 'DELETE' });
    },

    // POST the signature to the OData function
    async saveSignature(transactionType, documentNo, base64Image) {
      base64Image = String(base64Image || '');
      const comma = base64Image.indexOf(',');
      if (comma >= 0) base64Image = base64Image.slice(comma + 1);

      const path = apiBase + '/ODataV4/TreasureSignature_UploadSignatureByKey';
      const body = {
        transactionType: String(transactionType),
        documentNo: String(documentNo),
        base64Image: base64Image
      };
      const res = await api(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      return res;
    }
  };
};