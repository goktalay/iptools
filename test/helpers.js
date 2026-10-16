'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

// Bellek içi kimlik deposu (@napi-rs/keyring Entry ile aynı arayüz)
function memoryKeyring() {
  let value = null;
  return { get: () => value, set: (v) => { value = String(v); }, del: () => { value = null; }, peek: () => value };
}

function tmpDir(prefix = 'ipt-test-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

// --- Sahte ağ: scanner.js'in enjekte edilebilir bağımlılıkları ---------------------------------
// hosts: { '192.0.2.10': { ping: { rtt, ttl }, mac, ports: { 22: { banner: 'SSH-2.0-...' }, 80: { http: 'HTTP/1.1 200 OK\r\nServer: nginx\r\n\r\n<title>Router</title>' }, 443: { cert: {...}, http: ... } }, rdns: 'router.lan', mdns: 'router.local' } }
function fakeNetwork(hosts, { platform = 'win32' } = {}) {
  const calls = { ping: [], arp: 0, connect: [], dns: [], mdns: [], sent: [] };
  const exec = async (cmd, args) => {
    if (cmd === 'ping') {
      const ip = args[args.length - 1];
      calls.ping.push(ip);
      const h = hosts[ip];
      if (!h || !h.ping) return { ok: false, code: 1, out: `Pinging ${ip} with 32 bytes of data:\nRequest timed out.\n` };
      return { ok: true, code: 0, out: `Pinging ${ip} with 32 bytes of data:\nReply from ${ip}: bytes=32 time=${h.ping.rtt}ms TTL=${h.ping.ttl}\n` };
    }
    if (cmd === 'arp' || cmd === 'ip') {
      calls.arp++;
      const lines = Object.entries(hosts).filter(([, h]) => h.mac).map(([ip, h]) => `  ${ip}            ${h.mac.replace(/:/g, '-').toLowerCase()}     dynamic`);
      return { ok: true, code: 0, out: `Interface: 192.0.2.1 --- 0x3\n  Internet Address      Physical Address      Type\n${lines.join('\n')}\n  224.0.0.22            01-00-5e-00-00-16     static\n` };
    }
    return { ok: false, code: 127, out: '' };
  };
  const { EventEmitter } = require('events');
  const makeSocket = (opts, onConnect, isTls) => {
    const s = new EventEmitter();
    const h = hosts[opts.host];
    const p = h && h.ports && h.ports[opts.port];
    calls.connect.push(`${opts.host}:${opts.port}${isTls ? '/tls' : ''}`);
    s.destroyed = false;
    s.destroy = () => { s.destroyed = true; };
    s.setNoDelay = () => {};
    s.getPeerCertificate = () => (p && p.cert) || {};
    s.write = (data) => {
      calls.sent.push({ host: opts.host, port: opts.port, data: String(data) });
      if (p && p.http) setTimeout(() => { if (!s.destroyed) { s.emit('data', Buffer.from(p.http, 'latin1')); s.emit('end'); s.emit('close'); } }, 2);
    };
    setTimeout(() => {
      if (!p) { s.emit('error', new Error('ECONNREFUSED')); return; }
      s.emit('connect');
      if (onConnect) onConnect();
      if (p.banner) setTimeout(() => { if (!s.destroyed) s.emit('data', Buffer.from(p.banner + '\r\n', 'latin1')); }, 2);
    }, 1);
    return s;
  };
  const net = { connect: (opts, cb) => makeSocket(opts, cb, false) };
  const tls = { connect: (opts, cb) => makeSocket(opts, cb, true) };
  const dns = { reverse: (ip, cb) => { calls.dns.push(ip); const h = hosts[ip]; setTimeout(() => (h && h.rdns ? cb(null, [h.rdns]) : cb(new Error('ENOTFOUND'))), 1); } };
  const { buildPtrQuery } = require('../src/scanner');
  const dgram = {
    createSocket: () => {
      const s = new EventEmitter();
      s.close = () => {};
      s.send = (buf, port, ip, cb) => {
        calls.mdns.push(ip);
        cb && cb(null);
        const h = hosts[ip];
        if (h && h.mdns) setTimeout(() => s.emit('message', fakePtrResponse(buf, h.mdns), { address: ip, port }), 1);
      };
      return s;
    },
  };
  return { exec, net, tls, dns, dgram, calls, platform, buildPtrQuery };
}

// Sorgudaki adı yanıtta tekrar eder ve bir PTR kaydı ekler (sıkıştırma: 0xc00c = sorgudaki ad)
function fakePtrResponse(query, name) {
  const head = Buffer.alloc(12);
  head.writeUInt16BE(query.readUInt16BE(0), 0);
  head.writeUInt16BE(0x8400, 2);
  head.writeUInt16BE(1, 4);
  head.writeUInt16BE(1, 6);
  const q = query.subarray(12);
  const parts = name.split('.').map((l) => Buffer.concat([Buffer.from([l.length]), Buffer.from(l)]));
  const rdata = Buffer.concat([...parts, Buffer.from([0])]);
  const rr = Buffer.alloc(10);
  rr.writeUInt16BE(12, 0); // PTR
  rr.writeUInt16BE(1, 2);
  rr.writeUInt32BE(120, 4);
  rr.writeUInt16BE(rdata.length, 8);
  return Buffer.concat([head, q, Buffer.from([0xc0, 0x0c]), rr, rdata]);
}

module.exports = { memoryKeyring, tmpDir, fakeNetwork, fakePtrResponse };
