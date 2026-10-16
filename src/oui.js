'use strict';

// MAC adresinden üretici (IEEE MA-L / OUI, gömülü liste: src/data/oui.tsv.gz — scripts/update-oui.js ile güncellenir).
// Yerel yönetimli adresler (ilk sekizlinin 2. biti) telefonların "özel Wi-Fi adresi" gibi rastgele adreslerdir;
// bunların üreticisi bilinemez.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const FILE = path.join(__dirname, 'data', 'oui.tsv.gz');
let table = null;

function load(file = FILE) {
  const map = new Map();
  const text = zlib.gunzipSync(fs.readFileSync(file)).toString('utf8');
  for (const line of text.split('\n')) {
    const i = line.indexOf('\t');
    if (i === 6) map.set(line.slice(0, 6), line.slice(7));
  }
  return map;
}

// "aa-bb-cc-dd-ee-ff", "AA:BB:CC:DD:EE:FF", "aabb.ccdd.eeff", "a:b:c:d:e:f" → "AA:BB:CC:DD:EE:FF" (geçersizse null)
function normalizeMac(mac) {
  const s = String(mac || '').trim();
  let hex = null;
  const parts = s.split(/[:-]/);
  if (parts.length === 6 && parts.every((p) => /^[0-9a-f]{1,2}$/i.test(p))) hex = parts.map((p) => p.padStart(2, '0')).join('');
  else if (/^[0-9a-f]{4}\.[0-9a-f]{4}\.[0-9a-f]{4}$/i.test(s)) hex = s.replace(/\./g, '');
  else if (/^[0-9a-f]{12}$/i.test(s)) hex = s;
  if (!hex) return null;
  hex = hex.toUpperCase();
  if (/^0{12}$|^F{12}$/.test(hex)) return null; // boş ya da yayın
  return hex.match(/../g).join(':');
}

// → { mac, vendor, local } ya da null
function lookup(mac) {
  const norm = normalizeMac(mac);
  if (!norm) return null;
  if (!table) table = load();
  const first = parseInt(norm.slice(0, 2), 16);
  const local = (first & 0x02) !== 0;
  const multicast = (first & 0x01) !== 0;
  const vendor = local || multicast ? null : table.get(norm.replace(/:/g, '').slice(0, 6)) || null;
  return { mac: norm, vendor, local };
}

module.exports = { lookup, normalizeMac, load };
