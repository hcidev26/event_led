// LED Welcome — QR check-in -> man hinh LED chao mung
// Chay: npm install && npm start   (PORT=3000; ADMIN_USER / ADMIN_PASS = tai khoan mac dinh lan dau)
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const QRCode = require('qrcode');

const PORT = Number(process.env.PORT) || 3000;
const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const DATA_DIR = process.env.DATA_DIR || ROOT;          // Docker: /data (volume)
const UPLOADS = path.join(DATA_DIR, 'uploads');
const DATA_FILE = path.join(DATA_DIR, 'data.json');
const HOST_IP = (process.env.HOST_IP || '').trim();       // IP may host khi chay trong Docker
const PUBLIC_URL = (process.env.PUBLIC_URL || '').trim(); // link check-in co dinh (domain)
const PUBLIC_PORT = Number(process.env.PUBLIC_PORT) || PORT;

fs.mkdirSync(UPLOADS, { recursive: true });

const DEFAULT_CONFIG = {
  // Noi dung man hinh LED — moi dong deu dung duoc {name}
  headline: 'SỰ KIỆN 2026',
  greeting: 'CHÀO MỪNG',
  nameFormat: '{name}',
  subline: 'đã đến với sự kiện của chúng tôi',
  emptyMessage: 'Quét mã QR để check-in',

  // Thoi gian (giay)
  newDuration: 8,       // thoi gian hien 1 nguoi moi quet
  idleEnabled: true,    // khong co ai moi -> chay lai lan luot
  idleDuration: 5,      // thoi gian moi ten khi chay lai
  idleOrder: 'newest',  // newest | oldest | random
  idleLimit: 0,         // 0 = tat ca, N = chi N nguoi gan nhat

  // Giao dien
  fontFamily: 'Be Vietnam Pro',
  textColor: '#ffffff',
  accentColor: '#ffd166',
  nameScale: 1,         // he so co chu ten
  textAlign: 'center',  // center | left
  animation: 'zoom',    // zoom | fade | slide | rise
  showClock: false,

  // Background
  bgType: 'gradient',   // color | gradient | image | video
  bgColor: '#0b1020',
  bgGradient: 'linear-gradient(120deg, #0f2027 0%, #203a43 50%, #2c5364 100%)',
  bgImage: '',
  bgVideo: '',
  bgFit: 'cover',       // cover | contain | fill
  bgOverlay: 0.35,      // lop toi phu len background (0-1)

  // QR
  qrShow: true,
  qrPosition: 'right',  // right | left | bottom-right | bottom-left
  qrSize: 22,           // % chieu cao man hinh
  qrCaption: 'Quét mã để check-in',
  publicUrl: '',        // de trong = tu dung IP LAN

  // Trang check-in tren dien thoai
  formTitle: 'Check-in sự kiện',
  formSubtitle: 'Nhập họ tên của bạn để hiển thị lời chào trên màn hình',
  formPlaceholder: 'Họ và tên',
  formButton: 'Gửi',
  formThanks: 'Cảm ơn {name}! Hãy nhìn lên màn hình nhé 🎉',
  maxNameLength: 40,

  // Kich thuoc LED (chi de xem truoc trong trang admin)
  screenWidthM: 8,
  screenHeightM: 3,
};

// ---------- storage ----------
let db = { config: { ...DEFAULT_CONFIG }, guests: [], auth: null };
try {
  const saved = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  db.config = { ...DEFAULT_CONFIG, ...(saved.config || {}) };
  db.guests = Array.isArray(saved.guests) ? saved.guests : [];
  db.auth = saved.auth || null;
} catch { /* first run */ }

// ---------- dang nhap ----------
function hashPass(pass, salt) { return crypto.scryptSync(String(pass), salt, 64).toString('hex'); }
function setPassword(user, pass) { const salt = crypto.randomBytes(16).toString('hex'); db.auth = { user, salt, hash: hashPass(pass, salt) }; }
if (!db.auth) { setPassword(process.env.ADMIN_USER || 'admin', process.env.ADMIN_PASS || 'admin123'); setTimeout(() => save(), 0); }
function checkPassword(user, pass) {
  if (!db.auth || user !== db.auth.user) return false;
  const a = Buffer.from(hashPass(pass, db.auth.salt), 'hex'), b = Buffer.from(db.auth.hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
const SESSION_MS = 7 * 24 * 3600 * 1000;
const sessions = new Map(); // token -> het han
function getCookie(req, name) {
  const m = (req.headers.cookie || '').match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)'));
  return m ? decodeURIComponent(m[1]) : '';
}
function isLoggedIn(req) {
  const t = getCookie(req, 'sid'); const exp = sessions.get(t);
  if (!exp) return false;
  if (exp < Date.now()) { sessions.delete(t); return false; }
  return true;
}
const loginFails = new Map(); // IP -> { n, until }

let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.writeFile(DATA_FILE + '.tmp', JSON.stringify(db, null, 2), (err) => {
      if (!err) fs.rename(DATA_FILE + '.tmp', DATA_FILE, () => {});
    });
  }, 200);
}

// ---------- realtime (Server-Sent Events) ----------
const clients = new Set();
function broadcast(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) res.write(msg);
}
setInterval(() => { for (const res of clients) res.write(': ping\n\n'); }, 20000);

// ---------- helpers ----------
function lanIPs() {
  const out = HOST_IP ? [HOST_IP] : [];
  if (HOST_IP || process.env.DATA_DIR === '/data') return out; // trong container: IP noi bo vo nghia
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list || []) if (i.family === 'IPv4' && !i.internal) out.push(i.address);
  }
  return out;
}
function checkinUrl(req) {
  if (db.config.publicUrl) return db.config.publicUrl.trim();
  if (PUBLIC_URL) return PUBLIC_URL;
  const ip = lanIPs()[0];
  const host = ip ? `${ip}:${PUBLIC_PORT}` : (req.headers.host || `localhost:${PUBLIC_PORT}`);
  return `http://${host}/checkin`;
}
function send(res, code, body, type = 'application/json; charset=utf-8') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}
function readBody(req, limit = 1e6) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new Error('too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
function cleanName(s, max) {
  return String(s || '').replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
}
const publicGuests = () => db.guests.filter((g) => !g.hidden).map(({ id, name, at }) => ({ id, name, at }));

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.ico': 'image/x-icon',
};
function serveFile(req, res, file) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, 'Not found', 'text/plain');
    const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
    const range = req.headers.range;
    if (range && /^bytes=/.test(range)) { // ho tro tua video
      const [s, e] = range.replace('bytes=', '').split('-');
      const start = Number(s) || 0, end = e ? Number(e) : st.size - 1;
      res.writeHead(206, { 'Content-Type': type, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1 });
      return fs.createReadStream(file, { start, end }).pipe(res);
    }
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': st.size, 'Accept-Ranges': 'bytes' });
    fs.createReadStream(file).pipe(res);
  });
}

const lastCheckin = new Map(); // chong spam theo IP

// ---------- routes ----------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  try {
    // pages
    if (p === '/' ) { res.writeHead(302, { Location: '/admin' }); return res.end(); }
    if (p === '/admin' && !isLoggedIn(req)) { res.writeHead(302, { Location: '/login' }); return res.end(); }
    if (p === '/login' && isLoggedIn(req)) { res.writeHead(302, { Location: '/admin' }); return res.end(); }
    if (['/display', '/checkin', '/admin', '/login'].includes(p)) return serveFile(req, res, path.join(PUBLIC, p.slice(1) + '.html'));
    if (p.endsWith('.html')) return send(res, 404, 'Not found', 'text/plain'); // khong cho vao thang /admin.html

    if (p === '/api/login' && req.method === 'POST') {
      const ip = req.socket.remoteAddress; const f = loginFails.get(ip);
      if (f && f.until > Date.now()) return send(res, 429, { error: 'Sai quá nhiều lần, thử lại sau ' + Math.ceil((f.until - Date.now()) / 1000) + ' giây' });
      let body; try { body = JSON.parse((await readBody(req, 10000)).toString()); } catch { return send(res, 400, { error: 'Dữ liệu không hợp lệ' }); }
      if (!checkPassword(String(body.user || '').trim(), String(body.pass || ''))) {
        const n = (f ? f.n : 0) + 1;
        loginFails.set(ip, { n, until: n >= 5 ? Date.now() + 60000 : 0 });
        return send(res, 401, { error: 'Sai tên đăng nhập hoặc mật khẩu' });
      }
      loginFails.delete(ip);
      const token = crypto.randomBytes(32).toString('hex');
      sessions.set(token, Date.now() + SESSION_MS);
      res.setHeader('Set-Cookie', `sid=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_MS / 1000}`);
      return send(res, 200, { ok: true });
    }
    if (p === '/api/logout' && req.method === 'POST') {
      sessions.delete(getCookie(req, 'sid'));
      res.setHeader('Set-Cookie', 'sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
      return send(res, 200, { ok: true });
    }

    if (p === '/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      res.write('retry: 2000\n\n');
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }

    if (p === '/api/state' && req.method === 'GET') {
      return send(res, 200, { config: db.config, guests: publicGuests(), checkinUrl: checkinUrl(req) });
    }
    if (p === '/api/form' && req.method === 'GET') {
      const c = db.config;
      return send(res, 200, { formTitle: c.formTitle, formSubtitle: c.formSubtitle, formPlaceholder: c.formPlaceholder, formButton: c.formButton, formThanks: c.formThanks, maxNameLength: c.maxNameLength, fontFamily: c.fontFamily, accentColor: c.accentColor, headline: c.headline });
    }
    if (p === '/api/qr.svg') {
      const svg = await QRCode.toString(url.searchParams.get('url') || checkinUrl(req), { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
      return send(res, 200, svg, 'image/svg+xml');
    }

    if (p === '/api/checkin' && req.method === 'POST') {
      const ip = req.socket.remoteAddress;
      const now = Date.now();
      if (now - (lastCheckin.get(ip) || 0) < 3000) return send(res, 429, { error: 'Vui lòng đợi vài giây rồi thử lại.' });
      let body; try { body = JSON.parse((await readBody(req, 10000)).toString()); } catch { return send(res, 400, { error: 'Dữ liệu không hợp lệ' }); }
      const name = cleanName(body.name, db.config.maxNameLength || 40);
      if (!name) return send(res, 400, { error: 'Vui lòng nhập họ tên' });
      lastCheckin.set(ip, now);
      const guest = { id: crypto.randomUUID(), name, at: now };
      db.guests.push(guest); save();
      broadcast('guest', guest);
      broadcast('guests', publicGuests());
      return send(res, 200, { ok: true, name });
    }

    // ----- admin -----
    if (p.startsWith('/api/admin/')) {
      if (!isLoggedIn(req)) return send(res, 401, { error: 'Chưa đăng nhập' });

      if (p === '/api/admin/account' && req.method === 'POST') {
        const body = JSON.parse((await readBody(req)).toString());
        const user = String(body.user || '').trim();
        if (!checkPassword(db.auth.user, String(body.oldPass || ''))) return send(res, 400, { error: 'Mật khẩu hiện tại không đúng' });
        if (!user) return send(res, 400, { error: 'Tên đăng nhập không được trống' });
        const newPass = String(body.newPass || '');
        if (newPass && newPass.length < 6) return send(res, 400, { error: 'Mật khẩu mới cần ít nhất 6 ký tự' });
        if (newPass) setPassword(user, newPass); else db.auth.user = user;
        // dang xuat cac phien khac, giu phien hien tai
        const cur = getCookie(req, 'sid'); for (const t of sessions.keys()) if (t !== cur) sessions.delete(t);
        save();
        return send(res, 200, { ok: true });
      }

      if (p === '/api/admin/info') return send(res, 200, { ips: lanIPs(), port: PUBLIC_PORT, checkinUrl: checkinUrl(req), user: db.auth.user, guests: db.guests, defaults: DEFAULT_CONFIG });

      if (p === '/api/admin/config' && req.method === 'POST') {
        const patch = JSON.parse((await readBody(req)).toString());
        for (const k of Object.keys(patch)) if (k in DEFAULT_CONFIG) db.config[k] = patch[k];
        save(); broadcast('config', db.config);
        return send(res, 200, { ok: true, config: db.config });
      }
      if (p === '/api/admin/config/reset' && req.method === 'POST') {
        db.config = { ...DEFAULT_CONFIG }; save(); broadcast('config', db.config);
        return send(res, 200, { ok: true, config: db.config });
      }
      if (p === '/api/admin/test' && req.method === 'POST') { // gui ten thu (khong luu)
        const body = JSON.parse((await readBody(req)).toString() || '{}');
        broadcast('guest', { id: 'test-' + Date.now(), name: cleanName(body.name, 60) || 'Nguyễn Văn A', at: Date.now(), test: true });
        return send(res, 200, { ok: true });
      }
      if (p === '/api/admin/guest' && req.method === 'POST') { // them tay / an / xoa / hien lai
        const body = JSON.parse((await readBody(req)).toString());
        if (body.action === 'add') {
          const name = cleanName(body.name, 60);
          if (name) { const g = { id: crypto.randomUUID(), name, at: Date.now() }; db.guests.push(g); if (body.show) broadcast('guest', g); }
        } else if (body.action === 'delete') db.guests = db.guests.filter((g) => g.id !== body.id);
        else if (body.action === 'hide' || body.action === 'unhide') { const g = db.guests.find((x) => x.id === body.id); if (g) g.hidden = body.action === 'hide'; }
        else if (body.action === 'replay') { const g = db.guests.find((x) => x.id === body.id); if (g) broadcast('guest', { ...g, replay: true }); }
        else if (body.action === 'clear') db.guests = [];
        save(); broadcast('guests', publicGuests());
        return send(res, 200, { ok: true, guests: db.guests });
      }
      if (p === '/api/admin/upload' && req.method === 'POST') {
        const orig = String(url.searchParams.get('name') || 'file');
        const ext = path.extname(orig).toLowerCase();
        if (!['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.mp4', '.webm', '.mov'].includes(ext)) return send(res, 400, { error: 'Chỉ hỗ trợ ảnh (png/jpg/gif/webp/svg) hoặc video (mp4/webm/mov)' });
        const buf = await readBody(req, 500 * 1024 * 1024);
        const fname = Date.now() + '-' + crypto.randomBytes(3).toString('hex') + ext;
        fs.writeFileSync(path.join(UPLOADS, fname), buf);
        return send(res, 200, { ok: true, url: '/uploads/' + fname });
      }
      if (p === '/api/admin/export.csv') {
        const csv = '﻿STT,Họ tên,Thời gian\n' + db.guests.map((g, i) => `${i + 1},"${g.name.replace(/"/g, '""')}",${new Date(g.at).toLocaleString('vi-VN')}`).join('\n');
        res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="khach-checkin.csv"' });
        return res.end(csv);
      }
      return send(res, 404, { error: 'not found' });
    }

    // static
    const base = p.startsWith('/uploads/') ? UPLOADS : PUBLIC;
    const rel = p.startsWith('/uploads/') ? p.slice('/uploads/'.length) : p.slice(1);
    const file = path.normalize(path.join(base, decodeURIComponent(rel)));
    if (!file.startsWith(base)) return send(res, 403, 'Forbidden', 'text/plain');
    return serveFile(req, res, file);
  } catch (e) {
    console.error(e);
    return send(res, 500, { error: String(e.message || e) });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  const ips = lanIPs();
  console.log('\n  LED Welcome đang chạy');
  console.log(`  Admin   : http://localhost:${PUBLIC_PORT}/admin`);
  console.log(`  Màn LED : http://localhost:${PUBLIC_PORT}/display`);
  console.log(`  Check-in: ${checkinUrl({ headers: {} })}`);
  console.log(`  Tài khoản admin: ${db.auth.user}` + (process.env.ADMIN_PASS ? '' : ' (mặc định lần đầu: admin / admin123 — nhớ đổi)'));
  console.log('');
});
