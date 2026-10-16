'use strict';
// Sabit port listesi (genişletilemez, yalnız kapatılabilir) ve etiket eylemleri
const test = require('node:test');
const assert = require('node:assert/strict');
const PORTS = require('../src/ports');
const ACTIONS = require('../src/actions');

test('port listesi sabit ve kısa: tasarımdaki 15 port, başka port yok', () => {
  assert.deepEqual(PORTS.allPorts().sort((a, b) => a - b), [21, 22, 80, 443, 445, 554, 631, 1433, 3306, 3389, 5432, 5900, 8080, 8443, 9100]);
  for (const p of PORTS.PORTS) {
    assert.ok(['banner', 'http', 'tls', 'none'].includes(p.probe), String(p.port));
    assert.ok(PORTS.GROUPS.includes(p.key), String(p.port));
  }
  // Yazıcı ham portuna ve özel protokollü portlara hiçbir şey gönderilmez
  for (const port of [9100, 3389, 445, 5432, 3306, 1433, 554]) assert.equal(PORTS.portInfo(port).probe, 'none', String(port));
  // Karşılama satırı yalnız sunucunun kendiliğinden konuştuğu portlarda okunur
  for (const port of [22, 21, 5900]) assert.equal(PORTS.portInfo(port).probe, 'banner', String(port));
});

test('kapatma listesi yalnız daraltır: bilinmeyen portlar yok sayılır, tekrarlar atılır', () => {
  assert.deepEqual(PORTS.sanitizeDisabled([80, '443', 80, 23, 65535, 'x', -1]), [80, 443]);
  assert.deepEqual(PORTS.sanitizeDisabled(null), []);
  const active = PORTS.activePorts([22, 3389]);
  assert.ok(!active.includes(22) && !active.includes(3389));
  assert.equal(active.length, 13);
  // Kapalı listesine olmayan bir port eklemek listeyi genişletmez
  assert.equal(PORTS.activePorts([]).length, 15);
  assert.equal(PORTS.portInfo(23), null);
});

test('etiket eylemleri: web → tarayıcı, RDP → mstsc, SMB → Gezgin, diğerleri → adresi kopyala', () => {
  const ip = '192.168.1.20';
  assert.deepEqual(ACTIONS.actionFor('web', ip, 80), { kind: 'open', target: 'http://192.168.1.20/', text: 'http://192.168.1.20/' });
  assert.equal(ACTIONS.actionFor('web', ip, 443).target, 'https://192.168.1.20/');
  assert.equal(ACTIONS.actionFor('web', ip, 8080).target, 'http://192.168.1.20:8080/');
  assert.equal(ACTIONS.actionFor('web', ip, 8443).target, 'https://192.168.1.20:8443/');
  assert.equal(ACTIONS.actionFor('printer', ip, 9100).target, 'http://192.168.1.20/');
  assert.equal(ACTIONS.actionFor('printer', ip, 631).kind, 'open');
  assert.deepEqual(ACTIONS.actionFor('rdp', ip, 3389), { kind: 'run', target: 'mstsc', args: ['/v:192.168.1.20'], text: 'mstsc /v:192.168.1.20' });
  assert.deepEqual(ACTIONS.actionFor('smb', ip, 445), { kind: 'explorer', target: '\\\\192.168.1.20', text: '\\\\192.168.1.20' });
  assert.deepEqual(ACTIONS.actionFor('ssh', ip, 22), { kind: 'copy', target: 'ssh 192.168.1.20', text: ip });
  assert.equal(ACTIONS.actionFor('ftp', ip, 21).target, 'ftp://192.168.1.20/');
  assert.equal(ACTIONS.actionFor('db', ip, 5432).target, '192.168.1.20:5432');
  assert.equal(ACTIONS.actionFor('camera', ip, 554).target, 'rtsp://192.168.1.20/');
  assert.equal(ACTIONS.actionFor('vnc', ip, 5900).target, ip);
  for (const g of ['ssh', 'ftp', 'db', 'camera', 'vnc']) assert.equal(ACTIONS.actionFor(g, ip, PORTS.PORTS.find((p) => p.key === g).port).kind, 'copy', g);
  assert.equal(ACTIONS.actionFor('bilinmeyen', ip, 1).kind, 'copy');
});

test('derin bağlantı yeri: tanımlanınca kopyala yerine o adres açılır', () => {
  ACTIONS.DEEP_LINKS.ssh = 'sshmaster://connect?host={ip}&port={port}';
  try {
    assert.deepEqual(ACTIONS.actionFor('ssh', '10.0.0.5', 22), { kind: 'open', target: 'sshmaster://connect?host=10.0.0.5&port=22', text: 'sshmaster://connect?host=10.0.0.5&port=22' });
  } finally {
    delete ACTIONS.DEEP_LINKS.ssh;
  }
  assert.equal(ACTIONS.actionFor('ssh', '10.0.0.5', 22).kind, 'copy');
});
