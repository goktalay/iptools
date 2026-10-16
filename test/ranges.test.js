'use strict';
// Aralık ayrıştırma ve özel-adres denetimi (tasarım sınırı: yalnız RFC 1918 + 169.254/16, en çok /16)
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../src/ranges');

test('tek adres, başlangıç-bitiş, kısa yazım ve CIDR ayrıştırılır', () => {
  assert.deepEqual(R.parseRanges('192.168.1.10').ranges, [{ start: R.ipToInt('192.168.1.10'), end: R.ipToInt('192.168.1.10') }]);
  const a = R.parseRanges('192.168.1.1-192.168.1.255');
  assert.equal(a.ok, true);
  assert.equal(a.count, 255);
  const b = R.parseRanges('192.168.1.1-9');
  assert.deepEqual([b.ok, b.count], [true, 9]);
  const c = R.parseRanges('192.168.1.0/24');
  assert.deepEqual([c.ok, c.count, R.formatRanges(c.ranges)], [true, 254, '192.168.1.1-192.168.1.254']); // ağ ve yayın atlanır
  const d = R.parseRanges('10.0.0.4/30');
  assert.equal(d.count, 2);
  const e = R.parseRanges('10.0.0.4/31');
  assert.equal(e.count, 2); // /31 ve /32'de atlama yok
  assert.equal(R.parseRanges('10.0.0.4/32').count, 1);
});

test('virgül, noktalı virgül, boşluk ve satır sonuyla birden çok aralık; örtüşenler birleşir', () => {
  const r = R.parseRanges('192.168.1.1-50, 192.168.1.40-60;192.168.1.100\n10.0.0.1 - 10.0.0.3');
  assert.equal(r.ok, true);
  assert.equal(r.ranges.length, 3);
  assert.equal(r.count, 60 + 1 + 3);
  assert.equal(R.formatRanges(r.ranges), '10.0.0.1-10.0.0.3, 192.168.1.1-192.168.1.60, 192.168.1.100');
});

test('yalnız özel/yerel adresler kabul edilir; internet, döngü, CGNAT ve belgeleme aralıkları reddedilir', () => {
  for (const ok of ['10.0.0.1', '10.255.255.254', '172.16.0.1', '172.31.255.1', '192.168.0.1', '192.168.255.255', '169.254.1.1', '172.16.0.0/16']) {
    assert.equal(R.parseRanges(ok).ok, true, ok);
  }
  for (const bad of ['8.8.8.8', '1.1.1.1', '192.0.2.0/24', '198.51.100.7', '203.0.113.1-203.0.113.9', '127.0.0.1', '100.64.0.1', '172.32.0.1', '172.15.255.255', '192.169.0.1', '224.0.0.1', '0.0.0.0']) {
    const r = R.parseRanges(bad);
    assert.deepEqual([r.ok, r.error.code], [false, 'not_private'], bad);
  }
  // Özel bloktan taşan aralık da reddedilir
  const r = R.parseRanges('192.168.255.200-192.169.0.5');
  assert.deepEqual([r.ok, r.error.code], [false, 'not_private']);
  assert.equal(R.parseRanges('10.0.0.1, 8.8.8.8').error.token, '8.8.8.8');
});

test('en çok /16: daha geniş CIDR ve 65.536 adresi aşan toplam reddedilir', () => {
  assert.equal(R.parseRanges('10.0.0.0/16').ok, true);
  assert.equal(R.parseRanges('10.0.0.0/16').count, 65534);
  assert.deepEqual([R.parseRanges('10.0.0.0/15').ok, R.parseRanges('10.0.0.0/15').error.code], [false, 'too_many']);
  assert.deepEqual([R.parseRanges('10.0.0.0/8').error.code], ['too_many']);
  const r = R.parseRanges('10.0.0.0/16, 10.1.0.0/16');
  assert.deepEqual([r.ok, r.error.code], [false, 'too_many']);
  assert.equal(R.parseRanges('10.0.0.0-10.0.255.255').ok, true);
  assert.equal(R.parseRanges('10.0.0.0-10.1.0.0').error.code, 'too_many');
});

test('hatalı girdiler açıklamalı kodla reddedilir', () => {
  assert.equal(R.parseRanges('').error.code, 'empty');
  assert.equal(R.parseRanges('  ,  ').error.code, 'empty');
  assert.deepEqual(R.parseRanges('192.168.1').error, { code: 'invalid', token: '192.168.1' });
  assert.equal(R.parseRanges('192.168.1.256').error.code, 'invalid');
  assert.equal(R.parseRanges('192.168.1.0/33').error.code, 'invalid');
  assert.equal(R.parseRanges('fe80::1').error.code, 'ipv6');
  assert.deepEqual(R.parseRanges('192.168.1.9-192.168.1.1').error, { code: 'reversed', token: '192.168.1.9-192.168.1.1' });
  assert.equal(R.parseRanges('192.168.1.1-300').error.code, 'invalid');
  assert.equal(R.parseRanges('abc').error.code, 'invalid');
});

test('adres üreteci ve sıralama anahtarı', () => {
  const r = R.parseRanges('192.168.1.253-192.168.1.255, 192.168.1.1');
  assert.deepEqual([...R.addresses(r.ranges)], ['192.168.1.1', '192.168.1.253', '192.168.1.254', '192.168.1.255']);
  assert.ok(R.ipKey('192.168.1.10') < R.ipKey('192.168.1.9') === false);
  assert.ok(R.ipKey('192.168.1.9') < R.ipKey('192.168.1.10'));
  assert.equal(R.ipKey('x'), -1);
  assert.equal(R.intToIp(R.ipToInt('172.16.5.6')), '172.16.5.6');
  assert.equal(R.isPrivate(R.ipToInt('169.254.0.1')), true);
  assert.equal(R.isPrivate(R.ipToInt('192.0.2.1')), false);
});
