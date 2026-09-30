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
  const companyPath = config.companyGuid ? ('Companies(' + config.companyGuid + ')/') : '';
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
    let url = urlPath;
    if (useCompanyQuery !== false) {
      url = urlPath + (urlPath.indexOf('?') >= 0 ? '&' : '?') + companyQuery;
    }
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
      const filter = '$expand=treasuryTransactionLines&$filter=transactionType eq \'' + esc(transactionType) + '\' and documentNo eq \'' + esc(documentNo) + '\'';
      // First try root endpoint with ?company= parameter (matches signpadDispatches)
      try {
        const path = treasuryBase + 'treasuryTransactions?' + filter;
        const body = await api(path);
        if (body.value && body.value.length > 0) return body.value[0];
      } catch (e1) {
        console.warn('[bc] getTreasuryTransaction root path failed:', e1.message);
      }

      // Second try with companyPath (e.g. Companies(guid)/)
      if (companyPath) {
        try {
          const path = treasuryBase + companyPath + 'treasuryTransactions?' + filter;
          const body = await api(path);
          if (body.value && body.value.length > 0) return body.value[0];
        } catch (e2) {
          console.warn('[bc] getTreasuryTransaction companyPath failed:', e2.message);
        }
      }

      // Third try with lowercase companies(guid)/
      if (config.companyGuid) {
        try {
          const path = treasuryBase + 'companies(' + config.companyGuid + ')/treasuryTransactions?' + filter;
          const body = await api(path);
          if (body.value && body.value.length > 0) return body.value[0];
        } catch (e3) {
          console.warn('[bc] getTreasuryTransaction lowercase companies path failed:', e3.message);
        }
      }

      throw new Error('No treasury transaction found for ' + transactionType + '/' + documentNo);
    },

    // GET the full list for the monitoring portal picker
    async listTreasuryTransactions() {
      try {
        const path = treasuryBase + 'treasuryTransactions?$expand=treasuryTransactionLines';
        const body = await api(path);
        return body.value || [];
      } catch (e1) {
        if (companyPath) {
          try {
            const path = treasuryBase + companyPath + 'treasuryTransactions?$expand=treasuryTransactionLines';
            const body = await api(path);
            return body.value || [];
          } catch (e2) {}
        }
        return [];
      }
    },

    // GET the open signpad dispatch for a specific station (from the "Take Vendor
    // Signature" action). Dispatches are routed to a station in BC via
    // Signpad Station Users -> user's Station Code, and filtered here by Station_Code.
    async getOpenDispatch(station) {
      try {
        const aliases = new Set();
        if (station) {
          const stClean = station.trim().toUpperCase();
          aliases.add(stClean);
          // Built-in station mappings for CON002 to ensure immediate match
          if (stClean === 'CON002') {
            aliases.add('MD.RAZA');
            aliases.add('DHYEY.ADMIN');
            aliases.add('RAZE');
          }
        }

        // Find any mapped user IDs or names for this station from signpadUsers
        try {
          const userBody = await api(apiBase + '/api/signpad/treasury/v1.0/signpadUsers');
          const uList = userBody.value || [];
          for (const u of uList) {
            const uStation = String(u.Station_Code || '').trim().toUpperCase();
            const uId = String(u.User_ID || '').trim().toUpperCase();
            const uWacom = String(u.Wacom_User_Name || '').trim().toUpperCase();

            if (aliases.has(uStation) || aliases.has(uId) || aliases.has(uWacom)) {
              if (uStation) aliases.add(uStation);
              if (uId) {
                aliases.add(uId);
                if (uId.includes('\\')) aliases.add(uId.split('\\').pop());
              }
              if (uWacom) aliases.add(uWacom);
            }
          }
        } catch (uErr) {
          console.warn('[bc] signpadUsers lookup in getOpenDispatch:', uErr.message);
        }

        // In Business Central, Code fields are uppercase ('OPEN'), but we filter both
        const path = apiBase + '/api/signpad/treasury/v1.0/signpadDispatches?$filter=Status eq \'OPEN\' or Status eq \'Open\'';
        const body = await api(path);
        const list = body.value || [];

        // Sort newest first
        list.sort((a, b) => new Date(b.Assigned_On || 0) - new Date(a.Assigned_On || 0));

        for (const d of list) {
          if (!d.Transaction_Type || !d.Document_No) continue;

          if (aliases.size === 0) {
            return { transactionType: d.Transaction_Type, documentNo: d.Document_No };
          }

          const dStation = String(d.Station_Code || '').trim().toUpperCase();
          const dAssigned = String(d.Assigned_By || '').trim().toUpperCase();
          const dAssignedClean = dAssigned.includes('\\') ? dAssigned.split('\\').pop() : dAssigned;
          const dCreatedBy = String(d.SystemCreatedBy || '').trim().toLowerCase();

          if (
            aliases.has(dStation) ||
            aliases.has(dAssigned) ||
            aliases.has(dAssignedClean) ||
            (station && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(station) && dCreatedBy === station.toLowerCase())
          ) {
            console.log('[bc] Matched open dispatch:', d.Document_No, 'for station:', station);
            return { transactionType: d.Transaction_Type, documentNo: d.Document_No };
          }
        }
        return null;
      } catch (err) {
        console.warn('[bc] getOpenDispatch warning:', err.message);
        return null;
      }
    },

    async getDebugData() {
      const results = {};
      try {
        results.dispatches = (await api(apiBase + '/api/signpad/treasury/v1.0/signpadDispatches')).value || [];
      } catch (e) {
        results.dispatchesError = e.message;
      }
      try {
        results.users = (await api(apiBase + '/api/signpad/treasury/v1.0/signpadUsers')).value || [];
      } catch (e) {
        results.usersError = e.message;
      }
      try {
        results.testOpenDispatchCON002 = await this.getOpenDispatch('CON002');
      } catch (e) {
        results.testOpenDispatchCON002Error = e.message;
      }
      try {
        results.testTx = await this.getTreasuryTransaction('3 CASH USD GL P', 'G04197');
      } catch (e) {
        results.testTxError = e.message;
      }
      return results;
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
    },

    // POST the full signed PDF as an attachment to the treasury transaction.
    async uploadDocument(transactionType, documentNo, fileName, base64Content) {
      const path = apiBase + '/ODataV4/TreasureAttachment_UploadDocumentByKey?company=' + encodeURIComponent(config.companyGuid);
      const body = {
        transactionType: String(transactionType),
        documentNo: String(documentNo),
        fileName: String(fileName),
        base64Content: String(base64Content || '')
      };
      const res = await api(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      }, false);
      return res;
    },

    // Query BC for active Signpad User Setup to validate user login & get station code
    async validateSignpadUser(username, stationCode) {
      try {
        const path = apiBase + '/api/signpad/treasury/v1.0/signpadUsers';
        const body = await api(path);
        const list = body.value || [];
        if (!list || list.length === 0) return { emptySetup: true };

        const searchUser = String(username || '').trim().toLowerCase();
        const searchStation = String(stationCode || '').trim().toLowerCase();

        for (const u of list) {
          const uId = String(u.User_ID || '').trim().toLowerCase();
          const uWacom = String(u.Wacom_User_Name || '').trim().toLowerCase();
          const uStation = String(u.Station_Code || '').trim().toLowerCase();
          const isActive = u.Active !== false;

          const userMatch = searchUser && (uId === searchUser || uWacom === searchUser || uStation === searchUser);
          const stationMatch = !searchStation || (uStation === searchStation || uId === searchStation || uWacom === searchStation);

          if (userMatch && stationMatch) {
            return {
              matched: true,
              userId: u.User_ID,
              wacomUserName: u.Wacom_User_Name,
              stationCode: u.Station_Code,
              active: isActive
            };
          }
        }
        return { notFound: true };
      } catch (err) {
        console.warn('[bc] validateSignpadUser warning:', err.message);
        return { apiError: true, message: err.message };
      }
    }
  };
};