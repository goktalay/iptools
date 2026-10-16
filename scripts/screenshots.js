// 1600×1000 ekran görüntüleri (gece + gündüz) ve manifest.json üretir: Türkçe set docs/screenshots/,
// İngilizce set docs/screenshots/en/ (aynı dosya adları).
// Arayüz gerçek dosyalardan (src/renderer) yüklenir; window.api örnek verilerle taklit edilir — gerçek ağ taraması,
// gerçek hesap ya da kişisel veri yok. Örnek cihazlar özel adres bloğundan (192.168.1.0/24) uydurma MAC'lerle; üretici
// adları gömülü OUI tablosundan.
//
// Kullanım: npm run screenshots   (Chromium yolu: CHROMIUM_PATH ya da Playwright'ın varsayılanı)
'use strict';

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
const PORTS = require('../src/ports');
const OUI = require('../src/oui');

const ROOT = path.join(__dirname, '..');
const OUT_BASE = path.join(ROOT, 'docs', 'screenshots');
const W = 1600;
const H = 1000;
const NOW = Date.UTC(2026, 9, 15, 11, 32); // 15.10.2026 14:32 (UTC+3)

const SAMPLE = {
  tr: { email: 'ornek@example.com', name: 'Örnek Kullanıcı', winUser: 'Ornek', password: 'örnekşifre', locale: 'tr-TR', tz: 'Europe/Istanbul' },
  en: { email: 'sample@example.com', name: 'Sample User', winUser: 'Sample', password: 'samplepass', locale: 'en-US', tz: 'Europe/London' },
};

const port = (p, extra = {}) => { const i = PORTS.portInfo(p); return { port: p, key: i.key, name: i.name, banner: null, title: null, server: null, status: null, tls: null, ...extra }; };
const mac = (m) => ({ mac: m, vendor: OUI.lookup(m).vendor });
const cert = (cn, issuer, self) => ({ cn, org: null, issuer, notAfter: '2031-03-01T00:00:00.000Z', selfSigned: self });

// Örnek tarama sonucu ("Ofis ağı", 192.168.1.0/24)
function hosts(lang) {
  const tr = lang === 'tr';
  return [
    { ip: '192.168.1.1', alive: 'ping', rttMs: 1, ttl: 64, ...mac('50:C7:BF:4A:12:01'), name: tr ? 'modem.lan' : 'router.lan', mdns: null, status: 'same',
      ports: [port(80, { title: tr ? 'TP-Link Yönetim' : 'TP-Link Admin', server: 'lighttpd', status: 200 }), port(443, { tls: cert('tplinkwifi.net', 'tplinkwifi.net', true) })] },
    { ip: '192.168.1.2', alive: 'ping', rttMs: 1, ttl: 64, ...mac('74:AC:B9:0C:7E:02'), name: tr ? 'ap-kat1.lan' : 'ap-floor1.lan', mdns: null, status: 'same', ports: [port(22, { banner: 'SSH-2.0-OpenSSH_8.4' }), port(443, { tls: cert('UniFi', 'UniFi', true) })] },
    { ip: '192.168.1.10', alive: 'ping', rttMs: 2, ttl: 64, ...mac('00:11:32:9F:21:10'), name: 'nas.lan', mdns: 'DiskStation.local', status: 'same',
      ports: [port(22, { banner: 'SSH-2.0-OpenSSH_8.2' }), port(80, { title: 'DiskStation', server: 'nginx', status: 200 }), port(443, { tls: cert('synology.com', 'Synology Inc. CA', false), title: 'DiskStation', server: 'nginx', status: 200 }), port(445)] },
    { ip: '192.168.1.20', alive: 'ping', rttMs: 3, ttl: 64, ...mac('3C:D9:2B:7D:00:20'), name: tr ? 'yazici-ofis.lan' : 'printer-office.lan', mdns: 'HP LaserJet M404.local', status: 'same',
      ports: [port(80, { title: 'HP LaserJet Pro M404', server: 'HP HTTP Server', status: 200 }), port(631, { title: 'HP LaserJet Pro M404', status: 200 }), port(9100)] },
    { ip: '192.168.1.30', alive: 'ping', rttMs: 4, ttl: 64, ...mac('44:19:B6:A2:55:30'), name: null, mdns: null, status: 'same',
      ports: [port(80, { title: tr ? 'Kamera Girişi' : 'Camera Login', server: 'App-webs/', status: 200 }), port(554)] },
    { ip: '192.168.1.41', alive: 'ping', rttMs: 1, ttl: 128, ...mac('D4:BE:D9:3B:1C:41'), name: tr ? 'muhasebe-pc.lan' : 'finance-pc.lan', mdns: null, status: 'same', ports: [port(445), port(3389)] },
    { ip: '192.168.1.42', alive: 'ping', rttMs: 1, ttl: 128, ...mac('F0:18:98:11:22:42'), name: null, mdns: tr ? 'tasarim-mac.local' : 'design-mac.local', status: 'same', ports: [port(22, { banner: 'SSH-2.0-OpenSSH_9.6' }), port(5900, { banner: 'RFB 003.889' })] },
    { ip: '192.168.1.50', alive: 'ping', rttMs: 2, ttl: 64, ...mac('00:0C:29:5E:77:50'), name: 'db01.lan', mdns: null, status: 'same', ports: [port(22, { banner: 'SSH-2.0-OpenSSH_9.6p1 Ubuntu-3ubuntu13' }), port(3306), port(5432)] },
    { ip: '192.168.1.60', alive: 'ping', rttMs: 1, ttl: 64, ...mac('B8:27:EB:2A:6F:60'), name: 'pihole.lan', mdns: 'pihole.local', status: 'same', ports: [port(22, { banner: 'SSH-2.0-OpenSSH_9.2p1 Debian-2' }), port(80, { title: 'Pi-hole - pihole', server: 'lighttpd/1.4.69', status: 200 })] },
    { ip: '192.168.1.77', alive: 'ping', rttMs: 9, ttl: 64, ...mac('C4:41:1E:08:90:77'), name: null, mdns: null, status: 'new', ports: [port(80, { title: 'Belkin', status: 200 })] },
    { ip: '192.168.1.103', alive: 'arp', rttMs: null, ttl: null, mac: 'DA:5B:1C:33:F0:03', vendor: null, localMac: true, name: null, mdns: null, status: 'same', ports: [] },
    { ip: '192.168.1.120', alive: 'ping', rttMs: 6, ttl: 64, ...mac('00:1A:11:7C:4D:20'), name: null, mdns: tr ? 'Chromecast-Salon.local' : 'Chromecast-Lounge.local', status: 'same', ports: [port(8443, { tls: cert('cast', 'cast', true) })] },
    { ip: '192.168.1.88', alive: 'ping', rttMs: 2, ttl: 128, ...mac('E8:48:B8:19:AA:88'), name: tr ? 'eski-laptop.lan' : 'old-laptop.lan', mdns: null, status: 'gone', ports: [port(445)] },
  ];
}

function store(lang, { scanning = null, summariesFor = ['r1'] } = {}) {
  const tr = lang === 'tr';
  const folders = [{ id: 'f1', name: tr ? 'Şubeler' : 'Branches', parentId: null, createdAt: NOW }];
  const records = [
    { id: 'r1', name: tr ? 'Ofis ağı' : 'Office network', color: '#22d3ee', range: '192.168.1.0/24', folderId: null, createdAt: NOW },
    { id: 'r2', name: tr ? 'Depo Wi-Fi' : 'Warehouse Wi-Fi', color: '#f97316', range: '192.168.10.1-192.168.10.120', folderId: null, createdAt: NOW },
    { id: 'r3', name: tr ? 'Sunucu odası' : 'Server room', color: '#a855f7', range: '10.0.0.0/24, 10.0.1.0/24', folderId: null, createdAt: NOW },
    { id: 'r4', name: tr ? 'Kadıköy şube' : 'Downtown branch', color: '#34d399', range: '10.10.0.0/24', folderId: 'f1', createdAt: NOW },
  ];
  const hs = hosts(lang);
  const summaries = {};
  if (summariesFor.includes('r1')) summaries.r1 = { finishedAt: NOW, startedAt: NOW - 9000, count: hs.filter((h) => h.status !== 'gone').length, newCount: hs.filter((h) => h.status === 'new').length };
  if (summariesFor.includes('r2')) summaries.r2 = { finishedAt: NOW - 86400000 * 2, startedAt: NOW - 86400000 * 2 - 6000, count: 7, newCount: 0 };
  return {
    folders, records, summaries, scanning,
    settings: { appTheme: 'system', language: lang, scan: { disabledPorts: [21], concurrency: 64, timeoutMs: 1000 }, openAtLogin: false, minimizeToTray: true, closeToTray: false, checkUpdates: true, noticeAccepted: true },
    ports: PORTS.PORTS, limits: { maxConcurrency: 64, maxTimeoutMs: 1000 },
  };
}

// window.api taklidi (preload.js ile aynı yüzey)
function stubScript({ lang, store: st, scan }) {
  const S = SAMPLE[lang];
  return `(() => {
    const STORE = ${JSON.stringify(st)};
    const SCAN = ${JSON.stringify(scan)};
    const listeners = {};
    const on = (name) => (cb) => { (listeners[name] = listeners[name] || []).push(cb); return () => {}; };
    window.__emit = (name, data) => (listeners[name] || []).forEach((cb) => cb(data));
    window.api = {
      lang: ${JSON.stringify(lang)}, version: '1.0.0',
      accountState: async () => ({ loggedIn: true, email: ${JSON.stringify(S.email)}, user: { id: 1, name: ${JSON.stringify(S.name)}, email: ${JSON.stringify(S.email)} }, syncEnabled: true, state: 'ok', lastSyncAt: ${NOW}, error: null, notice: null, appVersion: '1.0.0' }),
      login: async () => ({ ok: false }), logout: async () => {}, syncNow: async () => {}, setSyncEnabled: async () => ({ ok: true }), deleteRemoteLibrary: async () => ({ ok: true }),
      openWeb: async () => {}, onAccountStatus: on('account'), onUpdateAvailable: on('update'), openMastertool: async () => {},
      about: async () => ({ version: '1.0.0', electron: '33.4.11', chrome: '130.0.6723.191', openAtLogin: false, portable: false, packaged: true, update: null }),
      checkUpdate: async () => ({ ok: true, newer: false }), openLicenses: async () => {},
      getStore: async () => STORE, onStoreChanged: on('store'), setSettings: async () => ({ ok: true }),
      saveRecord: async (r) => ({ ok: true, record: { id: 'rX', ...r } }), deleteRecord: async () => ({ ok: true }), saveFolder: async () => ({ ok: true }), deleteFolder: async () => ({ ok: true }),
      moveRecords: async () => ({ ok: true }), acceptNotice: async () => ({ ok: true }),
      startScan: async () => ({ ok: true }), stopScan: async () => ({ ok: true }), getScan: async (id) => (id === 'r1' ? SCAN : null),
      onScanProgress: on('progress'), onScanDone: on('done'), exportScan: async () => ({ ok: true, path: 'C:\\\\Users\\\\${S.winUser}\\\\Documents\\\\scan.csv' }),
      tagAction: async (g, ip) => ({ ok: true, kind: 'copy', text: ip }), copyText: async () => ({ ok: true }), openUrl: async () => ({ ok: true }),
    };
    localStorage.setItem('ipt.selected', 'r1');
  })();`;
}

// Başlık ve açıklamalar (≤ 80 karakter); dosya adları iki dilde aynı
const TEXT = {
  tr: {
    main: ['Kayıtlar ve bulunan cihazlar', 'Kayda tıklayın: aralık taranır; IP, ad, MAC, üretici, yanıt süresi ve servisler'],
    scan: ['Tarama sürüyor', 'En çok 64 eşzamanlı bağlantı, cihaz başına 1 sn; ilerleme ve Durdur'],
    details: ['Cihaz ayrıntıları', 'Karşılama satırı, sayfa başlığı, Server başlığı ve TLS sertifika konu adı'],
    newgone: ['Yeni ve kaybolan cihazlar', 'Önceki taramaya göre yeni gelen ve kaybolan cihazlar vurgulanır'],
    form: ['Kayıt formu ve adres denetimi', 'Yalnız özel adresler (10.x, 172.16–31.x, 192.168.x) kabul edilir; en çok /16'],
    setscan: ['Ayarlar › Tarama', 'Sabit port listesi yalnız kapatılabilir; eşzamanlılık ≤ 64, zaman aşımı ≤ 1 sn'],
    general: ['Ayarlar › Genel', 'Dil, Gece/Gündüz/Sistem teması, Windows ile başlat, tepsi ve güncellemeler'],
    login: ['Tek giriş', 'Mastertool hesabıyla bir kez giriş yapın; diğer uygulamalar yeniden sormaz'],
  },
  en: {
    main: ['Records and discovered devices', 'Click a record to scan its range: IP, name, MAC, vendor, response, services'],
    scan: ['Scan in progress', 'At most 64 concurrent connections, 1 s per device; progress and Stop'],
    details: ['Device details', 'Greeting line, page title, Server header and TLS certificate subject name'],
    newgone: ['New and gone devices', 'Devices that appeared or disappeared since the previous scan are highlighted'],
    form: ['Record form and address check', 'Only private addresses (10.x, 172.16–31.x, 192.168.x) are accepted; at most /16'],
    setscan: ['Settings › Scan', 'The fixed port list can only be narrowed; concurrency ≤ 64, timeout ≤ 1 s'],
    general: ['Settings › General', 'Language, Dark/Light/System theme, start with Windows, tray and updates'],
    login: ['Single sign-on', 'Sign in once with your Mastertool account; the other apps won’t ask again'],
  },
};

async function main() {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  for (const lang of ['tr', 'en']) {
    const OUT = lang === 'tr' ? OUT_BASE : path.join(OUT_BASE, lang);
    fs.mkdirSync(OUT, { recursive: true });
    const T = TEXT[lang];
    const S = SAMPLE[lang];
    const hs = hosts(lang);
    const scan = { recordId: 'r1', startedAt: NOW - 9000, finishedAt: NOW, scanned: 254, stopped: false, hosts: hs };
    const manifest = [];
    const errors = [];

    const shot = async (file, theme, [title, caption], run) => {
      if (caption.length > 80) throw new Error(`caption > 80: ${caption}`);
      const ctx = await browser.newContext({ viewport: { width: W, height: H }, colorScheme: theme, locale: S.locale, timezoneId: S.tz });
      const page = await ctx.newPage();
      page.on('pageerror', (e) => errors.push(`${file}: ${e.message}`));
      page.on('console', (m) => { if (m.type() === 'error') errors.push(`${file}: ${m.text()}`); });
      await run(page, theme === 'dark');
      await page.waitForTimeout(400); // animasyonlar otursun
      await page.screenshot({ path: path.join(OUT, file) });
      await ctx.close();
      manifest.push({ file, theme, title, caption });
      console.log('✓', lang, file);
    };
    const openMain = async (page, st, after) => {
      await page.addInitScript(stubScript({ lang, store: st, scan }));
      await page.goto('file://' + path.join(ROOT, 'src', 'renderer', 'index.html'));
      await page.waitForSelector('.rec-card');
      await page.waitForSelector('table.hosts');
      if (after) await after(page);
    };

    for (const theme of ['dark', 'light']) {
      const tn = theme === 'dark' ? 'gece' : 'gunduz';
      await shot(`01-kayitlar-${tn}.png`, theme, T.main, (p) => openMain(p, store(lang, { summariesFor: ['r1', 'r2'] })));
      await shot(`02-tarama-${tn}.png`, theme, T.scan, (p) => openMain(p, store(lang, { summariesFor: ['r1', 'r2'] }), async (pg) => {
        const st = store(lang, { scanning: { recordId: 'r1', startedAt: NOW }, summariesFor: ['r1', 'r2'] });
        await pg.evaluate((s) => window.__emit('store', s), st);
        const partial = hs.slice(0, 6).map((h) => ({ ...h, name: null, mdns: null, ports: h.ports.slice(0, 1) }));
        await pg.evaluate((pr) => window.__emit('progress', pr), { recordId: 'r1', phase: 'ports', done: 61, total: 84, found: 6, hosts: partial });
      }));
      await shot(`03-ayrintilar-${tn}.png`, theme, T.details, (p) => openMain(p, store(lang, { summariesFor: ['r1', 'r2'] }), async (pg) => {
        await pg.dblclick('tr[data-ip="192.168.1.10"]');
        await pg.waitForSelector('.modal');
      }));
      await shot(`04-yeni-kaybolan-${tn}.png`, theme, T.newgone, (p) => openMain(p, store(lang, { summariesFor: ['r1', 'r2'] }), async (pg) => {
        await pg.evaluate((d) => window.__emit('done', d), { recordId: 'r1', scan });
        await pg.hover('tr[data-ip="192.168.1.77"]');
      }));
      await shot(`05-kayit-formu-${tn}.png`, theme, T.form, (p) => openMain(p, store(lang, { summariesFor: ['r1', 'r2'] }), async (pg) => {
        await pg.click('#btnNewRecord');
        await pg.waitForSelector('.modal');
        await pg.fill('#f-name', lang === 'tr' ? 'Misafir ağı' : 'Guest network');
        await pg.fill('#f-range', '192.168.20.0/24, 8.8.8.0/24');
        await pg.waitForSelector('.range-check.show');
      }));
      await shot(`06-ayarlar-tarama-${tn}.png`, theme, T.setscan, (p) => openMain(p, store(lang, { summariesFor: ['r1', 'r2'] }), async (pg) => {
        await pg.click('#btnSettings');
        await pg.waitForSelector('.set-wrap');
        await pg.click('.set-nav [data-tab="scan"]');
      }));
      await shot(`07-ayarlar-genel-${tn}.png`, theme, T.general, (p) => openMain(p, store(lang, { summariesFor: ['r1', 'r2'] }), async (pg) => {
        await pg.click('#btnSettings');
        await pg.waitForSelector('.set-wrap');
      }));
      // Giriş penceresi 440×640; masaüstü zemini üzerinde ortalanır
      await shot(`08-giris-${tn}.png`, theme, T.login, async (p, dark) => {
        const lp = await p.context().newPage();
        lp.on('pageerror', (e) => errors.push(`login: ${e.message}`));
        await lp.setViewportSize({ width: 440, height: 640 });
        await lp.addInitScript(stubScript({ lang, store: store(lang), scan }));
        await lp.addInitScript(() => { const a = window.api.accountState; window.api.accountState = async () => ({ ...(await a()), loggedIn: false }); });
        await lp.goto('file://' + path.join(ROOT, 'src', 'renderer', 'login.html'));
        await lp.waitForTimeout(300);
        await lp.evaluate((pw) => { document.querySelector('#password').value = pw; document.activeElement.blur(); }, S.password);
        const png = (await lp.screenshot()).toString('base64');
        await lp.close();
        const icon = fs.readFileSync(path.join(ROOT, 'build', 'icon.svg')).toString('base64');
        const bg = dark ? 'radial-gradient(900px 600px at 80% 0%, #1e2a4a, transparent), radial-gradient(800px 600px at 0% 100%, #0f3a44, transparent), #0b0f17'
          : 'radial-gradient(900px 600px at 80% 0%, #dbe4ff, transparent), radial-gradient(800px 600px at 0% 100%, #d5f5fb, transparent), #eef2f7';
        await p.setContent(`<body style="margin:0;height:100vh;display:grid;place-items:center;background:${bg}">
          <div style="border-radius:10px;overflow:hidden;box-shadow:0 30px 80px rgba(0,0,0,${dark ? '.55' : '.22'}),0 0 0 1px rgba(${dark ? '255,255,255,.08' : '0,0,0,.08'})">
            <div style="height:32px;background:${dark ? '#1c1f26' : '#f3f3f3'};display:flex;align-items:center;gap:8px;padding:0 12px;font:12px 'Segoe UI',system-ui;color:${dark ? '#ddd' : '#333'}">
              <img src="data:image/svg+xml;base64,${icon}" style="width:16px;height:16px;border-radius:4px">IP Tools</div>
            <img src="data:image/png;base64,${png}" style="display:block;width:440px;height:640px"></div></body>`);
      });
    }
    fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    console.log(`${manifest.length} görüntü → ${path.relative(ROOT, OUT)}`);
    if (errors.length) { console.error('Sayfa hataları:\n' + errors.join('\n')); process.exitCode = 1; }
  }
  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
