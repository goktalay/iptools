'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { STRINGS, LANGUAGES, createT, resolveLanguage } = require('../src/i18n');
const PORTS = require('../src/ports');

// Kodda kullanılan her anahtar sözlükte olmalı (dinamik anahtarlar dahil)
test('i18n: kullanılan anahtarlar sözlükte var', () => {
  const dir = path.join(__dirname, '..', 'src');
  const files = ['main.js', ...fs.readdirSync(path.join(dir, 'renderer')).filter((f) => f.endsWith('.js')).map((f) => 'renderer/' + f)];
  const used = new Set();
  for (const f of files) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    for (const m of src.matchAll(/\bt\('([\w.-]+)'/g)) used.add(m[1]);
    for (const m of src.matchAll(/'(auth\.[\w]+)'/g)) used.add(m[1]);
  }
  for (const k of ['ping', 'ports', 'names']) used.add('scan.phase' + k[0].toUpperCase() + k.slice(1));
  for (const k of ['all', 'new', 'gone', 'services']) used.add('scan.filter' + k[0].toUpperCase() + k.slice(1));
  for (const k of ['new', 'gone', 'same', 'live']) used.add('status.' + k);
  for (const k of PORTS.GROUPS) used.add('tag.group.' + k);
  for (const k of ['errEmpty', 'errInvalid', 'errIpv6', 'errReversed', 'errTooMany', 'errNotPrivate']) used.add('range.' + k);
  const missing = [...used].filter((k) => !k.endsWith('.') && !(k in STRINGS.en));
  assert.deepStrictEqual(missing, []);
});

// Mastertool standardı: 8 dil sabit sırayla, hepsinde aynı anahtarlar ve aynı yer tutucular
test('i18n: 8 dil, anahtar ve yer tutucu eşliği', () => {
  assert.deepStrictEqual(Object.keys(LANGUAGES), ['tr', 'en', 'fr', 'de', 'es', 'ar', 'zh', 'ru']);
  assert.strictEqual(LANGUAGES.ar.dir, 'rtl');
  const keys = Object.keys(STRINGS.en).sort();
  const ph = (s) => (String(s).match(/\{\w+\}/g) || []).sort().join();
  for (const l of Object.keys(LANGUAGES)) {
    assert.deepStrictEqual(Object.keys(STRINGS[l]).sort(), keys, l);
    for (const k of keys) {
      assert.strictEqual(ph(STRINGS[l][k]), ph(STRINGS.en[k]), `${l} ${k}`);
      assert.ok(String(STRINGS[l][k]).trim(), `${l} ${k} boş`);
      assert.ok(!/Quick Preview|SSH Master şu|Notepad Master şu/.test(STRINGS[l][k]), `${l} ${k}: başka uygulamanın metni`);
    }
  }
});

test('i18n: uyarı metni her dilde var ve yetki vurgusu taşır', () => {
  assert.strictEqual(STRINGS.tr['notice.text'], 'Yalnız sahibi olduğunuz ya da yetkili olduğunuz ağları tarayın.');
  for (const l of Object.keys(LANGUAGES)) assert.ok(STRINGS[l]['notice.text'].length > 10, l);
});

test('i18n: dil çözümleme ve yer tutucu doldurma', () => {
  assert.strictEqual(resolveLanguage('tr-TR'), 'tr');
  assert.strictEqual(resolveLanguage('pt-BR'), 'en');
  assert.strictEqual(resolveLanguage(''), 'en');
  assert.strictEqual(createT('tr')('rec.devices', { n: 3 }), '3 cihaz');
  assert.strictEqual(createT('xx')('rec.devices', { n: 3 }), '3 devices');
  assert.strictEqual(createT('en')('yok.anahtar'), 'yok.anahtar');
});
