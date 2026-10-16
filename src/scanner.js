'use strict';

// Ağ keşfi — IP Tools'un denetim katmanı. Tasarım gereği yalnız şunları yapar:
//   1) Canlılık: işletim sisteminin ping aracı (çocuk süreç; ham soket yok, yönetici izni gerekmez) ve
//      ARP tablosunun okunması (arp -a / ip neigh). Ping'e yanıt vermeyen ama ARP'ta görünen cihaz da canlı sayılır.
//   2) Servis: ports.js'teki sabit ve kısa listeye standart TCP bağlantı denemesi (bağlandı / bağlanamadı).
//      Bağlantı açılınca en çok: sunucunun kendi karşılama satırı okunur (banner), tek bir "GET /" ile <title> ve
//      Server başlığı alınır (http), TLS el sıkışmasında sunucunun sunduğu sertifikanın konu adı okunur (tls).
//      Özel protokol paketi gönderilmez; bazı portlara (yazıcı 9100, RDP, SMB, veritabanları, RTSP) hiçbir şey yazılmaz.
//   3) Ad: işletim sisteminin ters DNS'i (dns.reverse) ve tek bir mDNS PTR sorgusu (cihazın kendisine, 5353/udp).
//      MAC üreticisi gömülü OUI tablosundan.
// Hız: en çok MAX_CONCURRENCY eşzamanlı iş (ping + bağlantı denemesi ortak havuz), cihaz başına en çok MAX_TIMEOUT_MS,
// tekrar tarama en erken MIN_RESCAN_MS sonra. Tarama her an durdurulabilir.
//
// Kod tabanında olmayanlar (bilerek): zafiyet denemesi, parola deneme, SNMP/SMB sorgulama, SYN taraması, geniş port
// taraması, internet adresi taraması.

const { execFile } = require('child_process');
const net = require('net');
const tls = require('tls');
const dns = require('dns');
const dgram = require('dgram');
const PORTS = require('./ports');
const RANGES = require('./ranges');

const MAX_CONCURRENCY = 64;
const MAX_TIMEOUT_MS = 1000;
const MIN_TIMEOUT_MS = 200;
const HTTP_TIMEOUT_MS = 2000;
const MIN_RESCAN_MS = 30000;
const PROGRESS_EVERY_MS = 120;

const clampConcurrency = (n) => Math.min(MAX_CONCURRENCY, Math.max(1, Number(n) || MAX_CONCURRENCY));
const clampTimeout = (ms) => Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, Number(ms) || MAX_TIMEOUT_MS));

// Aynı kayıt için tekrar tarama en erken MIN_RESCAN_MS sonra → { ok, waitMs }
function canRescan(lastScanAt, now = Date.now()) {
  const wait = lastScanAt ? MIN_RESCAN_MS - (now - lastScanAt) : 0;
  return wait > 0 ? { ok: false, waitMs: wait } : { ok: true, waitMs: 0 };
}

// --- Yardımcılar ------------------------------------------------------------------------------
const execFileP = (cmd, args, opts = {}) =>
  new Promise((resolve) => {
    let child;
    try {
      child = execFile(cmd, args, { windowsHide: true, timeout: opts.timeout || 5000, maxBuffer: 1024 * 1024, encoding: 'latin1' },
        (err, stdout, stderr) => resolve({ ok: !err, code: err ? err.code : 0, out: String(stdout || '') + String(stderr || '') }));
    } catch (e) {
      resolve({ ok: false, code: e.code, out: '' });
    }
    if (opts.signal && child) opts.signal.addEventListener('abort', () => { try { child.kill(); } catch {} }, { once: true });
  });

// Yalnız yazdırılabilir karakterler, tek satır, en çok max karakter
const printable = (s, max = 120) => String(s || '').replace(/[^\x20-\x7e -￿]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

// Basit iş havuzu: en çok n iş aynı anda
function createPool(n) {
  let active = 0;
  const queue = [];
  const next = () => {
    while (active < n && queue.length) {
      const { fn, resolve } = queue.shift();
      active++;
      Promise.resolve().then(fn).then(resolve, resolve).finally(() => { active--; next(); });
    }
  };
  return (fn) => new Promise((resolve) => { queue.push({ fn, resolve }); next(); });
}

// --- Ping (işletim sisteminin aracı) -------------------------------------------------------------
function pingArgs(platform, ip, timeoutMs) {
  if (platform === 'win32') return ['ping', ['-n', '1', '-w', String(timeoutMs), ip]];
  if (platform === 'darwin') return ['ping', ['-c', '1', '-W', String(timeoutMs), ip]];
  return ['ping', ['-c', '1', '-W', String(Math.max(1, Math.ceil(timeoutMs / 1000))), ip]];
}

// Çıktıdaki TTL varsa cihaz yanıt vermiştir (dil bağımsız: "TTL=64" / "ttl=64"); süre "time=3ms", "süre<1ms", "Zeit=3ms"…
function parsePing(out) {
  const ttl = /ttl[=:]\s*(\d+)/i.exec(out);
  if (!ttl) return { alive: false, rttMs: null, ttl: null };
  const rtt = /[=<]\s*([\d.,]+)\s*ms/i.exec(out);
  const ms = rtt ? parseFloat(rtt[1].replace(',', '.')) : null;
  return { alive: true, rttMs: ms == null || Number.isNaN(ms) ? 0 : ms, ttl: Number(ttl[1]) };
}

// --- ARP tablosu --------------------------------------------------------------------------------
// Windows: "  192.168.1.1   aa-bb-cc-dd-ee-ff  dynamic"; Linux (ip neigh): "192.168.1.1 dev eth0 lladdr aa:bb:… REACHABLE";
// arp -a (Linux/macOS): "? (192.168.1.1) at aa:bb:cc:dd:ee:ff [ether] on eth0"
function parseArp(out) {
  const map = new Map();
  for (const line of String(out || '').split(/\r?\n/)) {
    const m = /(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})[\s)].*?\b([0-9a-f]{1,2}(?:[:-][0-9a-f]{1,2}){5})\b/i.exec(line);
    if (!m) continue;
    const mac = m[2].split(/[:-]/).map((x) => x.padStart(2, '0')).join(':').toUpperCase();
    if (/^FF:FF:FF:FF:FF:FF$|^00:00:00:00:00:00$|^01:00:5E/.test(mac)) continue; // yayın ve çok noktaya yayın
    if (RANGES.ipToInt(m[1]) == null) continue;
    map.set(m[1], mac);
  }
  return map;
}

async function readArp(exec, platform) {
  if (platform === 'win32') return parseArp((await exec('arp', ['-a'])).out);
  const neigh = await exec('ip', ['neigh']);
  if (neigh.ok && neigh.out) return parseArp(neigh.out);
  return parseArp((await exec('arp', ['-a'])).out);
}

// --- HTTP yanıtı ve TLS sertifikası (saf ayrıştırıcılar) -------------------------------------------
function decodeEntities(s) {
  return String(s).replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (m, e) => {
    const k = e.toLowerCase();
    if (k[0] === '#') { const n = k[1] === 'x' ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10); return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m; }
    return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }[k];
  });
}

// Ham "GET /" yanıtı → { status, server, title } (yalnız bu üçü; gövdenin kalanı atılır)
function parseHttp(raw) {
  const text = Buffer.isBuffer(raw) ? raw.toString('latin1') : String(raw || '');
  const m = /^HTTP\/\d(?:\.\d)?\s+(\d{3})/.exec(text);
  if (!m) return null;
  const sep = text.search(/\r?\n\r?\n/);
  const head = sep >= 0 ? text.slice(0, sep) : text;
  const body = sep >= 0 ? text.slice(sep) : '';
  const server = (/^Server:\s*(.*)$/im.exec(head) || [])[1] || null;
  let title = null;
  const tm = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(body);
  if (tm) {
    let tt = tm[1];
    try { tt = Buffer.from(tt, 'latin1').toString('utf8'); } catch { /* olduğu gibi */ }
    title = printable(decodeEntities(tt), 100) || null;
  }
  return { status: Number(m[1]), server: server ? printable(server, 80) : null, title };
}

// Node TLS sertifika nesnesi → { cn, org, issuer, notAfter, selfSigned }
function parseCert(cert) {
  if (!cert || !cert.subject) return null;
  const pick = (o, k) => (o && o[k] ? (Array.isArray(o[k]) ? o[k][0] : o[k]) : null);
  const cn = pick(cert.subject, 'CN');
  const org = pick(cert.subject, 'O');
  const icn = pick(cert.issuer, 'CN');
  const iorg = pick(cert.issuer, 'O');
  return {
    cn: cn ? printable(cn, 80) : null,
    org: org ? printable(org, 80) : null,
    issuer: icn || iorg ? printable(icn || iorg, 80) : null,
    notAfter: cert.valid_to ? new Date(cert.valid_to).toISOString() : null,
    selfSigned: !!(cert.issuer && cert.subject && icn === cn && iorg === org),
  };
}

// --- mDNS PTR (tek sorgu, cihazın kendisine) ------------------------------------------------------
const reverseName = (ip) => `${ip.split('.').reverse().join('.')}.in-addr.arpa`;

function encodeDnsName(name) {
  const parts = name.split('.').filter(Boolean).map((l) => { const b = Buffer.from(l, 'utf8'); return Buffer.concat([Buffer.from([b.length]), b]); });
  return Buffer.concat([...parts, Buffer.from([0])]);
}

// PTR sorgusu; QU biti: yanıt doğrudan bize (tek noktaya) gelsin
function buildPtrQuery(ip) {
  const head = Buffer.alloc(12);
  head.writeUInt16BE(1, 4); // QDCOUNT
  const q = Buffer.alloc(4);
  q.writeUInt16BE(12, 0); // PTR
  q.writeUInt16BE(0x8001, 2); // QU | IN
  return Buffer.concat([head, encodeDnsName(reverseName(ip)), q]);
}

function readName(buf, off) {
  const labels = [];
  let o = off;
  let next = -1;
  for (let jumps = 0; jumps < 32; jumps++) {
    if (o >= buf.length) return null;
    const len = buf[o];
    if (len === 0) { if (next < 0) next = o + 1; return { name: labels.join('.'), next }; }
    if ((len & 0xc0) === 0xc0) {
      if (o + 1 >= buf.length) return null;
      if (next < 0) next = o + 2;
      o = ((len & 0x3f) << 8) | buf[o + 1];
      continue;
    }
    if (o + 1 + len > buf.length) return null;
    labels.push(buf.subarray(o + 1, o + 1 + len).toString('utf8'));
    o += 1 + len;
  }
  return null;
}

// Yanıttaki ilk PTR kaydı → ad (sondaki nokta ve ".local" korunur) ya da null
function parsePtrResponse(buf, ip) {
  if (!Buffer.isBuffer(buf) || buf.length < 12 || !(buf[2] & 0x80)) return null;
  const qd = buf.readUInt16BE(4);
  const an = buf.readUInt16BE(6) + buf.readUInt16BE(8) + buf.readUInt16BE(10);
  let o = 12;
  for (let i = 0; i < qd; i++) { const n = readName(buf, o); if (!n) return null; o = n.next + 4; }
  const want = reverseName(ip).toLowerCase();
  for (let i = 0; i < an; i++) {
    const n = readName(buf, o);
    if (!n || n.next + 10 > buf.length) return null;
    const type = buf.readUInt16BE(n.next);
    const rdlen = buf.readUInt16BE(n.next + 8);
    const rd = n.next + 10;
    if (type === 12 && n.name.toLowerCase() === want) {
      const v = readName(buf, rd);
      if (v && v.name) return printable(v.name.replace(/\.$/, ''), 80) || null;
    }
    o = rd + rdlen;
  }
  return null;
}

// --- Sonuç karşılaştırma ve dışa aktarım (saf) ------------------------------------------------
// Önceki taramaya göre: her cihaza status 'new' | 'same'; önceki taramada olup şimdi olmayanlar 'gone' olarak eklenir.
// Eşleme anahtarı MAC (varsa), yoksa IP.
function diffScans(prev, cur) {
  const key = (h) => (h.mac ? 'm:' + h.mac : 'i:' + h.ip);
  const before = new Map((prev && prev.hosts ? prev.hosts : []).filter((h) => h.status !== 'gone').map((h) => [key(h), h]));
  const seen = new Set();
  const hosts = cur.map((h) => { const k = key(h); seen.add(k); return { ...h, status: prev ? (before.has(k) ? 'same' : 'new') : 'same' }; });
  for (const [k, h] of before) if (!seen.has(k)) hosts.push({ ...h, status: 'gone', ports: h.ports || [] });
  return hosts;
}

const csvCell = (v) => { const s = v == null ? '' : String(v); return /[",;\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
function toCsv(scan) {
  const rows = [['ip', 'name', 'mac', 'vendor', 'rtt_ms', 'status', 'services']];
  for (const h of scan.hosts || []) {
    rows.push([h.ip, h.name || h.mdns || '', h.mac || '', h.vendor || '', h.rttMs == null ? '' : h.rttMs, h.status || '',
      (h.ports || []).map((p) => `${p.name} (${p.port})`).join(' | ')]);
  }
  return '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

// --- Tarayıcı -----------------------------------------------------------------------------------
function createScanner(deps = {}) {
  const platform = deps.platform || process.platform;
  const exec = deps.exec || execFileP;
  const netLib = deps.net || net;
  const tlsLib = deps.tls || tls;
  const dnsLib = deps.dns || dns;
  const dgramLib = deps.dgram || dgram;
  const oui = deps.oui || null;
  const now = deps.now || Date.now;

  // Tek bağlantı denemesi + izin verilen en küçük okuma → { open, banner, http, cert } (kapalıysa { open: false })
  function probePort(ip, info, timeoutMs, signal) {
    return new Promise((resolve) => {
      let done = false;
      let sock = null;
      const chunks = [];
      let size = 0;
      const result = { open: false, banner: null, http: null, cert: null };
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (sock) { try { sock.destroy(); } catch {} }
        resolve(result);
      };
      let timer = setTimeout(finish, timeoutMs);
      const onAbort = () => finish();
      if (signal) signal.addEventListener('abort', onAbort, { once: true });

      const collect = (d) => {
        if (size > 65536) return;
        chunks.push(d);
        size += d.length;
        if (info.probe === 'banner') {
          const text = Buffer.concat(chunks).toString('latin1');
          const nl = text.indexOf('\n');
          if (nl >= 0 || size > 512) { result.banner = printable(text.split(/\r?\n/)[0], 120) || null; finish(); }
        }
      };
      const onConnected = () => {
        result.open = true;
        if (info.probe === 'none') return finish();
        if (info.probe === 'tls') result.cert = parseCert(sock.getPeerCertificate && sock.getPeerCertificate());
        if (info.probe === 'http' || info.probe === 'tls') {
          clearTimeout(timer);
          timer = setTimeout(finish, HTTP_TIMEOUT_MS);
          sock.write(`GET / HTTP/1.0\r\nHost: ${ip}\r\nUser-Agent: IP-Tools\r\nAccept: text/html\r\nConnection: close\r\n\r\n`);
        }
        sock.on('data', collect);
        sock.on('end', () => { if (chunks.length && info.probe !== 'banner') result.http = parseHttp(Buffer.concat(chunks)); finish(); });
        sock.on('close', () => { if (chunks.length && info.probe !== 'banner' && !result.http) result.http = parseHttp(Buffer.concat(chunks)); finish(); });
      };
      try {
        if (info.probe === 'tls') {
          sock = tlsLib.connect({ host: ip, port: info.port, rejectUnauthorized: false, timeout: timeoutMs, servername: undefined }, onConnected);
        } else {
          sock = netLib.connect({ host: ip, port: info.port, timeout: timeoutMs }, onConnected);
        }
        sock.setNoDelay && sock.setNoDelay(true);
        // TCP bağlantısı kuruldu: TLS el sıkışması sonradan başarısız olsa da port açıktır
        sock.on('connect', () => { result.open = true; });
        sock.on('timeout', finish);
        sock.on('error', finish);
      } catch {
        finish();
      }
    });
  }

  function reverseDns(ip, timeoutMs) {
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(null), timeoutMs);
      try {
        dnsLib.reverse(ip, (err, names) => { clearTimeout(timer); resolve(!err && names && names[0] ? printable(names[0], 80) : null); });
      } catch { clearTimeout(timer); resolve(null); }
    });
  }

  function mdnsName(ip, timeoutMs) {
    return new Promise((resolve) => {
      let sock;
      let done = false;
      const finish = (v) => { if (done) return; done = true; clearTimeout(timer); try { sock && sock.close(); } catch {} resolve(v); };
      const timer = setTimeout(() => finish(null), timeoutMs);
      try {
        sock = dgramLib.createSocket('udp4');
        sock.on('error', () => finish(null));
        sock.on('message', (msg, rinfo) => { if (rinfo.address === ip) finish(parsePtrResponse(msg, ip)); });
        sock.send(buildPtrQuery(ip), 5353, ip, (err) => { if (err) finish(null); });
      } catch { finish(null); }
    });
  }

  // scan({ ranges, ports, concurrency, timeoutMs, signal, onProgress, previous })
  async function scan(opts) {
    const concurrency = clampConcurrency(opts.concurrency);
    const timeoutMs = clampTimeout(opts.timeoutMs);
    const portList = PORTS.activePorts([]).filter((p) => (opts.ports || PORTS.allPorts()).includes(p)).map((p) => PORTS.portInfo(p));
    const signal = opts.signal || null;
    const stopped = () => !!(signal && signal.aborted);
    const run = createPool(concurrency);
    const ips = [...RANGES.addresses(opts.ranges)];
    const startedAt = now();
    const total = ips.length;
    let lastProgress = 0;
    let doneCount = 0;
    const found = new Map(); // ip → host
    const progress = (phase, force) => {
      const t = now();
      if (!force && t - lastProgress < PROGRESS_EVERY_MS) return;
      lastProgress = t;
      if (opts.onProgress) opts.onProgress({ phase, done: doneCount, total, found: found.size, hosts: [...found.values()] });
    };

    // 1) ping
    await Promise.all(ips.map((ip) => run(async () => {
      if (stopped()) return;
      const [cmd, args] = pingArgs(platform, ip, timeoutMs);
      const r = await exec(cmd, args, { timeout: timeoutMs + 1500, signal });
      const p = parsePing(r.out);
      doneCount++;
      if (p.alive) found.set(ip, { ip, alive: 'ping', rttMs: p.rttMs, ttl: p.ttl, mac: null, vendor: null, name: null, mdns: null, ports: [] });
      progress('ping');
    })));
    if (stopped()) return finish(found, startedAt, total, true);

    // ARP tablosu: ping'e yanıt vermeyen ama tabloda görünenler de canlı
    let arp = new Map();
    try { arp = await readArp(exec, platform); } catch { /* tablo okunamadı */ }
    for (const ip of ips) {
      const mac = arp.get(ip);
      if (!mac) continue;
      const h = found.get(ip) || { ip, alive: 'arp', rttMs: null, ttl: null, mac: null, vendor: null, name: null, mdns: null, ports: [] };
      h.mac = mac;
      if (oui) { const v = oui.lookup(mac); h.vendor = v ? v.vendor : null; h.localMac = !!(v && v.local); }
      found.set(ip, h);
    }
    progress('ports', true);

    // 2) servis denemeleri (yalnız canlı cihazlar)
    const hosts = [...found.values()];
    doneCount = 0;
    const portTotal = hosts.length * portList.length;
    await Promise.all(hosts.flatMap((h) => portList.map((info) => run(async () => {
      if (stopped()) return;
      const r = await probePort(h.ip, info, timeoutMs, signal);
      doneCount++;
      if (r.open) {
        h.ports.push({
          port: info.port, key: info.key, name: info.name,
          banner: r.banner, title: r.http ? r.http.title : null, server: r.http ? r.http.server : null, status: r.http ? r.http.status : null,
          tls: r.cert,
        });
        h.ports.sort((a, b) => a.port - b.port);
      }
      if (opts.onProgress) { const t = now(); if (t - lastProgress >= PROGRESS_EVERY_MS) { lastProgress = t; opts.onProgress({ phase: 'ports', done: doneCount, total: portTotal, found: found.size, hosts: [...found.values()] }); } }
    }))));
    if (stopped()) return finish(found, startedAt, total, true);

    // 3) adlar (ters DNS + mDNS)
    doneCount = 0;
    await Promise.all(hosts.map((h) => run(async () => {
      if (stopped()) return;
      const [rdns, m] = await Promise.all([reverseDns(h.ip, timeoutMs), mdnsName(h.ip, timeoutMs)]);
      h.name = rdns;
      h.mdns = m;
      doneCount++;
      if (opts.onProgress) { const t = now(); if (t - lastProgress >= PROGRESS_EVERY_MS) { lastProgress = t; opts.onProgress({ phase: 'names', done: doneCount, total: hosts.length, found: found.size, hosts: [...found.values()] }); } }
    })));
    return finish(found, startedAt, total, stopped());
  }

  function finish(found, startedAt, total, stopped) {
    const hosts = [...found.values()].sort((a, b) => RANGES.ipKey(a.ip) - RANGES.ipKey(b.ip));
    return { startedAt, finishedAt: now(), scanned: total, stopped, hosts };
  }

  return { scan, probePort, reverseDns, mdnsName };
}

module.exports = {
  createScanner, canRescan, parsePing, pingArgs, parseArp, parseHttp, parseCert, buildPtrQuery, parsePtrResponse, reverseName,
  diffScans, toCsv, clampConcurrency, clampTimeout, printable, createPool,
  MAX_CONCURRENCY, MAX_TIMEOUT_MS, MIN_TIMEOUT_MS, MIN_RESCAN_MS, HTTP_TIMEOUT_MS,
};
