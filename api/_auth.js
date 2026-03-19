// ============================================================
// /api/auth — OTP Login (Dual mode: local whitelist + GAS)
// ============================================================
const crypto  = require('crypto');
const https   = require('https');

const SCRIPT_URL = process.env.APPS_SCRIPT_URL ||
  'https://script.google.com/macros/s/AKfycbz9AzGjWDDcPT74Qb3Z7S87gQXQ25BNTIz1ohy7l2h6fDiaMDtW8APX8giExoApQwaP/exec';
const SUPER_PASS = process.env.SUPER_PASSWORD || 'admin2026';
const JWT_SECRET = process.env.JWT_SECRET      || 'thuytien-pk-2026-xK9mQ';

// ── Admin whitelist (fallback nếu GAS sheet Admins chưa setup) ──
// Set qua Netlify env var ADMIN_EMAILS = "email1@gmail.com,email2@gmail.com"
// Format: "email:role:name,email2:role2:name2"  hoặc chỉ "email1,email2" (default role=ADMIN)
function getLocalAdmins() {
  const raw = process.env.ADMIN_EMAILS || '';
  if (!raw) return {};
  const map = {};
  raw.split(',').forEach(entry => {
    const parts = entry.trim().split(':');
    const email = parts[0].trim().toLowerCase();
    if (!email) return;
    map[email] = {
      role: (parts[1] || 'ADMIN').trim().toUpperCase(),
      name: (parts[2] || '').trim() || email.split('@')[0]
    };
  });
  return map;
}

// OTP store in-memory (per Netlify function instance, TTL 5 min)
const otpStore = {};

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        fetchUrl(res.headers.location).then(resolve).catch(reject);
        return;
      }
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

function signToken(payload) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body   = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig    = crypto.createHmac('sha256', JWT_SECRET)
                       .update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

function verifyToken(token) {
  try {
    const [header, body, sig] = token.split('.');
    const expected = crypto.createHmac('sha256', JWT_SECRET)
                           .update(`${header}.${body}`).digest('base64url');
    if (sig !== expected) return null;
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (payload.exp && Date.now() > payload.exp) return null;
    return payload;
  } catch { return null; }
}

function genOtp() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function buildOtpEmailHtml(otp, email) {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#0D1117;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0D1117;padding:32px 16px">
<tr><td align="center"><table width="100%" style="max-width:420px;background:#161B22;border-radius:14px;border:1px solid #30363D;overflow:hidden">
<tr><td style="padding:24px;text-align:center;border-bottom:1px solid #21262D">
  <div style="font-size:11px;font-weight:700;letter-spacing:2px;color:#2ECC71;text-transform:uppercase;margin-bottom:4px">THUY TIEN PICKLEBALL</div>
  <div style="font-size:11px;color:#8B949E">Ma OTP dang nhap trang quan ly</div>
</td></tr>
<tr><td style="padding:28px">
  <p style="margin:0 0 8px;font-size:13px;color:#8B949E">Ma OTP cho <strong style="color:#E6EDF3">${email}</strong>:</p>
  <div style="background:#0D1117;border:1px solid #2ECC7155;border-radius:10px;padding:22px;text-align:center;margin:12px 0">
    <span style="font-family:'Courier New',monospace;font-size:40px;font-weight:700;letter-spacing:12px;color:#2ECC71">${otp}</span>
  </div>
  <p style="margin:0;font-size:11px;color:#8B949E;text-align:center">Co hieu luc 5 phut. Khong chia se ma nay voi bat ky ai.</p>
</td></tr>
<tr><td style="background:#0D1117;padding:12px;text-align:center;border-top:1px solid #21262D">
  <p style="margin:0;font-size:10px;color:#484F58">Thuy Tien Pickleball &bull; Trang quan ly noi bo</p>
</td></tr>
</table></td></tr></table></body></html>`;
}

async function sendOtpViaGas(to, otp) {
  const subject = encodeURIComponent('Ma OTP dang nhap - Thuy Tien Pickleball');
  const html    = encodeURIComponent(buildOtpEmailHtml(otp, to));
  const url     = `${SCRIPT_URL}?action=sendHtmlEmail&to=${encodeURIComponent(to)}&subject=${subject}&html=${html}`;
  await fetchUrl(url);
}

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };

  const body   = JSON.parse(event.body || '{}');
  const action = body.action;

  // ── REQUEST OTP ──
  if (action === 'requestOtp') {
    const email = (body.email || '').trim().toLowerCase();
    if (!email) return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Missing email' }) };

    const localAdmins = getLocalAdmins();

    // Mode 1: Email có trong ADMIN_EMAILS env var → sinh OTP locally, gửi qua GAS
    if (localAdmins[email]) {
      const otp = genOtp();
      otpStore[email] = { otp, exp: Date.now() + 5 * 60 * 1000, role: localAdmins[email].role, name: localAdmins[email].name };
      try {
        await sendOtpViaGas(email, otp);
        return { statusCode: 200, headers: CORS, body: JSON.stringify({ success: true }) };
      } catch(e) {
        // GAS không gửi được email → vẫn trả success nhưng log (OTP lưu trong store)
        console.error('GAS email failed:', e.message);
        // Fallback: trả OTP trong response nếu dev mode
        const devMode = process.env.DEV_MODE === 'true';
        return { statusCode: 200, headers: CORS, body: JSON.stringify({ success: true, ...(devMode ? { _devOtp: otp } : {}) }) };
      }
    }

    // Mode 2: Không có trong env → fallback gọi GAS requestOtp (GAS tự check sheet Admins)
    try {
      const url  = `${SCRIPT_URL}?action=requestOtp&email=${encodeURIComponent(email)}`;
      const data = await fetchUrl(url);
      const res  = JSON.parse(data);
      return { statusCode: res.success ? 200 : 403, headers: CORS, body: JSON.stringify(res) };
    } catch(e) {
      return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'Loi ket noi. Thu lai sau.' }) };
    }
  }

  // ── VERIFY OTP ──
  if (action === 'verifyOtp') {
    const email = (body.email || '').trim().toLowerCase();
    const otp   = (body.otp   || '').trim();
    if (!email || !otp) return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Missing email or otp' }) };

    // Check local OTP store trước
    const stored = otpStore[email];
    if (stored && stored.otp === otp && Date.now() < stored.exp) {
      delete otpStore[email];
      const token = signToken({ role: stored.role, email, name: stored.name, exp: Date.now() + 4 * 60 * 60 * 1000 });
      return { statusCode: 200, headers: CORS, body: JSON.stringify({ success: true, token, role: stored.role }) };
    }

    // Fallback: verify qua GAS
    try {
      const url  = `${SCRIPT_URL}?action=verifyOtp&email=${encodeURIComponent(email)}&otp=${otp}`;
      const data = await fetchUrl(url);
      const res  = JSON.parse(data);
      if (res.valid) {
        const role  = res.role || 'STAFF';
        const name  = res.name || '';
        const token = signToken({ role, email, name, exp: Date.now() + 4 * 60 * 60 * 1000 });
        return { statusCode: 200, headers: CORS, body: JSON.stringify({ success: true, token, role }) };
      }
      return { statusCode: 401, headers: CORS, body: JSON.stringify({ success: false, error: res.error || 'OTP sai hoặc hết hạn' }) };
    } catch(e) {
      return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: e.message }) };
    }
  }

  // ── SUPER ADMIN LOGIN (password) ──
  if (action === 'login' && body.role === 'super') {
    if (body.password === SUPER_PASS) {
      const token = signToken({ role: 'super', exp: Date.now() + 4 * 60 * 60 * 1000 });
      return { statusCode: 200, headers: CORS, body: JSON.stringify({ success: true, token, role: 'super' }) };
    }
    return { statusCode: 401, headers: CORS, body: JSON.stringify({ success: false, error: 'Sai mật khẩu' }) };
  }

  // ── VERIFY TOKEN ──
  if (action === 'verify') {
    const payload = verifyToken(body.token);
    if (payload) return { statusCode: 200, headers: CORS, body: JSON.stringify({ valid: true, role: payload.role }) };
    return { statusCode: 401, headers: CORS, body: JSON.stringify({ valid: false }) };
  }

  // ── DELEGATION OTP: Staff yêu cầu → SUPER đọc OTP cho staff ──
  if (action === 'requestDelegationOtp') {
    const staffEmail = (body.staffEmail || '').trim().toLowerCase();
    const staffName  = body.staffName  || 'Nhân viên';
    if (!staffEmail) return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Missing staffEmail' }) };
    try {
      const url  = `${SCRIPT_URL}?action=sendDelegationOtp&staffEmail=${encodeURIComponent(staffEmail)}&staffName=${encodeURIComponent(staffName)}`;
      const data = await fetchUrl(url);
      const res  = JSON.parse(data);
      return { statusCode: res.success ? 200 : 400, headers: CORS, body: JSON.stringify(res) };
    } catch(e) {
      return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: e.message }) };
    }
  }

  if (action === 'verifyDelegationOtp') {
    const staffEmail = (body.staffEmail || '').trim().toLowerCase();
    const otp        = (body.otp || '').trim();
    if (!staffEmail || !otp) return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Missing fields' }) };
    try {
      const url  = `${SCRIPT_URL}?action=verifyDelegationOtp&staffEmail=${encodeURIComponent(staffEmail)}&otp=${encodeURIComponent(otp)}`;
      const data = await fetchUrl(url);
      const res  = JSON.parse(data);
      if (res.valid) {
        const configToken = signToken({ role: 'CONFIG_DELEGATE', staffEmail, exp: Date.now() + 2 * 60 * 60 * 1000 });
        return { statusCode: 200, headers: CORS, body: JSON.stringify({ success: true, configToken }) };
      }
      return { statusCode: 401, headers: CORS, body: JSON.stringify({ success: false, error: res.error || 'OTP sai hoặc hết hạn' }) };
    } catch(e) {
      return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: e.message }) };
    }
  }

  // ── DELEGATION approve/check (giữ nguyên) ──
  if (action === 'approveDelegation') {
    const delToken = body.token || '';
    const payload  = verifyToken(delToken);
    if (!payload || payload.type !== 'delegation') {
      return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Token không hợp lệ hoặc đã hết hạn' }) };
    }
    const configToken = signToken({ role: 'CONFIG_DELEGATE', staffEmail: payload.staffEmail, exp: Date.now() + 2 * 60 * 60 * 1000 });
    try {
      const storeUrl = `${SCRIPT_URL}?action=storeDelegationToken&staffEmail=${encodeURIComponent(payload.staffEmail)}&configToken=${encodeURIComponent(configToken)}`;
      await fetchUrl(storeUrl);
    } catch(e) {
      return { statusCode: 200, headers: CORS, body: JSON.stringify({ success: true, configToken, staffEmail: payload.staffEmail, fallback: true }) };
    }
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ success: true, staffEmail: payload.staffEmail }) };
  }

  if (action === 'checkDelegation') {
    const staffEmail = (body.staffEmail || '').trim().toLowerCase();
    if (!staffEmail) return { statusCode: 200, headers: CORS, body: JSON.stringify({ approved: false }) };
    try {
      const checkUrl = `${SCRIPT_URL}?action=checkDelegationToken&staffEmail=${encodeURIComponent(staffEmail)}`;
      const data = await fetchUrl(checkUrl);
      const res  = JSON.parse(data);
      if (res.approved && res.configToken) {
        return { statusCode: 200, headers: CORS, body: JSON.stringify({ approved: true, configToken: res.configToken }) };
      }
    } catch(e) { /* fall through */ }
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ approved: false }) };
  }

  return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Invalid action' }) };
};
