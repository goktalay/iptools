'use strict';
// Ana sürecin yüklenebilirliği: electron sahte modülle değiştirilir, main.js çalıştırılır; IPC kanallarının kaydı,
// depo oluşturma ve giriş penceresinin açılması doğrulanır. Gerçek pencere, ağ ya da hesap yok.
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');
const path = require('path');
const { tmpDir } = require('./helpers');

test('main.js sahte electron ile yüklenir, IPC kanallarını kaydeder ve giriş penceresini açar', async () => {
  const userData = tmpDir('ipt-main-');
  const handles = new Map();
  const ons = new Map();
  const windows = [];
  const readyCbs = [];
  let whenReadyResolve;
  const ready = new Promise((r) => (whenReadyResolve = r));

  class FakeWindow {
    constructor(opts) { this.opts = opts; this.webContents = { send() {}, reload() {}, id: windows.length }; windows.push(this); this.events = {}; }
    setMenuBarVisibility() {}
    loadFile(file) { this.file = file; }
    on(ev, cb) { this.events[ev] = cb; }
    once() {}
    isDestroyed() { return false; }
    isMinimized() { return false; }
    show() {} focus() {} hide() {} destroy() {} restore() {}
    static getAllWindows() { return windows; }
    static fromWebContents() { return windows[0]; }
  }
  const electron = {
    app: {
      requestSingleInstanceLock: () => true, on: (ev, cb) => readyCbs.push(ev), exit() {}, quit() {},
      getPath: (k) => (k === 'userData' ? userData : path.join(userData, k)), getLocale: () => 'tr-TR', getVersion: () => '1.0.0',
      isPackaged: false, setAppUserModelId() {}, setLoginItemSettings() {}, getLoginItemSettings: () => ({ openAtLogin: false }),
      whenReady: () => ready,
    },
    BrowserWindow: FakeWindow,
    ipcMain: { handle: (ch, fn) => handles.set(ch, fn), on: (ch, fn) => ons.set(ch, fn) },
    safeStorage: { isEncryptionAvailable: () => false },
    shell: { openExternal() {}, openPath() {} },
    dialog: {}, clipboard: { writeText() {} },
    nativeTheme: { themeSource: 'system', shouldUseDarkColors: true },
    Tray: class { setToolTip() {} setContextMenu() {} on() {} destroy() {} },
    Menu: { buildFromTemplate: (t) => t },
    nativeImage: { createFromPath: () => ({ resize: () => ({}) }) },
    Notification: { isSupported: () => false },
  };
  const origLoad = Module._load;
  Module._load = function (request, ...rest) {
    if (request === 'electron') return electron;
    if (request === '@napi-rs/keyring') throw new Error('keyring yok (test)');
    return origLoad.call(this, request, ...rest);
  };
  try {
    require('../src/main.js');
    whenReadyResolve();
    await new Promise((r) => setTimeout(r, 50));
  } finally {
    Module._load = origLoad;
  }
  // IPC yüzeyi preload.js ile uyumlu
  for (const ch of ['store:get', 'settings:set', 'record:save', 'record:delete', 'record:move', 'folder:save', 'folder:delete', 'scan:start', 'scan:stop', 'scan:get', 'scan:export',
    'tag:action', 'app:copy', 'app:openUrl', 'account:state', 'account:login', 'account:logout', 'account:syncNow', 'account:setSync', 'account:deleteRemote',
    'app:openMastertool', 'account:openWeb', 'app:about', 'app:checkUpdate', 'app:openLicenses', 'app:acceptNotice']) assert.ok(handles.has(ch), ch);
  assert.ok(ons.has('app:lang') && ons.has('app:version'));
  // Girişsiz başlangıç: giriş penceresi açıldı
  assert.equal(windows.length, 1);
  assert.ok(windows[0].file.endsWith(path.join('renderer', 'login.html')));
  assert.deepEqual([windows[0].opts.width, windows[0].opts.height], [440, 640]);

  // Kayıt kaydetme: genel adres reddedilir, özel adres kabul edilir; yanlış grup/IP eylemi reddedilir
  const bad = await handles.get('record:save')({}, { name: 'x', range: '8.8.8.0/24' });
  assert.deepEqual([bad.ok, bad.code], [false, 'not_private']);
  const ok = await handles.get('record:save')({}, { name: 'Ofis', range: '192.168.1.0/24', color: '#22d3ee' });
  assert.equal(ok.ok, true);
  assert.equal(ok.count, 254);
  const st = await handles.get('store:get')();
  assert.equal(st.records.length, 1);
  assert.equal(st.ports.length, 15);
  assert.deepEqual(st.limits, { maxConcurrency: 64, maxTimeoutMs: 1000 });
  // Uyarı onaylanmadan tarama başlamaz
  const scan = await handles.get('scan:start')({}, ok.record.id);
  assert.deepEqual([scan.ok, scan.code], [false, 'notice']);
  const act = await handles.get('tag:action')({}, { group: 'web', ip: '8.8.8.8', port: 80 });
  assert.deepEqual([act.ok, act.code], [false, 'bad_ip']);
  const s = await handles.get('settings:set')({}, { scan: { concurrency: 999, timeoutMs: 5, disabledPorts: [80, 23] }, appTheme: 'zebra' });
  assert.equal(s.ok, true);
  const st2 = await handles.get('store:get')();
  assert.deepEqual(st2.settings.scan, { disabledPorts: [80], concurrency: 64, timeoutMs: 200 });
  assert.equal(st2.settings.appTheme, 'system');
});
