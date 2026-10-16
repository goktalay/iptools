'use strict';
// Tarayıcı: ping/ARP çıktısı, karşılama ve HTTP başlık ayrıştırma, sertifika, mDNS PTR, hız sınırı, karşılaştırma,
// dışa aktarım ve sahte ağla uçtan uca tarama (gerçek ağ yok; adresler belgeleme aralığından, 192.0.2.0/24).
const test = require('node:test');
const assert = require('node:assert/strict');
const SC = require('../src/scanner');
const PORTS = require('../src/ports');
const { fakeNetwork } = require('./helpers');

test('ping çıktısı: TTL varsa canlı; süre ve TTL dil bağımsız okunur', () => {
  assert.deepEqual(SC.parsePing('Reply from 192.0.2.1: bytes=32 time=3ms TTL=64'), { alive: true, rttMs: 3, ttl: 64 });
  assert.deepEqual(SC.parsePing('192.0.2.1 yanıtı: bayt=32 süre<1ms TTL=128'), { alive: true, rttMs: 1, ttl: 128 });
  assert.deepEqual(SC.parsePing('Antwort von 192.0.2.1: Bytes=32 Zeit=12ms TTL=255'), { alive: true, rttMs: 12, ttl: 255 });
  assert.deepEqual(SC.parsePing('64 bytes from 192.0.2.1: icmp_seq=1 ttl=64 time=0.412 ms'), { alive: true, rttMs: 0.412, ttl: 64 });
  assert.deepEqual(SC.parsePing('Request timed out.'), { alive: false, rttMs: null, ttl: null });
  assert.deepEqual(SC.parsePing('Reply from 192.0.2.5: Destination host unreachable.'), { alive: false, rttMs: null, ttl: null });
  assert.deepEqual(SC.pingArgs('win32', '192.0.2.1', 800), ['ping', ['-n', '1', '-w', '800', '192.0.2.1']]);
  assert.deepEqual(SC.pingArgs('linux', '192.0.2.1', 800), ['ping', ['-c', '1', '-W', '1', '192.0.2.1']]);
});

test('ARP tablosu: Windows ve Linux biçimleri; yayın ve çok noktaya yayın atlanır', () => {
  const win = `Interface: 192.0.2.1 --- 0x3\n  Internet Address      Physical Address      Type\n  192.0.2.1             b8-27-eb-12-34-56     dynamic\n  192.0.2.255           ff-ff-ff-ff-ff-ff     static\n  224.0.0.22            01-00-5e-00-00-16     static\n`;
  const m = SC.parseArp(win);
  assert.deepEqual([...m.entries()], [['192.0.2.1', 'B8:27:EB:12:34:56']]);
  const lin = `192.0.2.7 dev eth0 lladdr 3c:5a:b4:0a:0b:0c REACHABLE\n192.0.2.9 dev eth0  FAILED\n? (192.0.2.8) at 0:1a:11:aa:bb:cc [ether] on eth0\n`;
  const m2 = SC.parseArp(lin);
  assert.deepEqual([...m2.entries()], [['192.0.2.7', '3C:5A:B4:0A:0B:0C'], ['192.0.2.8', '00:1A:11:AA:BB:CC']]);
});

test('HTTP yanıtı: yalnız durum, Server başlığı ve <title> alınır; varlıklar çözülür', () => {
  const raw = 'HTTP/1.1 200 OK\r\nServer: nginx/1.24.0\r\nContent-Type: text/html; charset=utf-8\r\n\r\n<html><head><title>Ana &amp; Yönetim &#x2014; Router</title></head><body>gizli</body></html>';
  assert.deepEqual(SC.parseHttp(Buffer.from(raw, 'utf8')), { status: 200, server: 'nginx/1.24.0', title: 'Ana & Yönetim — Router' });
  assert.deepEqual(SC.parseHttp('HTTP/1.0 401 Unauthorized\r\nWWW-Authenticate: Basic realm="cam"\r\n\r\n'), { status: 401, server: null, title: null });
  assert.equal(SC.parseHttp('SSH-2.0-OpenSSH'), null);
  assert.equal(SC.parseHttp('HTTP/1.1 200 OK\r\n\r\n<title>' + 'x'.repeat(500) + '</title>').title.length, 100);
});

test('TLS sertifikası: yalnız konu adı, kuruluş, veren ve son tarih', () => {
  const c = SC.parseCert({ subject: { CN: 'nas.local', O: 'Synology' }, issuer: { CN: 'nas.local', O: 'Synology' }, valid_to: 'Jan  1 00:00:00 2030 GMT' });
  assert.deepEqual(c, { cn: 'nas.local', org: 'Synology', issuer: 'nas.local', notAfter: '2030-01-01T00:00:00.000Z', selfSigned: true });
  assert.equal(SC.parseCert({ subject: { CN: 'a' }, issuer: { CN: 'R3', O: "Let's Encrypt" } }).selfSigned, false);
  assert.equal(SC.parseCert({}), null);
});

test('mDNS PTR: sorgu QU bitiyle kurulur, yanıt yalnız sorulan ad için okunur', () => {
  const { fakePtrResponse } = require('./helpers');
  const q = SC.buildPtrQuery('192.0.2.10');
  assert.equal(q.readUInt16BE(4), 1);
  assert.equal(q.readUInt16BE(q.length - 2), 0x8001);
  assert.equal(SC.reverseName('192.0.2.10'), '10.2.0.192.in-addr.arpa');
  assert.equal(SC.parsePtrResponse(fakePtrResponse(q, 'printer.local'), '192.0.2.10'), 'printer.local');
  assert.equal(SC.parsePtrResponse(fakePtrResponse(q, 'printer.local'), '192.0.2.11'), null); // başka adresin yanıtı
  assert.equal(SC.parsePtrResponse(Buffer.alloc(5), '192.0.2.10'), null);
});

test('hız sınırı: aynı kayıt en erken 30 sn sonra; eşzamanlılık ≤ 64, zaman aşımı ≤ 1000 ms', () => {
  assert.deepEqual(SC.canRescan(null, 1000), { ok: true, waitMs: 0 });
  assert.deepEqual(SC.canRescan(100000, 100000 + 10000), { ok: false, waitMs: 20000 });
  assert.deepEqual(SC.canRescan(100000, 100000 + SC.MIN_RESCAN_MS), { ok: true, waitMs: 0 });
  assert.equal(SC.MIN_RESCAN_MS, 30000);
  assert.equal(SC.clampConcurrency(500), 64);
  assert.equal(SC.clampConcurrency(0), 64);
  assert.equal(SC.clampConcurrency(8), 8);
  assert.equal(SC.clampTimeout(5000), 1000);
  assert.equal(SC.clampTimeout(50), 200);
  assert.equal(SC.clampTimeout('abc'), 1000);
});

test('iş havuzu aynı anda en çok n iş çalıştırır', async () => {
  const run = SC.createPool(3);
  let active = 0;
  let peak = 0;
  await Promise.all(Array.from({ length: 12 }, () => run(async () => {
    active++; peak = Math.max(peak, active);
    await new Promise((r) => setTimeout(r, 5));
    active--;
  })));
  assert.equal(peak, 3);
});

test('karşılaştırma: yeni / aynı / kaybolan (MAC varsa MAC ile, yoksa IP ile eşleşir)', () => {
  const prev = { hosts: [
    { ip: '192.0.2.1', mac: 'AA:AA:AA:AA:AA:01', status: 'same' }, { ip: '192.0.2.2', mac: null, status: 'new' },
    { ip: '192.0.2.3', mac: 'AA:AA:AA:AA:AA:03', status: 'same' },
    { ip: '192.0.2.4', mac: 'AA:AA:AA:AA:AA:04', status: 'gone' }, // önceki taramada zaten kaybolmuştu: tekrar listelenmez
  ] };
  const cur = [{ ip: '192.0.2.9', mac: 'AA:AA:AA:AA:AA:01' }, { ip: '192.0.2.2', mac: null }, { ip: '192.0.2.5', mac: null }];
  const out = SC.diffScans(prev, cur);
  assert.deepEqual(out.map((h) => [h.ip, h.status]), [['192.0.2.9', 'same'], ['192.0.2.2', 'same'], ['192.0.2.5', 'new'], ['192.0.2.3', 'gone']]);
  // İlk taramada hiçbir şey "yeni" değildir
  assert.deepEqual(SC.diffScans(null, cur).map((h) => h.status), ['same', 'same', 'same']);
});

test('CSV: başlık satırı, UTF-8 BOM, alanlar tırnaklanır', () => {
  const csv = SC.toCsv({ hosts: [{ ip: '192.0.2.1', name: 'router, "lan"', mac: 'AA:BB:CC:DD:EE:FF', vendor: 'Acme', rttMs: 2, status: 'new', ports: [{ name: 'HTTP', port: 80 }, { name: 'SSH', port: 22 }] }] });
  assert.ok(csv.startsWith('﻿ip,name,mac,vendor,rtt_ms,status,services\r\n'));
  assert.ok(csv.includes('192.0.2.1,"router, ""lan""",AA:BB:CC:DD:EE:FF,Acme,2,new,HTTP (80) | SSH (22)\r\n'));
});

test('uçtan uca tarama (sahte ağ): ping + ARP, sabit portlar, karşılama/başlık/sertifika, adlar; hiçbir yere paket basmaz', async () => {
  const hosts = {
    '192.0.2.1': { ping: { rtt: 2, ttl: 64 }, mac: 'B8:27:EB:00:00:01', rdns: 'router.lan', mdns: 'router.local',
      ports: { 80: { http: 'HTTP/1.1 200 OK\r\nServer: lighttpd\r\n\r\n<title>Router Admin</title>' }, 22: { banner: 'SSH-2.0-dropbear_2022.83' },
        443: { cert: { subject: { CN: 'router.lan' }, issuer: { CN: 'router.lan' }, valid_to: 'Jan 1 00:00:00 2031 GMT' }, http: 'HTTP/1.1 200 OK\r\nServer: lighttpd\r\n\r\n<title>Secure</title>' } } },
    '192.0.2.20': { mac: '3C:5A:B4:00:00:20', ports: { 9100: {}, 631: { http: 'HTTP/1.1 200 OK\r\nServer: CUPS/2.4\r\n\r\n<title>Printer</title>' } } }, // ping'e yanıt vermez, ARP'ta var
    '192.0.2.30': { ping: { rtt: 15, ttl: 128 }, ports: { 3389: {}, 445: {} } },
  };
  const fake = fakeNetwork(hosts);
  const oui = { lookup: (mac) => ({ mac, vendor: mac.startsWith('B8:27:EB') ? 'Raspberry Pi Foundation' : 'Google, Inc', local: false }) };
  const scanner = SC.createScanner({ ...fake, oui });
  const progress = [];
  const { ipToInt } = require('../src/ranges');
  const res = await scanner.scan({
    ranges: [{ start: ipToInt('192.0.2.1'), end: ipToInt('192.0.2.40') }], ports: PORTS.allPorts(), concurrency: 64, timeoutMs: 300,
    onProgress: (p) => progress.push(p.phase),
  });
  assert.equal(res.scanned, 40);
  assert.equal(res.stopped, false);
  assert.equal(fake.calls.ping.length, 40);
  assert.equal(fake.calls.arp, 1);
  assert.deepEqual(res.hosts.map((h) => h.ip), ['192.0.2.1', '192.0.2.20', '192.0.2.30']);
  const r = res.hosts[0];
  assert.deepEqual([r.alive, r.rttMs, r.ttl, r.mac, r.vendor, r.name, r.mdns], ['ping', 2, 64, 'B8:27:EB:00:00:01', 'Raspberry Pi Foundation', 'router.lan', 'router.local']);
  assert.deepEqual(r.ports.map((p) => p.port), [22, 80, 443]);
  assert.equal(r.ports[0].banner, 'SSH-2.0-dropbear_2022.83');
  assert.deepEqual([r.ports[1].title, r.ports[1].server, r.ports[1].status], ['Router Admin', 'lighttpd', 200]);
  assert.deepEqual([r.ports[2].tls.cn, r.ports[2].tls.selfSigned, r.ports[2].title], ['router.lan', true, 'Secure']);
  const p = res.hosts[1];
  assert.deepEqual([p.alive, p.rttMs, p.mac, p.vendor], ['arp', null, '3C:5A:B4:00:00:20', 'Google, Inc']);
  assert.deepEqual(p.ports.map((x) => [x.port, x.key]), [[631, 'printer'], [9100, 'printer']]);
  assert.equal(p.ports[0].title, 'Printer');
  const w = res.hosts[2];
  assert.deepEqual(w.ports.map((x) => x.port), [445, 3389]);
  assert.equal(w.mac, null);
  // Yalnız canlı cihazlara, yalnız sabit listedeki portlara bağlanılır
  const tried = new Set(fake.calls.connect.map((c) => c.split('/')[0]));
  assert.equal(tried.size, 3 * 15);
  assert.ok([...tried].every((c) => PORTS.allPorts().includes(Number(c.split(':')[1]))));
  // Hiçbir porta "GET /" dışında bir şey gönderilmez; yazıcı 9100'e, RDP/SMB/veritabanı/RTSP'ye hiçbir şey yazılmaz
  assert.ok(fake.calls.sent.every((s) => s.data.startsWith('GET / HTTP/1.0\r\n')));
  assert.ok(fake.calls.sent.every((s) => ['http', 'tls'].includes(PORTS.portInfo(s.port).probe)));
  assert.ok(!fake.calls.sent.some((s) => s.port === 9100));
  // Adlar yalnız canlı cihazlar için çözülür; ilerleme aşamaları sırayla
  assert.deepEqual(fake.calls.dns.sort(), ['192.0.2.1', '192.0.2.20', '192.0.2.30']);
  assert.ok(progress.includes('ping') && progress.includes('ports'));
  assert.ok(res.finishedAt >= res.startedAt);
});

test('Durdur: iptal edilince kalan adresler taranmaz ve sonuç "stopped" döner', async () => {
  const fake = fakeNetwork({ '192.0.2.1': { ping: { rtt: 1, ttl: 64 }, ports: { 80: { http: 'HTTP/1.1 200 OK\r\n\r\n' } } } });
  const ctl = new AbortController();
  const scanner = SC.createScanner(fake);
  const { ipToInt } = require('../src/ranges');
  let n = 0;
  const res = await scanner.scan({
    ranges: [{ start: ipToInt('192.0.2.1'), end: ipToInt('192.0.2.254') }], ports: [80], concurrency: 4, timeoutMs: 200, signal: ctl.signal,
    onProgress: () => { if (++n === 1) ctl.abort(); },
  });
  assert.equal(res.stopped, true);
  assert.ok(fake.calls.ping.length < 254);
});

test('kapatılan portlar denenmez', async () => {
  const fake = fakeNetwork({ '192.0.2.1': { ping: { rtt: 1, ttl: 64 }, ports: { 22: { banner: 'SSH-2.0-x' }, 80: { http: 'HTTP/1.1 200 OK\r\n\r\n' } } } });
  const scanner = SC.createScanner(fake);
  const { ipToInt } = require('../src/ranges');
  const res = await scanner.scan({ ranges: [{ start: ipToInt('192.0.2.1'), end: ipToInt('192.0.2.1') }], ports: PORTS.activePorts([22, 80]), timeoutMs: 200 });
  assert.deepEqual(res.hosts[0].ports, []);
  assert.ok(!fake.calls.connect.some((c) => c.endsWith(':22') || c.endsWith(':80')));
  assert.equal(fake.calls.connect.length, 13);
});
