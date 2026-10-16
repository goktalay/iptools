// IEEE MA-L (OUI) listesinden gömülü üretici tablosunu üretir: src/data/oui.tsv.gz
// Biçim: her satırda "AABBCC<TAB>Üretici adı", OUI sırasıyla.
// Kullanım: node scripts/update-oui.js [oui.txt]   (dosya verilmezse standards-oui.ieee.org'dan indirilir)
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const URL = 'https://standards-oui.ieee.org/oui/oui.txt';
const OUT = path.join(__dirname, '..', 'src', 'data', 'oui.tsv.gz');

// "Cisco Systems, Inc" ve "CISCO SYSTEMS, INC." aynı görünsün: fazla boşluk ve sondaki nokta temizlenir
const clean = (s) => s.replace(/\s+/g, ' ').replace(/[\s.,]+$/, '').trim();

async function main() {
  const src = process.argv[2];
  const text = src ? fs.readFileSync(src, 'utf8') : await (await fetch(URL)).text();
  const map = new Map();
  for (const m of text.matchAll(/^([0-9A-F]{6})\s+\(base 16\)\s+(.*)$/gm)) {
    const name = clean(m[2]);
    if (name) map.set(m[1], name);
  }
  if (map.size < 10000) throw new Error(`beklenenden az kayıt: ${map.size}`);
  const lines = [...map.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([k, v]) => `${k}\t${v}`);
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, zlib.gzipSync(Buffer.from(lines.join('\n') + '\n', 'utf8'), { level: 9 }));
  console.log(`${map.size} OUI → ${path.relative(process.cwd(), OUT)} (${fs.statSync(OUT).size} bayt)`);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
