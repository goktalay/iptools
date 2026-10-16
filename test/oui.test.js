'use strict';
// MAC → üretici: gömülü IEEE OUI tablosu (src/data/oui.tsv.gz)
const test = require('node:test');
const assert = require('node:assert/strict');
const OUI = require('../src/oui');

test('MAC yazımları normalize edilir', () => {
  assert.equal(OUI.normalizeMac('b8-27-eb-12-34-56'), 'B8:27:EB:12:34:56');
  assert.equal(OUI.normalizeMac('b8:27:eb:12:34:56'), 'B8:27:EB:12:34:56');
  assert.equal(OUI.normalizeMac('b827.eb12.3456'), 'B8:27:EB:12:34:56');
  assert.equal(OUI.normalizeMac('b827eb123456'), 'B8:27:EB:12:34:56');
  assert.equal(OUI.normalizeMac('0:1a:11:a:b:c'), '00:1A:11:0A:0B:0C');
  assert.equal(OUI.normalizeMac('ff-ff-ff-ff-ff-ff'), null);
  assert.equal(OUI.normalizeMac('00-00-00-00-00-00'), null);
  assert.equal(OUI.normalizeMac('abc'), null);
  assert.equal(OUI.normalizeMac(''), null);
});

test('bilinen OUI üreticiye eşlenir; yerel yönetimli (rastgele) adreslerin üreticisi yoktur', () => {
  const r = OUI.lookup('B8:27:EB:00:00:01');
  assert.equal(r.vendor, 'Raspberry Pi Foundation');
  assert.equal(r.local, false);
  assert.equal(OUI.lookup('3c-5a-b4-00-00-01').vendor, 'Google, Inc');
  assert.equal(OUI.lookup('00:00:01:aa:bb:cc').vendor, 'XEROX CORPORATION');
  const local = OUI.lookup('B A:27:EB:00:00:01'.replace(' ', '')); // ilk sekizli 0xBA: 2. bit set → yerel
  assert.deepEqual([local.vendor, local.local], [null, true]);
  assert.equal(OUI.lookup('01:00:5e:00:00:16').vendor, null); // çok noktaya yayın
  assert.equal(OUI.lookup('zz'), null);
});

test('gömülü tablo yeterince büyük', () => {
  const map = OUI.load();
  assert.ok(map.size > 30000, String(map.size));
  for (const [k, v] of map) { assert.match(k, /^[0-9A-F]{6}$/); assert.ok(v.length > 0); break; }
});
