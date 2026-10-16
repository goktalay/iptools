'use strict';

// Giriş ve ana pencere (yalıtılmış; Node erişimi yok)
const { contextBridge, ipcRenderer } = require('electron');

const on = (channel) => (cb) => {
  const listener = (_e, data) => cb(data);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

contextBridge.exposeInMainWorld('api', {
  // arayüz dili (açılışta senkron alınır ki ilk çizim doğru dilde olsun)
  lang: ipcRenderer.sendSync('app:lang'),
  version: ipcRenderer.sendSync('app:version'),

  // Mastertool hesabı ve senkron
  accountState: () => ipcRenderer.invoke('account:state'),
  login: (email, password, remember) => ipcRenderer.invoke('account:login', { email, password, remember }),
  logout: () => ipcRenderer.invoke('account:logout'),
  syncNow: () => ipcRenderer.invoke('account:syncNow'),
  setSyncEnabled: (on) => ipcRenderer.invoke('account:setSync', on),
  deleteRemoteLibrary: () => ipcRenderer.invoke('account:deleteRemote'),
  openWeb: (page) => ipcRenderer.invoke('account:openWeb', page), // 'forgot' | 'register' | 'account' | 'tool'
  onAccountStatus: on('account:status'),
  onUpdateAvailable: on('app:update'),
  openMastertool: () => ipcRenderer.invoke('app:openMastertool'),
  about: () => ipcRenderer.invoke('app:about'),
  checkUpdate: () => ipcRenderer.invoke('app:checkUpdate'),
  openLicenses: () => ipcRenderer.invoke('app:openLicenses'),

  // kütüphane (kayıtlar, klasörler) ve ayarlar
  getStore: () => ipcRenderer.invoke('store:get'),
  onStoreChanged: on('store:changed'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  saveRecord: (rec) => ipcRenderer.invoke('record:save', rec),
  deleteRecord: (id) => ipcRenderer.invoke('record:delete', id),
  saveFolder: (f) => ipcRenderer.invoke('folder:save', f),
  deleteFolder: (id) => ipcRenderer.invoke('folder:delete', id),
  moveRecords: (ids, folderId) => ipcRenderer.invoke('record:move', { ids, folderId }),
  acceptNotice: () => ipcRenderer.invoke('app:acceptNotice'),

  // tarama (yalnız yerel sonuçlar)
  startScan: (recordId) => ipcRenderer.invoke('scan:start', recordId),
  stopScan: () => ipcRenderer.invoke('scan:stop'),
  getScan: (recordId) => ipcRenderer.invoke('scan:get', recordId),
  onScanProgress: on('scan:progress'),
  onScanDone: on('scan:done'),
  exportScan: (recordId, format) => ipcRenderer.invoke('scan:export', { recordId, format }),
  tagAction: (group, ip, port) => ipcRenderer.invoke('tag:action', { group, ip, port }),
  copyText: (text) => ipcRenderer.invoke('app:copy', text),
  openUrl: (url) => ipcRenderer.invoke('app:openUrl', url),
});
