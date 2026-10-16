// IP aralığı ayrıştırma ve özel-adres denetimi (yalnız IPv4). Hem ana süreçte (require) hem pencerelerde (<script>) çalışır.
//
// Kabul edilen yazımlar (virgülle, noktalı virgülle, boşlukla ya da satır sonuyla ayrılır):
//   192.168.1.10                 tek adres
//   192.168.1.1-192.168.1.255    başlangıç-bitiş
//   192.168.1.1-255              kısa yazım: yalnız son sekizli
//   192.168.1.0/24               CIDR; /30 ve daha genişte ağ ve yayın adresleri atlanır
//
// Tasarım sınırı: yalnız özel/yerel adresler taranır — RFC 1918 (10/8, 172.16/12, 192.168/16) ve bağlantı-yerel
// (169.254/16). Başka bir adres (internet, döngü, belgeleme aralıkları...) içeren kayıt kaydedilmez; "not_private"
// hatasıyla reddedilir. Toplam en çok MAX_ADDRESSES (65.536 = bir /16) adres; üstü "too_many".
(function (root) {
  'use strict';

  const MAX_ADDRESSES = 65536;

  function ipToInt(s) {
    const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(String(s).trim());
    if (!m) return null;
    const p = m.slice(1).map(Number);
    if (p.some((x) => x > 255)) return null;
    return ((p[0] << 24) >>> 0) + (p[1] << 16) + (p[2] << 8) + p[3];
  }

  function intToIp(n) {
    return [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
  }

  const err = (code, token) => ({ code, token: token || '' });

  // Tek parça → { start, end } ya da { error }
  function parseToken(tok) {
    if (/:/.test(tok)) return { error: err('ipv6', tok) };
    let m = /^([\d.]+)\/(\d{1,2})$/.exec(tok);
    if (m) {
      const base = ipToInt(m[1]);
      const bits = Number(m[2]);
      if (base == null || bits > 32) return { error: err('invalid', tok) };
      if (bits < 16) return { error: err('too_many', tok) };
      const size = 2 ** (32 - bits);
      const net = (base & ((0xffffffff << (32 - bits)) >>> 0)) >>> 0;
      let start = net;
      let end = net + size - 1;
      if (bits <= 30) { start += 1; end -= 1; } // ağ ve yayın adresi taranmaz
      return { start, end, text: tok };
    }
    m = /^([\d.]+)\s*-\s*([\d.]+)$/.exec(tok);
    if (m) {
      const start = ipToInt(m[1]);
      let end = null;
      if (/^\d{1,3}$/.test(m[2])) {
        const last = Number(m[2]);
        if (start != null && last <= 255) end = ((start & 0xffffff00) >>> 0) + last;
      } else end = ipToInt(m[2]);
      if (start == null || end == null) return { error: err('invalid', tok) };
      if (start > end) return { error: err('reversed', tok) };
      return { start, end, text: tok };
    }
    const one = ipToInt(tok);
    if (one == null) return { error: err('invalid', tok) };
    return { start: one, end: one, text: tok };
  }

  // Örtüşen ve bitişik aralıkları birleştirir
  function mergeRanges(list) {
    const s = list.map((r) => ({ start: r.start, end: r.end })).sort((a, b) => a.start - b.start);
    const out = [];
    for (const r of s) {
      const last = out[out.length - 1];
      if (last && r.start <= last.end + 1) last.end = Math.max(last.end, r.end);
      else out.push({ ...r });
    }
    return out;
  }

  // Taranabilir (özel/yerel) adres blokları — tasarım gereği yalnız bunlar
  const PRIVATE = [['10.0.0.0', 8], ['172.16.0.0', 12], ['192.168.0.0', 16], ['169.254.0.0', 16]]
    .map(([ip, bits]) => { const mask = (0xffffffff << (32 - bits)) >>> 0; return { net: ipToInt(ip), mask, last: (ipToInt(ip) | (~mask >>> 0)) >>> 0 }; });

  const isPrivate = (n) => PRIVATE.some((b) => ((n & b.mask) >>> 0) === b.net);

  // Aralığın tamamı tek bir özel blok içinde mi? (bloklar bitişik olmadığından başlangıç ve bitişin aynı blokta
  // olması yeterlidir)
  function rangeIsPrivate(r) {
    const b = PRIVATE.find((x) => ((r.start & x.mask) >>> 0) === x.net);
    return !!b && r.end <= b.last;
  }

  // Metni ayrıştırır → { ok, ranges: [{start,end}], count, error: {code, token} }
  // Hata kodları: empty, invalid, ipv6, reversed, too_many, not_private
  function parseRanges(text) {
    const tokens = String(text || '').split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean)
      // "192.168.1.1 - 192.168.1.9" gibi boşluklu tireyi birleştir
      .reduce((acc, tok) => {
        const prev = acc[acc.length - 1];
        if (tok === '-' || (prev && /-$/.test(prev)) || (prev && /^-/.test(tok))) acc[acc.length - 1] = (prev || '') + tok;
        else acc.push(tok);
        return acc;
      }, []);
    if (!tokens.length) return { ok: false, ranges: [], count: 0, error: err('empty') };
    const parsed = [];
    for (const tok of tokens) {
      const r = parseToken(tok);
      if (r.error) return { ok: false, ranges: [], count: 0, error: r.error };
      if (!rangeIsPrivate(r)) return { ok: false, ranges: [], count: 0, error: err('not_private', tok) };
      parsed.push(r);
    }
    const ranges = mergeRanges(parsed);
    const count = ranges.reduce((n, r) => n + (r.end - r.start + 1), 0);
    if (count > MAX_ADDRESSES) return { ok: false, ranges, count, error: err('too_many', String(count)) };
    return { ok: true, ranges, count, error: null };
  }

  // Aralıklardaki adresler sırayla
  function* addresses(ranges) {
    for (const r of ranges) for (let n = r.start; n <= r.end; n++) yield intToIp(n);
  }

  // Aralıkları kısa metin olarak ("192.168.1.1-192.168.1.254")
  const formatRanges = (ranges) => ranges.map((r) => (r.start === r.end ? intToIp(r.start) : `${intToIp(r.start)}-${intToIp(r.end)}`)).join(', ');

  // Sıralama için sayısal anahtar
  const ipKey = (ip) => { const n = ipToInt(ip); return n == null ? -1 : n; };

  const api = { MAX_ADDRESSES, ipToInt, intToIp, parseRanges, mergeRanges, addresses, formatRanges, ipKey, isPrivate, rangeIsPrivate };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RANGES = api;
})(typeof self !== 'undefined' ? self : this);
