// Servis etiketine tıklayınca ne olacağı (saf karar işlevi; çalıştırma main.js'te). Hem ana süreçte hem pencerelerde.
//
//   web      → tarayıcıda http(s)://ip[:port]
//   printer  → tarayıcıda http://ip (yazıcıların web paneli)
//   rdp      → Uzak Masaüstü: mstsc /v:ip
//   smb      → Gezgin'de \\ip
//   ssh, ftp, db, vnc, camera → adresi panoya kopyala (ileride aile uygulamalarına derin bağlantı: DEEP_LINKS)
(function (root) {
  'use strict';

  const PORTS = typeof module !== 'undefined' && module.exports ? require('./ports') : root.PORTS;

  // Aile uygulamalarına derin bağlantı için tek yer. Bir grup için şablon tanımlanınca etiket tıklaması "kopyala"
  // yerine bu adresi açar (ör. ssh: 'sshmaster://connect?host={ip}&port={port}'). Şimdilik boş.
  const DEEP_LINKS = {};

  const tlsPort = (port) => { const p = PORTS.portInfo(port); return !!p && p.probe === 'tls'; };

  // → { kind: 'open' | 'run' | 'explorer' | 'copy', target: string, text: string }
  function actionFor(group, ip, port) {
    const p = Number(port) || 0;
    if (DEEP_LINKS[group]) {
      const url = DEEP_LINKS[group].replace('{ip}', ip).replace('{port}', String(p));
      return { kind: 'open', target: url, text: url };
    }
    switch (group) {
      case 'web': {
        const scheme = tlsPort(p) ? 'https' : 'http';
        const std = (scheme === 'http' && p === 80) || (scheme === 'https' && p === 443);
        const url = `${scheme}://${ip}${std ? '' : ':' + p}/`;
        return { kind: 'open', target: url, text: url };
      }
      case 'printer': {
        const url = `http://${ip}/`;
        return { kind: 'open', target: url, text: url };
      }
      case 'rdp': return { kind: 'run', target: 'mstsc', args: ['/v:' + ip], text: `mstsc /v:${ip}` };
      case 'smb': return { kind: 'explorer', target: `\\\\${ip}`, text: `\\\\${ip}` };
      case 'ssh': return { kind: 'copy', target: p && p !== 22 ? `ssh -p ${p} ${ip}` : `ssh ${ip}`, text: ip };
      case 'ftp': return { kind: 'copy', target: `ftp://${ip}${p && p !== 21 ? ':' + p : ''}/`, text: `ftp://${ip}/` };
      case 'camera': return { kind: 'copy', target: `rtsp://${ip}${p && p !== 554 ? ':' + p : ''}/`, text: `rtsp://${ip}/` };
      case 'vnc': return { kind: 'copy', target: `${ip}${p && p !== 5900 ? ':' + (p - 5900) : ''}`, text: ip };
      case 'db': return { kind: 'copy', target: `${ip}:${p}`, text: `${ip}:${p}` };
      default: return { kind: 'copy', target: ip, text: ip };
    }
  }

  const api = { DEEP_LINKS, actionFor };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ACTIONS = api;
})(typeof self !== 'undefined' ? self : this);
