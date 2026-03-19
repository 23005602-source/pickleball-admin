const https = require('https');
const sb = require('./supabase');

const SCRIPT_URL = process.env.APPS_SCRIPT_URL || 'https://script.google.com/macros/s/AKfycbwS4T_tuWWGCUqx_zUWLXFvhJKtQ5qegFVfX8tlSw6OzRnj0zlPedNqlL8pGfK_05wC/exec';

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': 'no-store'
};

let configCache     = null;
let configCacheTime = 0;
const CONFIG_TTL    = 10 * 60 * 1000;

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        fetchUrl(res.headers.location).then(resolve).catch(reject);
        return;
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

function fetchPost(url, bodyObj, redirectCount) {
  redirectCount = redirectCount || 0;
  if (redirectCount > 5) return Promise.reject(new Error('Too many redirects'));
  return new Promise((resolve, reject) => {
    const bodyStr = JSON.stringify(bodyObj);
    const urlObj  = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      path:     urlObj.pathname + urlObj.search,
      method:   'POST',
      headers:  {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(bodyStr),
        'User-Agent':     'Mozilla/5.0'
      }
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          fetchPost(res.headers.location, bodyObj, redirectCount + 1).then(resolve).catch(reject);
        } else { resolve(data); }
      });
    });
    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

function sanitizeStr(val, maxLen = 200) {
  if (!val) return '';
  return String(val).trim().slice(0, maxLen).replace(/[<>"']/g, '');
}
function sanitizeNum(val, defaultVal = 0) {
  const n = Number(val);
  return isFinite(n) && n >= 0 ? n : defaultVal;
}

// Helper: ghi song song GAS (backup, không block response)
function gasBackup(url) {
  fetchUrl(url).catch(e => console.warn('[GAS backup failed]', e.message));
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };
  const params = event.queryStringParameters || {};

  let bodyParams = {};
  if (event.body && event.httpMethod === 'POST') {
    try {
      const raw = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
      try { bodyParams = JSON.parse(raw); } catch(_) {
        try { bodyParams = Object.fromEntries(new URLSearchParams(raw)); } catch(_) {}
      }
    } catch(_) {}
  }

  const action    = params.action || bodyParams.action || 'write';
  const allParams = { ...bodyParams, ...params };

  // ═══════════════════════════════════════════
  // CONFIG — Supabase primary, GAS backup
  // ═══════════════════════════════════════════
  if (action === 'readConfig') {
    const now = Date.now();
    if (configCache && (now - configCacheTime) < CONFIG_TTL) {
      return { statusCode: 200, headers: { ...CORS, 'X-Cache': 'HIT' }, body: JSON.stringify(configCache) };
    }
    try {
      const cfg = await sb.sbReadConfig();
      if (cfg && Object.keys(cfg).length > 0) {
        configCache     = cfg;
        configCacheTime = Date.now();
        return { statusCode: 200, headers: { ...CORS, 'X-Cache': 'SB' }, body: JSON.stringify(cfg) };
      }
    } catch(e) { console.warn('[SB readConfig]', e.message); }
    // Fallback GAS
    try {
      const data = await fetchUrl(SCRIPT_URL + '?action=readConfig');
      configCache     = JSON.parse(data);
      configCacheTime = Date.now();
      return { statusCode: 200, headers: { ...CORS, 'X-Cache': 'GAS' }, body: data };
    } catch(err) {
      return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: err.message }) };
    }
  }

  if (action === 'saveConfig' || action === 'writeConfig') {
    configCache = null;
    configCacheTime = 0;
    const allowed = ['uiVenueName','uiVenueAddress','uiVenuePhone','uiVenueCourtCount','uiPageTitle'];
    const kvPairs = {};
    allowed.forEach(k => { if (params[k] !== undefined) kvPairs[k] = params[k]; });
    // Supabase upsert
    try {
      for (const [k, v] of Object.entries(kvPairs)) {
        await fetch(`${process.env.SUPABASE_URL || 'https://uvtstwnighmmzuhfissy.supabase.co'}/rest/v1/config`, {
          method: 'POST',
          headers: {
            'apikey': process.env.SUPABASE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV2dHN0d25pZ2htbXp1aGZpc3N5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM4NjIwNjQsImV4cCI6MjA4OTQzODA2NH0.lALuTksG4DxMHRnwqanaYTEoMlLD41ebzyhXziACx5c',
            'Authorization': `Bearer ${process.env.SUPABASE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV2dHN0d25pZ2htbXp1aGZpc3N5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM4NjIwNjQsImV4cCI6MjA4OTQzODA2NH0.lALuTksG4DxMHRnwqanaYTEoMlLD41ebzyhXziACx5c'}`,
            'Content-Type': 'application/json',
            'Prefer': 'resolution=merge-duplicates'
          },
          body: JSON.stringify({ key: k, value: String(v) })
        });
      }
    } catch(e) { console.warn('[SB writeConfig]', e.message); }
    // Backup GAS
    const cfgPairs = allowed.map(k => `${k}=${encodeURIComponent(params[k] || '')}`).join('&');
    gasBackup(`${SCRIPT_URL}?action=writeConfig&${cfgPairs}`);
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true, source: 'supabase' }) };
  }

  // ═══════════════════════════════════════════
  // READ BOOKINGS — Supabase primary
  // ═══════════════════════════════════════════
  if (action === 'read' || action === 'readJson') {
    try {
      const rows = await sb.sbReadBookings(params.date || null);
      return { statusCode: 200, headers: CORS, body: JSON.stringify({ data: rows, source: 'supabase' }) };
    } catch(e) {
      console.warn('[SB read]', e.message);
      // Fallback GAS
      try {
        const url = params.date
          ? `${SCRIPT_URL}?action=readJson&date=${encodeURIComponent(params.date)}`
          : `${SCRIPT_URL}?action=read`;
        const data = await fetchUrl(url);
        return { statusCode: 200, headers: CORS, body: data };
      } catch(e2) {
        return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: e2.message }) };
      }
    }
  }

  // ═══════════════════════════════════════════
  // WRITE BOOKING — Supabase primary + GAS backup
  // ═══════════════════════════════════════════
  if (action === 'write') {
    const clean = {
      id:          sanitizeStr(params.id, 20),
      name:        sanitizeStr(params.name, 100),
      phone:       sanitizeStr(params.phone, 15),
      date:        sanitizeStr(params.date, 20),
      court:       sanitizeStr(params.court, 30),
      startHour:   sanitizeStr(params.startHour, 10),
      duration:    String(sanitizeNum(params.duration, 1)),
      players:     String(sanitizeNum(params.players, 4)),
      rackets:     String(sanitizeNum(params.rackets, 0)),
      courtTotal:  String(sanitizeNum(params.courtTotal, 0)),
      racketTotal: String(sanitizeNum(params.racketTotal, 0)),
      total:       String(sanitizeNum(params.total, 0)),
      status:      ['pending','confirmed','cancelled'].includes(params.status) ? params.status : 'pending',
      payment:     (() => { const p = String(params.payment || '').trim(); if (!p) return 'cash'; if (p === 'qr' || p === 'transfer' || p.toLowerCase().includes('khoản')) return 'banking'; return ['cash','banking'].includes(p) ? p : 'cash'; })(),
      note:        sanitizeStr(params.note, 300),
    };
    if (!clean.name || !clean.phone || !clean.date || !clean.court) {
      return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Missing required fields' }) };
    }
    try {
      const result = await sb.sbWriteBooking(clean);
      // Backup GAS không block
      gasBackup(`${SCRIPT_URL}?${new URLSearchParams(clean).toString()}`);
      return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true, data: result, source: 'supabase' }) };
    } catch(e) {
      console.warn('[SB write]', e.message);
      // Fallback GAS
      try {
        const data = await fetchUrl(`${SCRIPT_URL}?${new URLSearchParams(clean).toString()}`);
        return { statusCode: 200, headers: CORS, body: data };
      } catch(e2) {
        return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: e2.message }) };
      }
    }
  }

  // ═══════════════════════════════════════════
  // CHECK SLOT — Supabase
  // ═══════════════════════════════════════════
  if (action === 'checkSlot') {
    try {
      const rows = await sb.sbCheckSlot(params.date, params.court, params.hours);
      return { statusCode: 200, headers: CORS, body: JSON.stringify({ slots: rows, source: 'supabase' }) };
    } catch(e) {
      const query = new URLSearchParams({ action:'checkSlot', date:params.date||'', court:params.court||'', hours:params.hours||'' }).toString();
      try {
        const data = await fetchUrl(`${SCRIPT_URL}?${query}`);
        return { statusCode: 200, headers: CORS, body: data };
      } catch(e2) {
        return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: e2.message }) };
      }
    }
  }

  // ═══════════════════════════════════════════
  // FNB MENU — Supabase primary
  // ═══════════════════════════════════════════
  if (action === 'readFnbMenu') {
    try {
      const rows = await sb.sbReadFnbMenu(params.customerOnly === 'true');
      return { statusCode: 200, headers: CORS, body: JSON.stringify({ items: rows, source: 'supabase' }) };
    } catch(e) {
      try {
        const data = await fetchUrl(`${SCRIPT_URL}?action=readFnbMenu${params.customerOnly ? '&customerOnly=true' : ''}`);
        return { statusCode: 200, headers: CORS, body: data };
      } catch(e2) { return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: e2.message }) }; }
    }
  }

  if (action === 'saveFnbItem') {
    try {
      const result = await sb.sbSaveFnbItem(allParams);
      gasBackup(`${SCRIPT_URL}?${new URLSearchParams({ action:'saveFnbItem', ...allParams }).toString()}`);
      return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true, data: result, source: 'supabase' }) };
    } catch(e) {
      const hasImg = allParams.img && String(allParams.img).length > 100;
      try {
        const data = hasImg ? await fetchPost(`${SCRIPT_URL}?action=saveFnbItem`, allParams) : await fetchUrl(`${SCRIPT_URL}?${new URLSearchParams(allParams).toString()}`);
        return { statusCode: 200, headers: CORS, body: data };
      } catch(e2) { return { statusCode: 502, headers: CORS, body: JSON.stringify({ error: e2.message }) }; }
    }
  }

  if (action === 'deleteFnbItem') {
    try {
      await sb.sbDeleteFnbItem(params.id);
      gasBackup(`${SCRIPT_URL}?action=deleteFnbItem&id=${encodeURIComponent(params.id)}`);
      return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true, source: 'supabase' }) };
    } catch(e) {
      try {
        const data = await fetchUrl(`${SCRIPT_URL}?action=deleteFnbItem&id=${encodeURIComponent(params.id)}`);
        return { statusCode: 200, headers: CORS, body: data };
      } catch(e2) { return { statusCode: 502, headers: CORS, body: JSON.stringify({ error: e2.message }) }; }
    }
  }

  // ═══════════════════════════════════════════
  // FNB ORDERS — Supabase primary
  // ═══════════════════════════════════════════
  if (action === 'readFnbOrders') {
    try {
      const rows = await sb.sbReadFnbOrders();
      return { statusCode: 200, headers: CORS, body: JSON.stringify({ orders: rows, source: 'supabase' }) };
    } catch(e) {
      try {
        const data = await fetchUrl(`${SCRIPT_URL}?action=readFnbOrders`);
        return { statusCode: 200, headers: CORS, body: data };
      } catch(e2) { return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: e2.message }) }; }
    }
  }

  if (action === 'submitFnbOrder') {
    try {
      const result = await sb.sbSubmitFnbOrder(allParams);
      gasBackup(`${SCRIPT_URL}?${new URLSearchParams({ action:'submitFnbOrder', ...params }).toString()}`);
      return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true, data: result, source: 'supabase' }) };
    } catch(e) {
      try {
        const data = await fetchUrl(`${SCRIPT_URL}?${new URLSearchParams(params).toString()}`);
        return { statusCode: 200, headers: CORS, body: data };
      } catch(e2) { return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: e2.message }) }; }
    }
  }

  if (action === 'updateFnbOrderStatus') {
    try {
      await sb.sbUpdateFnbOrderStatus(params.id, params.status);
      gasBackup(`${SCRIPT_URL}?${new URLSearchParams(params).toString()}`);
      return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true, source: 'supabase' }) };
    } catch(e) {
      try {
        const data = await fetchUrl(`${SCRIPT_URL}?${new URLSearchParams(params).toString()}`);
        return { statusCode: 200, headers: CORS, body: data };
      } catch(e2) { return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: e2.message }) }; }
    }
  }

  // ═══════════════════════════════════════════
  // UPDATE STATUS — GAS primary + sync Supabase member
  // ═══════════════════════════════════════════
  if (action === 'updateStatus') {
    const q = new URLSearchParams(params).toString();
    try {
      const data = await fetchUrl(`${SCRIPT_URL}?${q}`);
      let parsed = {};
      try { parsed = JSON.parse(data); } catch(_) {}

      // Nếu confirm booking → sync member spending lên Supabase
      if (params.status === 'confirmed' && parsed.member && parsed.member.phone) {
        try {
          const phone = parsed.member.phone;
          const sbRows = await sb.sbGetMember(phone);
          if (sbRows) {
            // Member đã có → update tier + total_spent
            await fetch(`${process.env.SUPABASE_URL || 'https://uvtstwnighmmzuhfissy.supabase.co'}/rest/v1/members?phone=eq.${encodeURIComponent(phone)}`, {
              method: 'PATCH',
              headers: {
                'apikey': process.env.SUPABASE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV2dHN0d25pZ2htbXp1aGZpc3N5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM4NjIwNjQsImV4cCI6MjA4OTQzODA2NH0.lALuTksG4DxMHRnwqanaYTEoMlLD41ebzyhXziACx5c',
                'Authorization': `Bearer ${process.env.SUPABASE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV2dHN0d25pZ2htbXp1aGZpc3N5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM4NjIwNjQsImV4cCI6MjA4OTQzODA2NH0.lALuTksG4DxMHRnwqanaYTEoMlLD41ebzyhXziACx5c'}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                tier:        parsed.member.tier        || sbRows.tier,
                total_spent: parsed.member.totalSpent  || sbRows.total_spent,
              })
            });
          } else {
            // Member chưa có trong Supabase → tạo mới
            await sb.sbRegisterMember({
              name:  parsed.member.name  || '',
              phone: parsed.member.phone || '',
              email: parsed.member.email || '',
            });
          }
        } catch(syncErr) {
          console.warn('[SB] member sync after confirm:', syncErr.message);
        }
      }

      // Nếu cancelled booking đã confirmed → trừ lại spending trong Supabase
      if (params.status === 'cancelled' && parsed.member && parsed.member.phone) {
        try {
          const phone = parsed.member.phone;
          const sbMember = await sb.sbGetMember(phone);
          if (sbMember) {
            await fetch(`${process.env.SUPABASE_URL || 'https://uvtstwnighmmzuhfissy.supabase.co'}/rest/v1/members?phone=eq.${encodeURIComponent(phone)}`, {
              method: 'PATCH',
              headers: {
                'apikey': process.env.SUPABASE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV2dHN0d25pZ2htbXp1aGZpc3N5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM4NjIwNjQsImV4cCI6MjA4OTQzODA2NH0.lALuTksG4DxMHRnwqanaYTEoMlLD41ebzyhXziACx5c',
                'Authorization': `Bearer ${process.env.SUPABASE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV2dHN0d25pZ2htbXp1aGZpc3N5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM4NjIwNjQsImV4cCI6MjA4OTQzODA2NH0.lALuTksG4DxMHRnwqanaYTEoMlLD41ebzyhXziACx5c'}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                tier:        parsed.member.tier       || sbMember.tier,
                total_spent: parsed.member.totalSpent || sbMember.total_spent,
              })
            });
          }
        } catch(syncErr) {
          console.warn('[SB] member sync after cancel:', syncErr.message);
        }
      }

      return { statusCode: 200, headers: CORS, body: data };
    } catch(e) {
      return { statusCode: 502, headers: CORS, body: JSON.stringify({ error: e.message }) };
    }
  }

  // ═══════════════════════════════════════════
  // MEMBERSHIP — vẫn qua GAS (có OTP/email logic)
  // ═══════════════════════════════════════════
  if (['registerMember','getMember','addPoints','loginMember','resetMemberPass','updateMemberMonthlySpent',
       'memberOtp','verifyMemberOtp','useVoucher'].includes(action)) {
    const q = new URLSearchParams(params).toString();
    try {
      const data = await fetchUrl(`${SCRIPT_URL}?${q}`);
      // Nếu getMember thành công, sync sang Supabase
      if (action === 'getMember') {
        try {
          const parsed = JSON.parse(data);
          if (parsed && parsed.phone) {
            const existing = await sb.sbGetMember(parsed.phone);
            if (!existing) await sb.sbRegisterMember(parsed);
          }
        } catch(_) {}
      }
      return { statusCode: 200, headers: CORS, body: data };
    } catch(e) {
      return { statusCode: 502, headers: CORS, body: JSON.stringify({ error: e.message }) };
    }
  }

  // ═══════════════════════════════════════════
  // Các actions khác — pass-through GAS
  // ═══════════════════════════════════════════
  const url = `${SCRIPT_URL}?${new URLSearchParams(params).toString()}`;
  try {
    const data = await fetchUrl(url);
    return { statusCode: 200, headers: CORS, body: data };
  } catch(err) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: err.message }) };
  }
};
