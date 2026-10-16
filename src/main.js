'use strict';

// IP Tools — ana süreç. Kayıtlı IP aralıklarını tarar (bkz. scanner.js'teki tasarım sınırları), sonuçları yalnız
// bu bilgisayarda saklar; kayıtlar, klasörler ve ayarlar Mastertool hesabıyla uçtan uca şifreli senkronlanır.

const { app, BrowserWindow, ipcMain, safeStorage, shell, dialog, clipboard, nativeTheme, Tray, Menu, nativeImage, Notification } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { spawn } = require('child_process');
const I18N = require('./i18n');
const PORTS = require('./ports');
const RANGES = require('./ranges');
const ACTIONS = require('./actions');
const OUI = require('./oui');
const { createScanner, canRescan, diffScans, toCsv, clampConcurrency, clampTimeout, MAX_CONCURRENCY, MAX_TIMEOUT_MS } = require('./scanner');
const { createAccount, API_BASE } = require('./account');
const { createSso } = require('./sso');

const ICON = path.join(__dirname, '..', 'build', 'icon.png');
const APP_NAME = 'IP Tools';
const APP_CODE = 'ip';

// Tek örnek: ikinci çalıştırma açık pencereyi öne getirir
if (!app.requestSingleInstanceLock()) {
  app.exit(0);
} else {
  app.on('second-instance', () => showMainWindow());
  main();
}

function main() {
  // Arayüz dili: ayarlarda seçilen ya da sistem dili (desteklenmiyorsa İngilizce)
  let t = I18N.createT('en');
  const currentLang = () => (store && store.settings.language) || I18N.resolveLanguage(app.getLocale());
  function applyLanguage() { t = I18N.createT(currentLang()); }

  // -------------------------------------------------------------------------
  // Kalıcı depo (userData/store.json) — kütüphane + ayarlar; tarama sonuçları ayrı (userData/scans/)
  // -------------------------------------------------------------------------
  const storePath = () => path.join(app.getPath('userData'), 'store.json');
  const scansDir = () => path.join(app.getPath('userData'), 'scans');

  const defaultScan = () => ({ disabledPorts: [], concurrency: MAX_CONCURRENCY, timeoutMs: MAX_TIMEOUT_MS });

  const defaultStore = () => ({
    syncMeta: {},
    folders: [],   // { id, name, parentId, createdAt }
    records: [],   // { id, name, color, range, folderId, createdAt }
    settings: {
      appTheme: 'system', // 'dark' | 'light' | 'system' (Mastertool standardı: varsayılan Sistem)
      language: null,     // null = sistem dili
      scan: defaultScan(),
      // cihaza özgü (senkronlanmaz)
      openAtLogin: false,
      minimizeToTray: true,
      closeToTray: false,
      checkUpdates: true,
      noticeAccepted: false, // "Yalnız sahibi olduğunuz ağları tarayın" onayı
      trayHintShown: false,
    },
  });

  let store = null;

  function sanitizeScan(s) {
    const v = s && typeof s === 'object' ? s : {};
    return {
      disabledPorts: PORTS.sanitizeDisabled(v.disabledPorts),
      concurrency: clampConcurrency(v.concurrency),
      timeoutMs: clampTimeout(v.timeoutMs),
    };
  }

  const sanitizeFolder = (f) => ({
    id: String(f.id || crypto.randomUUID()), name: String(f.name || '').trim().slice(0, 80) || '?',
    parentId: f.parentId ? String(f.parentId) : null, createdAt: Number(f.createdAt) || Date.now(),
  });
  const sanitizeRecord = (r) => ({
    id: String(r.id || crypto.randomUUID()), name: String(r.name || '').trim().slice(0, 80) || '?',
    color: /^#[0-9a-f]{6}$/i.test(String(r.color || '')) ? String(r.color).toLowerCase() : '#22d3ee',
    range: String(r.range || '').trim().slice(0, 2000), folderId: r.folderId ? String(r.folderId) : null,
    createdAt: Number(r.createdAt) || Date.now(),
  });

  function loadStore() {
    try {
      store = { ...defaultStore(), ...JSON.parse(fs.readFileSync(storePath(), 'utf8')) };
      store.settings = { ...defaultStore().settings, ...(store.settings || {}) };
      if (!store.syncMeta) store.syncMeta = {};
    } catch {
      store = defaultStore();
    }
    store.folders = (Array.isArray(store.folders) ? store.folders : []).map(sanitizeFolder);
    store.records = (Array.isArray(store.records) ? store.records : []).map(sanitizeRecord);
    store.settings.scan = sanitizeScan(store.settings.scan);
    applyAppTheme();
    applyLanguage();
  }

  let saveTimer = null;
  // Değişiklik kaydedilir ve (3 sn sonra) senkron tetiklenir; cihaza özgü kayıtlar için { sync: false }
  function saveStore({ sync = true } = {}) {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(writeStore, 150);
    if (sync && account) account.onLocalChange();
  }
  function writeStore() {
    clearTimeout(saveTimer);
    saveTimer = null;
    fs.mkdirSync(path.dirname(storePath()), { recursive: true });
    fs.writeFileSync(storePath(), JSON.stringify(store, null, 2), 'utf8');
  }

  // Gece / Gündüz / Sistem: tüm pencerelerin prefers-color-scheme'ini ve başlık çubuklarını belirler
  function applyAppTheme() {
    const v = store.settings.appTheme;
    nativeTheme.themeSource = v === 'dark' || v === 'light' ? v : 'system';
  }
  const windowBg = () => (nativeTheme.shouldUseDarkColors ? '#0b0f17' : '#eef2f7');

  function encrypt(text) {
    if (!text) return '';
    if (safeStorage.isEncryptionAvailable()) return 'enc:' + safeStorage.encryptString(text).toString('base64');
    return 'b64:' + Buffer.from(text, 'utf8').toString('base64');
  }
  function decrypt(value) {
    if (!value) return '';
    if (value.startsWith('enc:')) return safeStorage.decryptString(Buffer.from(value.slice(4), 'base64'));
    if (value.startsWith('b64:')) return Buffer.from(value.slice(4), 'base64').toString('utf8');
    return value;
  }

  // Arayüze giden ayarlar (cihaza özgü iç kayıtlar hariç)
  function publicSettings() {
    const { trayHintShown, ...rest } = store.settings;
    return { ...rest, language: store.settings.language || currentLang() };
  }

  // -------------------------------------------------------------------------
  // Tarama sonuçları: yalnız yerelde, kayıt başına bir dosya
  // -------------------------------------------------------------------------
  const scanFile = (id) => path.join(scansDir(), `${String(id).replace(/[^\w-]/g, '')}.json`);
  function readScan(id) {
    try { return JSON.parse(fs.readFileSync(scanFile(id), 'utf8')); } catch { return null; }
  }
  function writeScan(id, scan) {
    fs.mkdirSync(scansDir(), { recursive: true });
    fs.writeFileSync(scanFile(id), JSON.stringify(scan), 'utf8');
  }
  function deleteScan(id) {
    try { fs.unlinkSync(scanFile(id)); } catch { /* yok */ }
  }
  // Kart üzerindeki özet (son tarama zamanı, cihaz sayısı)
  function scanSummaries() {
    const out = {};
    for (const r of store.records) {
      const s = readScan(r.id);
      if (s) out[r.id] = { finishedAt: s.finishedAt, startedAt: s.startedAt, count: s.hosts.filter((h) => h.status !== 'gone').length, newCount: s.hosts.filter((h) => h.status === 'new').length };
    }
    return out;
  }

  function publicStore() {
    return {
      folders: store.folders, records: store.records, settings: publicSettings(), summaries: scanSummaries(),
      scanning: scanning ? { recordId: scanning.recordId, startedAt: scanning.startedAt } : null,
      ports: PORTS.PORTS, limits: { maxConcurrency: MAX_CONCURRENCY, maxTimeoutMs: MAX_TIMEOUT_MS },
    };
  }

  function broadcastStore() {
    const data = publicStore();
    for (const w of BrowserWindow.getAllWindows()) w.webContents.send('store:changed', data);
    if (tray) tray.setContextMenu(buildTrayMenu());
  }

  // -------------------------------------------------------------------------
  // Çalıştırılabilir dosya: taşınabilir sürümde geçici klasördeki değil, kullanıcının çalıştırdığı exe
  // -------------------------------------------------------------------------
  const exePath = () => process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
  const isPortable = () => !!process.env.PORTABLE_EXECUTABLE_FILE;

  const LOGIN_ITEM = 'MastertoolIPTools';
  function applyOpenAtLogin() {
    if (!app.isPackaged || process.platform !== 'win32') return;
    app.setLoginItemSettings({ openAtLogin: !!store.settings.openAtLogin, path: exePath(), args: ['--hidden'], name: LOGIN_ITEM });
  }
  const openAtLoginState = () => (app.isPackaged && process.platform === 'win32'
    ? app.getLoginItemSettings({ path: exePath(), args: ['--hidden'] }).openAtLogin
    : !!store.settings.openAtLogin);

  // -------------------------------------------------------------------------
  // Mastertool hesabı (mastertool.download, /api/ip) ve uçtan uca şifreli kütüphane senkronu
  // -------------------------------------------------------------------------
  let account = null;
  let loginWindow = null;
  let mainWindow = null;
  let loginNotice = null;
  let updateInfo = null;

  function initSso() {
    try {
      return createSso({ stateDir: path.join(app.getPath('appData'), 'Mastertool') });
    } catch {
      return null;
    }
  }

  function initAccount() {
    account = createAccount({
      sso: initSso(),
      onSharedSignIn: () => enterApp(),
      onSharedSignOut: (code) => showLogin(code === 'app_disabled' ? t('auth.errAppDisabled') : null),
      userDataDir: app.getPath('userData'),
      appVersion: app.getVersion(),
      encrypt,
      decrypt,
      getStore: () => store,
      // Senkrondan gelen kütüphaneyi uygula (yeni senkron tetiklemeden)
      replaceLibrary: ({ settings, folders, records, syncMeta }) => {
        const prevLang = currentLang();
        store.syncMeta = syncMeta;
        store.folders = folders.map(sanitizeFolder);
        // Yerelde taraması olan ama hesaptan silinmiş kayıtların sonuç dosyası da silinir
        const keep = new Set(records.map((r) => r.id));
        for (const r of store.records) if (!keep.has(r.id)) deleteScan(r.id);
        store.records = records.map(sanitizeRecord);
        Object.assign(store.settings, settings);
        store.settings.scan = sanitizeScan(store.settings.scan);
        writeStore();
        applyAppTheme();
        applyLanguage();
        if (currentLang() !== prevLang) onLanguageChanged();
        else broadcastStore();
      },
      persistStore: writeStore,
      resetSyncMeta: () => { store.syncMeta = {}; writeStore(); },
      onStatus: (st) => {
        for (const w of BrowserWindow.getAllWindows()) w.webContents.send('account:status', st);
      },
      onSessionExpired: (code) =>
        showLogin(t(code === 'app_disabled' ? 'auth.errAppDisabled' : code === 'wrong_app' ? 'auth.errWrongApp' : 'auth.errSessionExpired')),
      onUpdate: (info) => {
        updateInfo = info;
        notifyUpdate(info);
        for (const w of BrowserWindow.getAllWindows()) w.webContents.send('app:update', info);
      },
    });
  }

  function notifyUpdate(info) {
    if (!Notification.isSupported()) return;
    const n = new Notification({ title: t('update.available', { version: info.version }), body: t('update.hint'), icon: ICON, silent: true });
    n.on('click', () => openWeb('account'));
    n.show();
  }

  // Giriş yapıldı (şifreyle ya da ortak oturumla): giriş ekranı kapanır, ana pencere açılır
  function enterApp() {
    loginNotice = null;
    if (!mainWindow) createMainWindow();
    if (loginWindow) loginWindow.destroy();
    account.start().then(() => store.settings.checkUpdates && account.checkUpdate()).catch(() => {});
  }

  const webPreferences = { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false };

  function createLoginWindow() {
    loginWindow = new BrowserWindow({
      width: 440, height: 640, resizable: false, maximizable: false,
      backgroundColor: windowBg(), title: APP_NAME, icon: ICON, autoHideMenuBar: true, webPreferences,
    });
    loginWindow.setMenuBarVisibility(false);
    loginWindow.loadFile(path.join(__dirname, 'renderer', 'login.html'));
    loginWindow.on('closed', () => {
      loginWindow = null;
      if (!account || !account.isLoggedIn()) quit(); // girişsiz çalışılmaz
    });
  }

  // Oturum yoksa ya da düştüyse: giriş ekranını aç, ana pencereyi ve tepsiyi kapat
  function showLogin(notice) {
    loginNotice = notice || null;
    stopScan();
    destroyTray();
    if (!loginWindow) createLoginWindow();
    else {
      loginWindow.webContents.reload();
      if (loginWindow.isMinimized()) loginWindow.restore();
      loginWindow.show();
      loginWindow.focus();
    }
    for (const w of BrowserWindow.getAllWindows()) if (w !== loginWindow) w.destroy();
    mainWindow = null;
  }

  // -------------------------------------------------------------------------
  // Ana pencere ve tepsi
  // -------------------------------------------------------------------------
  let tray = null;
  let isQuitting = false;

  function createMainWindow() {
    mainWindow = new BrowserWindow({
      width: 1280, height: 800, minWidth: 900, minHeight: 560,
      backgroundColor: windowBg(), title: APP_NAME, icon: ICON, autoHideMenuBar: true, webPreferences,
    });
    mainWindow.setMenuBarVisibility(false);
    mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
    mainWindow.on('minimize', (e) => {
      if (!store.settings.minimizeToTray) return;
      e.preventDefault();
      hideToTray();
    });
    mainWindow.on('close', (e) => {
      if (store.settings.closeToTray && !isQuitting) {
        e.preventDefault();
        hideToTray();
      }
    });
    mainWindow.on('show', destroyTray);
    mainWindow.on('closed', () => { mainWindow = null; stopScan(); });
    return mainWindow;
  }

  function showMainWindow() {
    if (!account || !account.isLoggedIn()) {
      if (!loginWindow) { showLogin(); return; }
      if (loginWindow.isMinimized()) loginWindow.restore();
      loginWindow.show();
      loginWindow.focus();
      return;
    }
    if (!mainWindow) createMainWindow();
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }

  function hideToTray() {
    ensureTray();
    if (mainWindow) mainWindow.hide();
    if (!store.settings.trayHintShown && tray) {
      store.settings.trayHintShown = true;
      saveStore({ sync: false });
      if (tray.displayBalloon) tray.displayBalloon({ title: APP_NAME, content: t('tray.hiddenHint'), icon: ICON });
    }
  }

  function buildTrayMenu() {
    return Menu.buildFromTemplate([
      { label: t('tray.show'), click: showMainWindow },
      { type: 'separator' },
      { label: t('tray.quit'), click: quit },
    ]);
  }

  function ensureTray() {
    if (tray) { tray.setContextMenu(buildTrayMenu()); return; }
    const img = nativeImage.createFromPath(ICON).resize({ width: 16, height: 16, quality: 'best' });
    tray = new Tray(img);
    tray.setToolTip(APP_NAME);
    tray.setContextMenu(buildTrayMenu());
    tray.on('click', showMainWindow);
    tray.on('double-click', showMainWindow);
  }

  function destroyTray() {
    if (tray) { tray.destroy(); tray = null; }
  }

  function quit() {
    isQuitting = true;
    stopScan();
    if (saveTimer) writeStore();
    app.quit();
  }

  // -------------------------------------------------------------------------
  // Tarama: tek seferde bir tarama, kayıt başına en erken 30 sn'de bir
  // -------------------------------------------------------------------------
  const scanner = createScanner({ oui: OUI });
  let scanning = null; // { recordId, startedAt, ctl }

  function stopScan() {
    if (scanning) scanning.ctl.abort();
  }

  async function startScan(recordId) {
    const rec = store.records.find((r) => r.id === recordId);
    if (!rec) return { ok: false, code: 'not_found' };
    if (!store.settings.noticeAccepted) return { ok: false, code: 'notice' };
    if (scanning) return { ok: false, code: 'busy', recordId: scanning.recordId };
    const parsed = RANGES.parseRanges(rec.range);
    if (!parsed.ok) return { ok: false, code: 'invalid_range', error: parsed.error };
    const prev = readScan(rec.id);
    const gate = canRescan(prev ? prev.startedAt : null);
    if (!gate.ok) return { ok: false, code: 'rate_limited', waitMs: gate.waitMs };

    const ctl = new AbortController();
    scanning = { recordId: rec.id, startedAt: Date.now(), ctl };
    broadcastStore();
    const send = (ch, data) => { for (const w of BrowserWindow.getAllWindows()) w.webContents.send(ch, data); };
    const s = store.settings.scan;
    scanner.scan({
      ranges: parsed.ranges, ports: PORTS.activePorts(s.disabledPorts), concurrency: s.concurrency, timeoutMs: s.timeoutMs, signal: ctl.signal,
      onProgress: (p) => send('scan:progress', { recordId: rec.id, ...p }),
    }).then((result) => {
      const scan = { recordId: rec.id, ...result, hosts: diffScans(prev, result.hosts) };
      // Durdurulan taramada kaybolan cihaz hesaplanmaz (taranmamış adresler kaybolmuş sayılmasın)
      if (result.stopped) scan.hosts = scan.hosts.filter((h) => h.status !== 'gone');
      if (store.records.some((r) => r.id === rec.id)) writeScan(rec.id, scan);
      scanning = null;
      send('scan:done', { recordId: rec.id, scan });
      broadcastStore();
    }).catch((e) => {
      scanning = null;
      send('scan:done', { recordId: rec.id, error: e.message || 'error' });
      broadcastStore();
    });
    return { ok: true };
  }

  // -------------------------------------------------------------------------
  // IPC — ortak
  // -------------------------------------------------------------------------
  ipcMain.on('app:lang', (e) => { e.returnValue = currentLang(); });
  ipcMain.on('app:version', (e) => { e.returnValue = app.getVersion(); });

  ipcMain.handle('store:get', () => publicStore());

  // Senkronlanan ayarlar (tema, dil, tarama) senkron tetikler; cihaza özgüler sessiz kaydedilir
  const DEVICE_SETTINGS = ['openAtLogin', 'minimizeToTray', 'closeToTray', 'checkUpdates'];
  ipcMain.handle('settings:set', (_e, patch) => {
    const p = { ...(patch || {}) };
    const allowed = ['appTheme', 'language', 'scan', ...DEVICE_SETTINGS];
    for (const k of Object.keys(p)) if (!allowed.includes(k)) delete p[k];
    if ('appTheme' in p) p.appTheme = ['dark', 'light', 'system'].includes(p.appTheme) ? p.appTheme : 'system';
    if ('language' in p) p.language = I18N.LANGUAGES[p.language] ? p.language : null;
    if ('scan' in p) p.scan = sanitizeScan({ ...store.settings.scan, ...(p.scan || {}) });
    for (const k of DEVICE_SETTINGS) if (k in p) p[k] = !!p[k];
    const prevLang = currentLang();
    Object.assign(store.settings, p);
    const loud = Object.keys(p).some((k) => !DEVICE_SETTINGS.includes(k));
    saveStore({ sync: loud });
    if ('appTheme' in p) applyAppTheme();
    if ('openAtLogin' in p) applyOpenAtLogin();
    if ('language' in p) {
      applyLanguage();
      if (currentLang() !== prevLang) { onLanguageChanged(); return { ok: true }; }
    }
    broadcastStore();
    return { ok: true };
  });

  function onLanguageChanged() {
    if (tray) { tray.setContextMenu(buildTrayMenu()); }
    for (const w of BrowserWindow.getAllWindows()) w.webContents.reload();
  }

  ipcMain.handle('app:acceptNotice', () => {
    store.settings.noticeAccepted = true;
    saveStore({ sync: false });
    broadcastStore();
    return { ok: true };
  });

  // --- Kütüphane -------------------------------------------------------------
  ipcMain.handle('record:save', (_e, rec) => {
    const r = sanitizeRecord({ ...(rec || {}) });
    const parsed = RANGES.parseRanges(r.range);
    if (!parsed.ok) return { ok: false, code: parsed.error.code, token: parsed.error.token, count: parsed.count };
    if (r.folderId && !store.folders.some((f) => f.id === r.folderId)) r.folderId = null;
    const i = store.records.findIndex((x) => x.id === r.id);
    if (i >= 0) {
      r.createdAt = store.records[i].createdAt;
      if (store.records[i].range !== r.range) deleteScan(r.id); // aralık değişti: eski sonuç ve "kaybolan" karşılaştırması anlamsız
      store.records[i] = r;
    } else store.records.push(r);
    saveStore();
    broadcastStore();
    return { ok: true, record: r, count: parsed.count };
  });

  ipcMain.handle('record:delete', (_e, id) => {
    if (scanning && scanning.recordId === id) stopScan();
    store.records = store.records.filter((r) => r.id !== id);
    deleteScan(id);
    saveStore();
    broadcastStore();
    return { ok: true };
  });

  ipcMain.handle('record:move', (_e, { ids, folderId }) => {
    const target = folderId && store.folders.some((f) => f.id === folderId) ? folderId : null;
    for (const r of store.records) if ((ids || []).includes(r.id)) r.folderId = target;
    saveStore();
    broadcastStore();
    return { ok: true };
  });

  ipcMain.handle('folder:save', (_e, f) => {
    const folder = sanitizeFolder({ ...(f || {}) });
    if (folder.parentId && (folder.parentId === folder.id || !store.folders.some((x) => x.id === folder.parentId))) folder.parentId = null;
    const i = store.folders.findIndex((x) => x.id === folder.id);
    if (i >= 0) { folder.createdAt = store.folders[i].createdAt; store.folders[i] = folder; } else store.folders.push(folder);
    saveStore();
    broadcastStore();
    return { ok: true, folder };
  });

  // Klasör silinince içindekiler üst klasöre taşınır
  ipcMain.handle('folder:delete', (_e, id) => {
    const f = store.folders.find((x) => x.id === id);
    if (!f) return { ok: false };
    for (const r of store.records) if (r.folderId === id) r.folderId = f.parentId;
    for (const x of store.folders) if (x.parentId === id) x.parentId = f.parentId;
    store.folders = store.folders.filter((x) => x.id !== id);
    saveStore();
    broadcastStore();
    return { ok: true };
  });

  // --- Tarama -----------------------------------------------------------------
  ipcMain.handle('scan:start', (_e, recordId) => startScan(String(recordId || '')));
  ipcMain.handle('scan:stop', () => { stopScan(); return { ok: true }; });
  ipcMain.handle('scan:get', (_e, recordId) => readScan(String(recordId || '')));

  ipcMain.handle('scan:export', async (e, { recordId, format }) => {
    const rec = store.records.find((r) => r.id === recordId);
    const scan = rec && readScan(rec.id);
    if (!scan) return { ok: false, code: 'no_scan' };
    const fmt = format === 'csv' ? 'csv' : 'json';
    const safe = rec.name.replace(/[^\wÀ-ɏЀ-ӿ؀-ۿ一-鿿 -]+/g, '_').trim() || 'scan';
    const res = await dialog.showSaveDialog(BrowserWindow.fromWebContents(e.sender), {
      title: t('scan.export'), defaultPath: `${safe}.${fmt}`,
      filters: [fmt === 'csv' ? { name: 'CSV', extensions: ['csv'] } : { name: 'JSON', extensions: ['json'] }],
    });
    if (res.canceled || !res.filePath) return { ok: false, code: 'canceled' };
    const body = fmt === 'csv' ? toCsv(scan) : JSON.stringify({ record: { name: rec.name, range: rec.range }, ...scan }, null, 2);
    fs.writeFileSync(res.filePath, body, 'utf8');
    return { ok: true, path: res.filePath };
  });

  // Etiket tıklaması: web → tarayıcı, RDP → mstsc, SMB → Gezgin, diğerleri → panoya kopyala
  ipcMain.handle('tag:action', (_e, { group, ip, port }) => {
    if (RANGES.ipToInt(ip) == null || !RANGES.isPrivate(RANGES.ipToInt(ip))) return { ok: false, code: 'bad_ip' };
    const a = ACTIONS.actionFor(String(group || ''), ip, Number(port) || 0);
    try {
      if (a.kind === 'open') shell.openExternal(a.target);
      else if (a.kind === 'run' && process.platform === 'win32') spawn(a.target, a.args, { detached: true, stdio: 'ignore', windowsHide: true }).unref();
      else if (a.kind === 'explorer' && process.platform === 'win32') spawn('explorer.exe', [a.target], { detached: true, stdio: 'ignore' }).unref();
      else { clipboard.writeText(a.target); return { ok: true, kind: 'copy', text: a.target }; }
      return { ok: true, kind: a.kind, text: a.text };
    } catch (err) {
      return { ok: false, code: 'failed', message: err.message };
    }
  });

  ipcMain.handle('app:copy', (_e, text) => { clipboard.writeText(String(text || '')); return { ok: true }; });
  // Yalnız özel bir IP'ye giden http(s) adresleri
  ipcMain.handle('app:openUrl', (_e, url) => {
    const m = /^https?:\/\/(\d{1,3}(?:\.\d{1,3}){3})(?::\d{1,5})?\/?$/i.exec(String(url || ''));
    if (!m || !RANGES.isPrivate(RANGES.ipToInt(m[1]) ?? -1)) return { ok: false };
    shell.openExternal(String(url));
    return { ok: true };
  });

  // --- Hesap --------------------------------------------------------------------
  ipcMain.handle('account:state', () => ({ ...account.state(), notice: loginNotice, appVersion: app.getVersion() }));

  ipcMain.handle('account:login', async (_e, { email, password, remember }) => {
    try {
      await account.login(email, password, remember);
      enterApp();
      return { ok: true };
    } catch (e) {
      return { ok: false, code: e.code || 'error', message: e.message };
    }
  });

  ipcMain.handle('account:logout', async () => {
    await account.logout();
    showLogin();
  });

  ipcMain.handle('account:syncNow', () => account.syncNow());
  ipcMain.handle('account:setSync', async (_e, on) => {
    try { await account.setSyncEnabled(on); return { ok: true }; } catch (e) { return { ok: false, code: e.code }; }
  });
  ipcMain.handle('account:deleteRemote', async () => {
    try { await account.deleteRemote(); return { ok: true }; } catch (e) { return { ok: false, code: e.code }; }
  });

  // Mastertool düğmesi: portal, uygulamanın dili ve o anki gece/gündüz temasıyla tarayıcıda açılır
  ipcMain.handle('app:openMastertool', () => {
    const theme = nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
    shell.openExternal(`https://mastertool.download/?lang=${encodeURIComponent(currentLang())}&theme=${theme}`);
  });

  // Hesap sayfaları ve araç tanıtım sayfası varsayılan tarayıcıda (yalnız bu adresler)
  function openWeb(page) {
    const allowed = { forgot: '/sifremi-unuttum', register: '/kayit', account: '/hesabim', tool: '/araclar/ip-tools' };
    if (!allowed[page]) return;
    const q = new URLSearchParams({ lang: currentLang(), theme: nativeTheme.shouldUseDarkColors ? 'dark' : 'light', app: APP_CODE });
    shell.openExternal(`${API_BASE}${allowed[page]}?${q}`);
  }
  ipcMain.handle('account:openWeb', (_e, page) => openWeb(page));

  ipcMain.handle('app:about', () => ({
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    openAtLogin: openAtLoginState(),
    portable: isPortable(),
    packaged: app.isPackaged,
    update: updateInfo,
  }));

  ipcMain.handle('app:checkUpdate', async () => {
    try {
      return { ok: true, ...(await account.checkUpdate({ manual: true })) };
    } catch (e) {
      return { ok: false, code: e.code || 'error', message: e.message };
    }
  });

  // Chromium/Electron lisans dosyaları kurulum klasöründe durur
  ipcMain.handle('app:openLicenses', () => {
    const file = path.join(path.dirname(process.execPath), 'LICENSES.chromium.html');
    if (fs.existsSync(file)) return shell.openPath(file);
    return shell.openExternal('https://www.electronjs.org/docs/latest#license');
  });

  // -------------------------------------------------------------------------
  app.setAppUserModelId('com.mastertool.iptools');

  app.on('web-contents-created', (_e, wc) => {
    wc.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//i.test(url)) shell.openExternal(url);
      return { action: 'deny' };
    });
    wc.on('will-navigate', (e) => e.preventDefault());
  });

  app.on('before-quit', () => (isQuitting = true));
  app.on('window-all-closed', () => {
    if (!tray || !account || !account.isLoggedIn()) quit();
  });

  app.whenReady().then(async () => {
    loadStore();
    initAccount();
    applyOpenAtLogin();
    // Uygulama girişsiz kullanılamaz. "Beni hatırla" ile saklı oturum varsa doğrudan; yoksa ve başka bir
    // Mastertool uygulamasında giriş yapılmışsa ortak oturumla şifresiz açılır.
    if (!account.isLoggedIn()) {
      const r = await account.trySharedSignIn();
      if (r.code === 'app_disabled') loginNotice = t('auth.errAppDisabled');
    }
    account.watchShared();
    if (account.isLoggedIn()) {
      createMainWindow();
      if (process.argv.includes('--hidden') && store.settings.minimizeToTray) mainWindow.once('ready-to-show', () => hideToTray());
      account.start().then(() => store.settings.checkUpdates && account.checkUpdate()).catch(() => {});
    } else {
      showLogin(loginNotice);
    }
  });
}
