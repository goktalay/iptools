// Sabit ve kısa port listesi — IP Tools'un tasarım sınırı. Hem ana süreçte (require) hem pencerelerde (<script>) çalışır.
//
// Kullanıcı bu listeyi genişletemez; Ayarlar › Tarama'da yalnız kapatabilir. Her port için yalnız standart bir TCP
// bağlantı denemesi yapılır (bağlandı / bağlanamadı). Bağlantı açılınca en çok şu kadarı yapılır (probe):
//   banner — sunucunun kendi gönderdiği karşılama satırı okunur (SSH, FTP, VNC); biz hiçbir şey göndermeyiz
//   http   — tek bir "GET /" isteği; yalnız <title> ve Server başlığı alınır (2 sn)
//   tls    — TLS el sıkışması; yalnız sunucunun sunduğu sertifikanın konu adı okunur, sonra http gibi "GET /"
//   none   — hiçbir şey okunmaz ve gönderilmez (yazıcı ham portu 9100: giden her bayt kâğıda basılabilir; RTSP, SMB, RDP,
//            veritabanları: özel protokol paketi gönderilmez)
(function (root) {
  'use strict';

  // key: etiket grubu (renk ve tıklama eylemi); name: etiket üstündeki ad
  const PORTS = [
    { port: 80, key: 'web', name: 'HTTP', probe: 'http' },
    { port: 443, key: 'web', name: 'HTTPS', probe: 'tls' },
    { port: 8080, key: 'web', name: 'HTTP 8080', probe: 'http' },
    { port: 8443, key: 'web', name: 'HTTPS 8443', probe: 'tls' },
    { port: 22, key: 'ssh', name: 'SSH', probe: 'banner' },
    { port: 21, key: 'ftp', name: 'FTP', probe: 'banner' },
    { port: 3389, key: 'rdp', name: 'RDP', probe: 'none' },
    { port: 445, key: 'smb', name: 'SMB', probe: 'none' },
    { port: 5432, key: 'db', name: 'PostgreSQL', probe: 'none' },
    { port: 3306, key: 'db', name: 'MySQL', probe: 'none' },
    { port: 1433, key: 'db', name: 'SQL Server', probe: 'none' },
    { port: 9100, key: 'printer', name: 'JetDirect', probe: 'none' },
    { port: 631, key: 'printer', name: 'IPP', probe: 'http' },
    { port: 5900, key: 'vnc', name: 'VNC', probe: 'banner' },
    { port: 554, key: 'camera', name: 'RTSP', probe: 'none' },
  ];

  const byPort = new Map(PORTS.map((p) => [p.port, p]));
  const portInfo = (port) => byPort.get(Number(port)) || null;
  const allPorts = () => PORTS.map((p) => p.port);

  // Ayarlardaki kapalı portlar düşülmüş liste. Liste hiçbir koşulda genişlemez: tanınmayan portlar yok sayılır.
  function activePorts(disabled) {
    const off = new Set((disabled || []).map(Number));
    return PORTS.filter((p) => !off.has(p.port)).map((p) => p.port);
  }

  // Kapalı port listesini temizler: yalnız listedeki portlar, tekrarsız, sıralı
  function sanitizeDisabled(list) {
    const out = new Set();
    for (const v of Array.isArray(list) ? list : []) if (byPort.has(Number(v))) out.add(Number(v));
    return [...out].sort((a, b) => a - b);
  }

  // Etiket grupları: renk ve tıklama eylemi (eylemin kendisi actions.js'te)
  const GROUPS = ['web', 'ssh', 'ftp', 'rdp', 'smb', 'db', 'printer', 'vnc', 'camera'];

  const api = { PORTS, GROUPS, portInfo, allPorts, activePorts, sanitizeDisabled };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PORTS = api;
})(typeof self !== 'undefined' ? self : this);
