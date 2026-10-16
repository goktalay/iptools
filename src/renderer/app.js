'use strict';

// Ana pencere: solda kayıtlar (kart/klasör), sağda seçili kaydın tarama sonucu; kayıt formu, ayarlar.

const COLORS = ['#22d3ee', '#3b82f6', '#6366f1', '#a855f7', '#ec4899', '#f97316', '#fbbf24', '#34d399', '#94a3b8'];
const GROUP_ICON = { web: 'globe', ssh: 'terminal', ftp: 'folder', rdp: 'desktop', smb: 'share', db: 'db', printer: 'printer', vnc: 'monitor', camera: 'camera' };
const OSS = [['IP Tools', 'MIT'], ['Electron', 'MIT'], ['Chromium', 'BSD-3-Clause +'], ['Node.js', 'MIT'], ['@napi-rs/keyring', 'MIT'], ['IEEE OUI (MA-L) listesi', 'IEEE']];

let data = { folders: [], records: [], settings: {}, summaries: {}, scanning: null, ports: [], limits: {} };
let acct = { loggedIn: false };
let currentFolder = null;
let selectedId = null;
let scan = null;        // seçili kaydın kayıtlı sonucu
let live = null;        // sürmekte olan taramanın ilerlemesi
let query = '';
let filter = 'all';
let sort = { key: 'ip', dir: 1 };
let scanTimer = null;

const $ = (s) => document.querySelector(s);
const IS_RTL = document.documentElement.dir === 'rtl';

// --- Başlangıç ------------------------------------------------------------------------
$('.search-ico').innerHTML = icon('search');
$('#search').placeholder = t('app.searchPh');
$('#btnSettings').innerHTML = icon('gear');
$('#btnSettings').title = t('set.title');
$('#btnNewFolder').innerHTML = icon('folderPlus') + esc(t('app.newFolder'));
$('#btnNewRecord').innerHTML = icon('plus') + esc(t('app.newRecord'));
$('#noticeBar').innerHTML = `${icon('shield')}<span>${esc(t('notice.text'))}</span>`;
$('.topbar').appendChild(mastertoolButton()); // en sağ üst köşe (Mastertool standardı)

$('#btnSettings').onclick = () => openSettings();
$('#btnNewFolder').onclick = () => editFolder(null);
$('#btnNewRecord').onclick = () => editRecord(null);
$('#search').addEventListener('input', (e) => { query = e.target.value.trim().toLowerCase(); renderList(); renderResults(); });
$('#btnAccount').onclick = () => openSettings('account');

document.addEventListener('keydown', (e) => {
  if (document.querySelector('.modal-backdrop')) return;
  const inInput = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName);
  if (e.ctrlKey && e.key.toLowerCase() === 'f') { e.preventDefault(); $('#search').focus(); $('#search').select(); }
  if (e.ctrlKey && e.key.toLowerCase() === 'n') { e.preventDefault(); editRecord(null); }
  if (e.key === 'F5' && selectedId) { e.preventDefault(); startScan(selectedId); }
  if (e.key === 'Escape' && data.scanning) { e.preventDefault(); window.api.stopScan(); }
  if (e.key === 'Escape' && document.activeElement === $('#search')) { $('#search').value = ''; query = ''; renderList(); renderResults(); $('#search').blur(); }
  if (!inInput && e.key === 'Backspace' && currentFolder) goFolder(folderById(currentFolder)?.parentId || null);
  if (!inInput && e.key === 'Delete' && selectedId) deleteRecord(recordById(selectedId));
  if (!inInput && e.key === 'F2' && selectedId) editRecord(recordById(selectedId));
  if (e.ctrlKey && e.key.toLowerCase() === 'e' && selectedId && scan) { e.preventDefault(); exportScan('csv'); }
});

window.api.onStoreChanged(async (d) => {
  const was = data.scanning && data.scanning.recordId;
  data = d;
  if (!d.scanning) live = null;
  if (selectedId && !recordById(selectedId)) { selectedId = null; scan = null; }
  if (was && !d.scanning && selectedId === was) scan = await window.api.getScan(selectedId);
  render();
  if (!data.settings.noticeAccepted) showNotice();
});
window.api.getStore().then(async (d) => {
  data = d;
  const last = localStorage.getItem('ipt.selected');
  if (last && recordById(last)) { selectedId = last; scan = await window.api.getScan(last); }
  render();
  if (!data.settings.noticeAccepted) showNotice();
});

window.api.onScanProgress((p) => {
  live = p;
  if (p.recordId === selectedId) renderResults();
});
window.api.onScanDone(async (r) => {
  live = null;
  if (r.recordId === selectedId) {
    scan = r.scan || scan;
    renderResults();
    if (r.error) toast(t('scan.failed', { msg: r.error }), { type: 'err' });
    else if (r.scan && r.scan.stopped) toast(t('scan.stopped'), { timeout: 2500 });
    else if (r.scan) {
      const fresh = r.scan.hosts.filter((h) => h.status === 'new').length;
      toast(t('scan.done', { n: r.scan.hosts.filter((h) => h.status !== 'gone').length }), { type: 'ok', sub: fresh ? t('rec.newDevices', { n: fresh }) : '' });
    }
  }
});

// --- Hesap ve senkron durumu ---------------------------------------------------------
function syncText(st) {
  if (!st.syncEnabled || st.state === 'off') return t('sync.off');
  if (st.state === 'syncing') return t('sync.syncing');
  if (st.state === 'offline') return t('sync.offline');
  if (st.state === 'error') {
    if (st.error === 'decrypt_failed') return t('sync.errDecrypt');
    if (st.error === 'too_large') return t('sync.errTooLarge');
    return t('sync.error', { msg: st.errorMessage || st.error });
  }
  return st.lastSyncAt ? t('acct.lastSync', { time: formatDate(st.lastSyncAt) }) : t('acct.never');
}
function paintAccount() {
  const b = $('#btnAccount');
  const email = (acct.user && acct.user.email) || acct.email || '';
  const name = (acct.user && acct.user.name) || email;
  b.querySelector('.ac-avatar').textContent = (name || '?').trim().charAt(0).toUpperCase();
  const st = !acct.syncEnabled ? 'off' : acct.state || 'idle';
  b.className = `account-chip s-${st}`;
  b.querySelector('.ac-sync').innerHTML = st === 'syncing' ? '<span class="spin"></span>' : icon(st === 'off' || st === 'offline' ? 'cloudOff' : 'cloud');
  b.title = `${email}\n${syncText(acct)}`;
  const el = $('#acct-status');
  if (el) el.textContent = syncText(acct);
}
window.api.onAccountStatus((st) => { acct = st; paintAccount(); });
window.api.accountState().then((st) => { acct = st; paintAccount(); });

function showUpdate(info) {
  if (!info) return;
  const bar = $('#updateBar');
  bar.innerHTML = `${icon('bolt')}<span><b>${esc(t('update.available', { version: info.version }))}</b> — ${esc(t('update.hint'))}</span>
    <button class="btn sm" type="button">${icon('open')}${esc(t('update.open'))}</button>`;
  bar.querySelector('button').onclick = () => window.api.openWeb('account');
  bar.classList.remove('hidden');
}
window.api.onUpdateAvailable(showUpdate);
window.api.about().then((a) => showUpdate(a.update));

// --- Yardımcılar ----------------------------------------------------------------------
const recordById = (id) => data.records.find((r) => r.id === id);
const folderById = (id) => data.folders.find((f) => f.id === id);
const folderPath = (id) => { const out = []; let f = folderById(id); while (f) { out.unshift(f); f = folderById(f.parentId); } return out; };
const matches = (s) => !query || String(s || '').toLowerCase().includes(query);
const hostName = (h) => h.name || h.mdns || '';
const rtt = (ms) => (ms == null ? '—' : ltr(`${ms < 1 ? '<1' : Math.round(ms)} ms`));

// İlk açılış: yalnız sahibi olduğunuz ağları tarayın
let noticeOpen = false;
async function showNotice() {
  if (noticeOpen) return;
  noticeOpen = true;
  await openModal({
    title: t('notice.title'), iconName: 'shield', closable: false, width: 520,
    body: `<div class="notice-body">${icon('radar')}<div><p>${esc(t('notice.body'))}</p><p class="set-hint">${esc(t('notice.limits'))}</p></div></div>`,
    buttons: [{ label: t('notice.accept'), cls: 'primary', icon: 'check', value: true }],
  });
  noticeOpen = false;
  await window.api.acceptNotice();
}

// --- Çizim ----------------------------------------------------------------------------
function render() {
  paintAccount();
  $('#stats').textContent = t('app.stats', { n: data.records.length });
  renderCrumbs();
  renderList();
  renderResults();
}

function goFolder(id) { currentFolder = id; renderCrumbs(); renderList(); }

function renderCrumbs() {
  const c = $('#crumbs');
  c.innerHTML = '';
  const add = (label, id, ic) => {
    const el = h(`<span class="crumb ${id === currentFolder ? 'current' : ''}">${ic ? icon(ic) : ''}${esc(label)}</span>`);
    el.onclick = () => goFolder(id);
    c.appendChild(el);
  };
  add(t('rec.rootFolder'), null, 'home');
  for (const f of folderPath(currentFolder)) {
    c.appendChild(h(`<span class="crumb-sep">${icon(IS_RTL ? 'chevronRight' : 'chevronRight')}</span>`));
    add(f.name, f.id, 'folder');
  }
}

function renderList() {
  const list = $('#list');
  list.innerHTML = '';
  const folders = data.folders.filter((f) => (query ? matches(f.name) : f.parentId === currentFolder)).sort((a, b) => a.name.localeCompare(b.name, LANG));
  const records = data.records.filter((r) => (query ? matches(r.name) || matches(r.range) : r.folderId === currentFolder)).sort((a, b) => a.name.localeCompare(b.name, LANG));

  for (const f of folders) {
    const n = data.records.filter((r) => r.folderId === f.id).length + data.folders.filter((x) => x.parentId === f.id).length;
    const card = h(`<div class="card folder-card" data-id="${f.id}">
      <div class="avatar">${icon('folder')}</div>
      <div class="card-text"><div class="card-title">${esc(f.name)}</div><div class="card-sub">${esc(n ? t('rec.items', { n }) : t('folder.empty'))}</div></div></div>`);
    card.onclick = () => goFolder(f.id);
    card.oncontextmenu = (e) => { e.preventDefault(); contextMenu(e.clientX, e.clientY, [
      { icon: 'edit', label: t('folder.rename'), action: () => editFolder(f) },
      '-',
      { icon: 'trash', label: t('common.delete'), danger: true, action: () => deleteFolder(f) },
    ]); };
    list.appendChild(card);
  }

  for (const r of records) {
    const s = data.summaries[r.id];
    const scanningThis = data.scanning && data.scanning.recordId === r.id;
    const sub = scanningThis ? t('scan.scanning') : s ? t('rec.lastScan', { time: formatDate(s.finishedAt) }) : t('rec.never');
    const card = h(`<div class="card rec-card ${r.id === selectedId ? 'selected' : ''}" style="--c:${r.color}" data-id="${r.id}">
      <div class="card-head">
        <div class="avatar">${icon(scanningThis ? 'radar' : 'wifi')}</div>
        <div class="card-text"><div class="card-title">${esc(r.name)}</div><div class="card-sub">${ltr(esc(r.range))}</div></div>
      </div>
      <div class="card-foot">
        <span class="tag ${scanningThis ? 'live' : ''}">${icon(scanningThis ? 'radar' : 'clock')}${esc(sub)}</span>
        ${s ? `<span class="tag">${icon('monitor')}${esc(t('rec.devices', { n: s.count }))}</span>` : ''}
        ${s && s.newCount ? `<span class="tag new">${icon('bolt')}${esc(t('rec.newDevices', { n: s.newCount }))}</span>` : ''}
      </div>
      <div class="quick"><button class="icon-btn" data-act="scan" title="${esc(t('scan.scan'))}">${icon('play')}</button><button class="icon-btn" data-act="edit" title="${esc(t('common.edit'))}">${icon('edit')}</button></div>
    </div>`);
    card.onclick = (e) => {
      const act = e.target.closest('[data-act]');
      if (act && act.dataset.act === 'edit') return editRecord(r);
      selectRecord(r.id, { scan: true });
    };
    card.oncontextmenu = (e) => { e.preventDefault(); contextMenu(e.clientX, e.clientY, [
      { icon: 'play', label: t('scan.scan'), action: () => selectRecord(r.id, { scan: true, force: true }) },
      { icon: 'edit', label: t('common.edit'), kbd: 'F2', action: () => editRecord(r) },
      { icon: 'move', label: t('rec.move'), action: () => moveRecord(r) },
      { icon: 'copy', label: t('ctx.copyRange'), action: () => { window.api.copyText(r.range); toast(t('tag.copied', { text: r.range }), { type: 'ok', timeout: 2000 }); } },
      '-',
      { icon: 'trash', label: t('common.delete'), kbd: 'Del', danger: true, action: () => deleteRecord(r) },
    ]); };
    list.appendChild(card);
  }

  const add = h(`<button class="new-card" type="button"><span class="plus">${icon('plus')}</span><span class="lbl">${esc(t('app.newRecord'))}</span></button>`);
  add.onclick = () => editRecord(null);
  list.appendChild(add);
}

// Kayda tıklayınca: seçilir ve (sonuç yoksa ya da son taramanın üzerinden 30 sn geçtiyse) tarama başlar
async function selectRecord(id, { scan: doScan = false, force = false } = {}) {
  selectedId = id;
  localStorage.setItem('ipt.selected', id);
  filter = 'all';
  scan = await window.api.getScan(id);
  renderList();
  renderResults();
  if (doScan) startScan(id, { quiet: !force });
}

async function startScan(id, { quiet = false } = {}) {
  const r = await window.api.startScan(id);
  if (r.ok) return;
  if (r.code === 'notice') return showNotice();
  if (r.code === 'busy') { if (!quiet || r.recordId !== id) toast(t('scan.busy'), { type: 'err' }); return; }
  if (r.code === 'rate_limited') { if (!quiet) toast(t('scan.rateLimited', { s: Math.ceil(r.waitMs / 1000) })); return; }
  if (r.code === 'invalid_range') return toast(rangeError(r.error), { type: 'err' });
  toast(t('scan.failed', { msg: r.code }), { type: 'err' });
}

function rangeError(err) {
  if (!err) return '';
  const map = { empty: 'range.errEmpty', invalid: 'range.errInvalid', ipv6: 'range.errIpv6', reversed: 'range.errReversed', too_many: 'range.errTooMany', not_private: 'range.errNotPrivate' };
  return t(map[err.code] || 'range.errInvalid', { token: err.token, count: err.token });
}

// --- Sonuçlar --------------------------------------------------------------------------
function visibleHosts() {
  const hosts = (live && live.recordId === selectedId ? live.hosts.map((x) => ({ ...x, status: 'live' })) : (scan && scan.hosts) || []);
  const q = query;
  let out = hosts.filter((x) => {
    if (filter === 'new' && x.status !== 'new') return false;
    if (filter === 'gone' && x.status !== 'gone') return false;
    if (filter === 'services' && !(x.ports && x.ports.length)) return false;
    if (!q) return true;
    return [x.ip, hostName(x), x.mac, x.vendor, ...(x.ports || []).map((p) => p.name)].some((v) => matches(v));
  });
  const key = sort.key;
  const val = (x) => key === 'ip' ? RANGES.ipKey(x.ip) : key === 'rtt' ? (x.rttMs == null ? 1e9 : x.rttMs) : key === 'services' ? (x.ports || []).length : String(x[key === 'name' ? 'name' : key] || hostName(x) || '').toLowerCase();
  out.sort((a, b) => { const va = val(a); const vb = val(b); return (va < vb ? -1 : va > vb ? 1 : 0) * sort.dir; });
  return out;
}

function renderResults() {
  const box = $('#results');
  const rec = recordById(selectedId);
  if (!rec) {
    box.innerHTML = `<div class="empty"><div class="empty-ic">${icon('radar')}</div><h2>${esc(data.records.length ? t('scan.selectRecord') : t('welcome.title'))}</h2>
      <p>${esc(data.records.length ? t('scan.selectHint') : t('welcome.body'))}</p>
      ${data.records.length ? '' : `<button class="btn primary" type="button" id="w-new">${icon('plus')}${esc(t('app.newRecord'))}</button>`}</div>`;
    const b = box.querySelector('#w-new');
    if (b) b.onclick = () => editRecord(null);
    return;
  }
  const scanningThis = data.scanning && data.scanning.recordId === rec.id;
  const hosts = visibleHosts();
  const all = scanningThis && live ? live.hosts : (scan && scan.hosts) || [];
  const counts = { all: all.filter((x) => x.status !== 'gone').length, new: all.filter((x) => x.status === 'new').length, gone: all.filter((x) => x.status === 'gone').length, services: all.filter((x) => x.ports && x.ports.length).length };
  const phase = live ? t(`scan.phase${live.phase.charAt(0).toUpperCase() + live.phase.slice(1)}`) : '';
  const pct = live && live.total ? Math.round((live.done / live.total) * 100) : 0;

  box.innerHTML = `
    <div class="res-head" style="--c:${rec.color}">
      <div class="res-title">
        <div class="avatar">${icon('wifi')}</div>
        <div><h2>${esc(rec.name)}</h2><div class="res-sub">${ltr(esc(rec.range))}${scan ? ` · ${esc(t('rec.lastScan', { time: formatDate(scan.finishedAt) }))}` : ''}</div></div>
      </div>
      <div class="res-actions">
        ${scanningThis
          ? `<button class="btn danger" type="button" id="r-stop">${icon('stop')}${esc(t('scan.stop'))}<span class="kbd">Esc</span></button>`
          : `<button class="btn primary" type="button" id="r-scan">${icon('play')}${esc(t('scan.scan'))}<span class="kbd">F5</span></button>`}
        <button class="btn" type="button" id="r-export" ${scan ? '' : 'disabled'}>${icon('export')}${esc(t('scan.export'))}</button>
        <button class="btn ghost" type="button" id="r-edit" title="${esc(t('common.edit'))}">${icon('edit')}</button>
      </div>
    </div>
    ${scanningThis ? `<div class="res-progress"><div class="progress"><div style="width:${pct}%"></div></div>
      <div class="res-progress-text">${icon('radar')}<span>${esc(phase)} · ${esc(t('scan.progress', { done: live ? live.done : 0, total: live ? live.total : 0 }))} · ${esc(t('scan.found', { n: live ? live.found : 0 }))}</span></div></div>` : ''}
    <div class="res-bar">
      <div class="chips">
        ${['all', 'new', 'gone', 'services'].map((k) => `<button class="chip ${filter === k ? 'on' : ''} ${k}" data-f="${k}">${esc(t('scan.filter' + k.charAt(0).toUpperCase() + k.slice(1)))}<b>${counts[k]}</b></button>`).join('')}
      </div>
      <span class="res-note">${icon('shield')}${esc(t('notice.short'))}</span>
    </div>
    ${all.length || scanningThis ? `<div class="table-wrap"><table class="hosts">
      <thead><tr>
        <th class="st"></th>
        ${[['ip', 'col.ip'], ['name', 'col.name'], ['mac', 'col.mac'], ['vendor', 'col.vendor'], ['rtt', 'col.rtt'], ['services', 'col.services']].map(([k, l]) =>
          `<th data-sort="${k}" class="${sort.key === k ? 'on' : ''} c-${k}">${esc(t(l))}${sort.key === k ? icon(sort.dir > 0 ? 'chevronUp' : 'chevronDown') : ''}</th>`).join('')}
      </tr></thead>
      <tbody>${hosts.map(hostRow).join('')}</tbody></table>
      ${!hosts.length ? `<div class="empty-note">${esc(t('scan.noMatch'))}</div>` : ''}</div>`
      : `<div class="empty small"><div class="empty-ic">${icon('radar')}</div><h2>${esc(t('scan.emptyTitle'))}</h2><p>${esc(t('scan.emptyBody'))}</p></div>`}`;

  const q = (s) => box.querySelector(s);
  if (q('#r-scan')) q('#r-scan').onclick = () => startScan(rec.id);
  if (q('#r-stop')) q('#r-stop').onclick = () => window.api.stopScan();
  q('#r-edit').onclick = () => editRecord(rec);
  q('#r-export').onclick = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    contextMenu(IS_RTL ? r.right - 200 : r.left, r.bottom + 4, [
      { icon: 'csv', label: t('scan.exportCsv'), action: () => exportScan('csv') },
      { icon: 'json', label: t('scan.exportJson'), action: () => exportScan('json') },
    ]);
  };
  box.querySelectorAll('.chip[data-f]').forEach((b) => (b.onclick = () => { filter = b.dataset.f; renderResults(); }));
  box.querySelectorAll('th[data-sort]').forEach((th) => (th.onclick = () => {
    if (sort.key === th.dataset.sort) sort.dir = -sort.dir; else sort = { key: th.dataset.sort, dir: 1 };
    renderResults();
  }));
  box.querySelectorAll('tr[data-ip]').forEach((tr) => {
    const host = hosts.find((x) => x.ip === tr.dataset.ip);
    tr.oncontextmenu = (e) => { e.preventDefault(); hostMenu(e.clientX, e.clientY, host); };
    tr.ondblclick = () => hostDetails(host);
    tr.querySelectorAll('.svc').forEach((b) => (b.onclick = (e) => { e.stopPropagation(); tagClick(b.dataset.group, host.ip, Number(b.dataset.port)); }));
  });
}

function hostRow(x) {
  const name = hostName(x);
  const st = x.status || 'same';
  return `<tr data-ip="${esc(x.ip)}" class="st-${st}">
    <td class="st"><span class="dot ${st}" title="${esc(t('status.' + st))}"></span></td>
    <td class="c-ip mono">${ltr(esc(x.ip))}</td>
    <td class="c-name">${name ? esc(name) : `<span class="muted">${esc(t('host.unknown'))}</span>`}</td>
    <td class="c-mac mono">${x.mac ? ltr(esc(x.mac)) : '<span class="muted">—</span>'}</td>
    <td class="c-vendor">${x.vendor ? esc(x.vendor) : x.localMac ? `<span class="muted">${esc(t('host.localMac'))}</span>` : '<span class="muted">—</span>'}</td>
    <td class="c-rtt">${rtt(x.rttMs)}</td>
    <td class="c-services"><div class="svcs">${(x.ports || []).map((p) => `<button class="svc g-${p.key}" type="button" data-group="${p.key}" data-port="${p.port}" title="${esc(svcTitle(p))}">${icon(GROUP_ICON[p.key] || 'tag')}${esc(p.name)}</button>`).join('')}</div></td>
  </tr>`;
}

const svcTitle = (p) => [t('tag.group.' + p.key), p.title, p.server, p.banner, p.tls && p.tls.cn ? `CN=${p.tls.cn}` : null].filter(Boolean).join(' · ');

async function tagClick(group, ip, port) {
  const r = await window.api.tagAction(group, ip, port);
  if (!r.ok) return toast(t('tag.failed'), { type: 'err' });
  if (r.kind === 'copy') toast(t('tag.copied', { text: r.text }), { type: 'ok', timeout: 2200 });
  else toast(t('tag.opened', { text: r.text }), { timeout: 2000 });
}

function hostMenu(x, y, host) {
  const web = (host.ports || []).find((p) => p.key === 'web');
  const copy = (text) => () => { window.api.copyText(text); toast(t('tag.copied', { text }), { type: 'ok', timeout: 2000 }); };
  contextMenu(x, y, [
    { icon: 'info', label: t('host.details'), action: () => hostDetails(host) },
    '-',
    { icon: 'copy', label: t('ctx.copyIp'), action: copy(host.ip) },
    hostName(host) ? { icon: 'copy', label: t('ctx.copyName'), action: copy(hostName(host)) } : null,
    host.mac ? { icon: 'copy', label: t('ctx.copyMac'), action: copy(host.mac) } : null,
    web ? { icon: 'globe', label: t('ctx.openWeb'), action: () => tagClick('web', host.ip, web.port) } : null,
  ]);
}

function hostDetails(host) {
  const rows = [
    [t('col.ip'), ltr(host.ip)], [t('col.name'), host.name || '—'], ['mDNS', host.mdns || '—'], [t('col.mac'), host.mac ? ltr(host.mac) : '—'],
    [t('col.vendor'), host.vendor || (host.localMac ? t('host.localMac') : '—')], [t('col.rtt'), rtt(host.rttMs)], ['TTL', host.ttl ?? '—'],
    [t('col.status'), t('status.' + (host.status || 'same'))], [t('host.alive'), host.alive === 'arp' ? t('status.aliveArp') : t('status.alivePing')],
  ];
  const ports = (host.ports || []).map((p) => `<div class="pd"><b class="g-${p.key}">${icon(GROUP_ICON[p.key] || 'tag')}${esc(p.name)} <span class="mono">${p.port}</span></b>
    ${p.title ? `<div><span>${esc(t('host.title'))}</span>${esc(p.title)}</div>` : ''}${p.server ? `<div><span>${esc(t('host.server'))}</span>${esc(p.server)}</div>` : ''}
    ${p.banner ? `<div><span>${esc(t('host.banner'))}</span><code>${esc(p.banner)}</code></div>` : ''}
    ${p.tls ? `<div><span>${esc(t('host.cert'))}</span>${esc(p.tls.cn || '—')}${p.tls.org ? ` (${esc(p.tls.org)})` : ''}${p.tls.selfSigned ? ` · ${esc(t('host.selfSigned'))}` : ''}</div>
      ${p.tls.issuer ? `<div><span>${esc(t('host.certIssuer'))}</span>${esc(p.tls.issuer)}</div>` : ''}${p.tls.notAfter ? `<div><span>${esc(t('host.certExpires'))}</span>${esc(formatDate(Date.parse(p.tls.notAfter)))}</div>` : ''}` : ''}</div>`).join('');
  openModal({
    title: hostName(host) || host.ip, iconName: 'monitor', width: 620,
    body: `<div class="kv">${rows.map(([k, v]) => `<span>${esc(k)}</span><span>${typeof v === 'string' && v.startsWith('⁦') ? v : esc(v)}</span>`).join('')}</div>
      ${ports ? `<div class="section-title">${esc(t('col.services'))}</div><div class="pds">${ports}</div>` : `<div class="set-hint">${esc(t('host.noServices'))}</div>`}`,
    buttons: [{ label: t('common.close'), value: null }],
  });
}

async function exportScan(format) {
  const r = await window.api.exportScan(selectedId, format);
  if (r.ok) toast(t('scan.exported'), { type: 'ok', sub: r.path });
  else if (r.code !== 'canceled') toast(t('scan.failed', { msg: r.code }), { type: 'err' });
}

// --- Kayıt formu ----------------------------------------------------------------------------
async function editRecord(rec) {
  const isNew = !rec;
  rec = rec || { name: '', color: COLORS[Math.floor(Math.random() * COLORS.length)], range: '', folderId: currentFolder };
  const folderOptions = [`<option value="">${esc(t('rec.rootFolder'))}</option>`, ...data.folders.map((f) => `<option value="${f.id}" ${f.id === rec.folderId ? 'selected' : ''}>${esc(folderPath(f.id).map((x) => x.name).join(' › '))}</option>`)].join('');
  const body = h(`<div class="row">
    <div class="row c-3-1">
      <div class="field"><label>${esc(t('rec.name'))}</label><input class="input" id="f-name" value="${esc(rec.name)}" maxlength="80"></div>
      <div class="field"><label>${esc(t('rec.color'))}</label><div class="colors">${COLORS.map((c) => `<button type="button" style="--c:${c}" data-c="${c}" class="${c === rec.color ? 'on' : ''}"></button>`).join('')}</div></div>
    </div>
    <div class="field"><label>${esc(t('rec.range'))}</label><textarea class="input ltr" id="f-range" rows="3" spellcheck="false" placeholder="192.168.1.0/24">${esc(rec.range)}</textarea>
      <small class="hint">${esc(t('rec.rangeHint'))}</small>
      <div class="range-check" id="f-check"></div></div>
    <div class="field"><label>${esc(t('rec.folder'))}</label><select class="input" id="f-folder">${folderOptions}</select></div>
  </div>`);
  let color = rec.color;
  body.querySelectorAll('.colors button').forEach((b) => (b.onclick = () => { color = b.dataset.c; body.querySelectorAll('.colors button').forEach((x) => x.classList.toggle('on', x === b)); }));
  const check = () => {
    const el = body.querySelector('#f-check');
    const text = body.querySelector('#f-range').value;
    if (!text.trim()) { el.className = 'range-check'; el.textContent = ''; return null; }
    const p = RANGES.parseRanges(text);
    el.className = `range-check show ${p.ok ? 'ok' : 'err'}`;
    el.innerHTML = `${icon(p.ok ? 'check' : 'alert')}<span>${esc(p.ok ? t('range.ok', { n: p.count }) : rangeError(p.error))}</span>`;
    return p;
  };
  body.querySelector('#f-range').addEventListener('input', check);
  check();

  const res = await openModal({
    title: isNew ? t('app.newRecord') : t('rec.edit'), iconName: 'wifi', width: 560, body,
    buttons: [
      { label: t('common.cancel'), value: null },
      { label: isNew ? t('common.create') : t('common.save'), cls: 'primary', onClick: async (m) => {
        const name = m.querySelector('#f-name').value.trim();
        const range = m.querySelector('#f-range').value.trim();
        m.querySelector('#f-name').classList.toggle('invalid', !name);
        if (!name) return false;
        const p = check();
        if (!p || !p.ok) return false;
        const r = await window.api.saveRecord({ id: rec.id, name, color, range, folderId: m.querySelector('#f-folder').value || null, createdAt: rec.createdAt });
        if (!r.ok) { toast(rangeError({ code: r.code, token: r.token }), { type: 'err' }); return false; }
        return r.record;
      } },
    ],
  });
  if (res) {
    toast(t('rec.saved'), { type: 'ok', timeout: 1800 });
    if (isNew) selectRecord(res.id, { scan: true, force: true });
    else if (res.id === selectedId) { scan = await window.api.getScan(res.id); renderResults(); }
  }
}

async function deleteRecord(rec) {
  if (!rec) return;
  const ok = await confirmBox(t('common.delete'), esc(t('rec.deleteMsg', { name: rec.name })));
  if (!ok) return;
  await window.api.deleteRecord(rec.id);
  if (selectedId === rec.id) { selectedId = null; scan = null; localStorage.removeItem('ipt.selected'); }
}

async function moveRecord(rec) {
  const options = [`<option value="">${esc(t('rec.rootFolder'))}</option>`, ...data.folders.map((f) => `<option value="${f.id}" ${f.id === rec.folderId ? 'selected' : ''}>${esc(folderPath(f.id).map((x) => x.name).join(' › '))}</option>`)].join('');
  const res = await openModal({
    title: t('rec.moveTitle'), iconName: 'move', width: 420,
    body: `<div class="field"><label>${esc(t('rec.folder'))}</label><select class="input" id="m-folder">${options}</select></div>`,
    buttons: [{ label: t('common.cancel'), value: null }, { label: t('rec.move'), cls: 'primary', onClick: (m) => ({ folderId: m.querySelector('#m-folder').value || null }) }],
  });
  if (res) await window.api.moveRecords([rec.id], res.folderId);
}

// --- Klasörler ----------------------------------------------------------------------------
async function editFolder(folder) {
  const isNew = !folder;
  const res = await openModal({
    title: isNew ? t('app.newFolder') : t('folder.rename'), iconName: 'folder', width: 420,
    body: `<div class="field"><label>${esc(t('folder.name'))}</label><input class="input" id="fo-name" value="${esc(folder ? folder.name : '')}" maxlength="80"></div>`,
    buttons: [{ label: t('common.cancel'), value: null }, { label: isNew ? t('common.create') : t('common.save'), cls: 'primary', onClick: (m) => {
      const name = m.querySelector('#fo-name').value.trim();
      if (!name) { m.querySelector('#fo-name').classList.add('invalid'); return false; }
      return { name };
    } }],
  });
  if (!res) return;
  await window.api.saveFolder(isNew ? { name: res.name, parentId: currentFolder } : { ...folder, name: res.name });
}

async function deleteFolder(folder) {
  const ok = await confirmBox(t('common.delete'), esc(t('folder.deleteMsg', { name: folder.name })));
  if (!ok) return;
  if (currentFolder === folder.id) currentFolder = folder.parentId;
  await window.api.deleteFolder(folder.id);
}

// --- Ayarlar (Mastertool ortak iskeleti): Genel · Hesap · Tarama · Hakkında ----------------------
async function openSettings(startTab = 'general') {
  const s = data.settings || {};
  let appTheme = s.appTheme || 'system';
  const about = await window.api.about();
  const langOptions = Object.entries(I18N.LANGUAGES).map(([code, l]) => `<option value="${code}" ${code === LANG ? 'selected' : ''}>${esc(l.name)}</option>`).join('');
  const tabs = [['general', 'gear', t('set.general')], ['account', 'user', t('set.account')], ['scan', 'radar', t('set.scan')], ['about', 'bolt', t('set.about')]];
  const email = (acct.user && acct.user.email) || acct.email || '';
  const sc = s.scan || {};
  const off = new Set(sc.disabledPorts || []);
  const lim = data.limits || { maxConcurrency: 64, maxTimeoutMs: 1000 };

  const body = h(`<div class="set-wrap">
    <nav class="set-nav">${tabs.map(([k, ic, label]) => `<button type="button" data-tab="${k}">${icon(ic)}<span>${esc(label)}</span></button>`).join('')}</nav>
    <div class="set-pages">
      <section data-page="general">
        <div class="field"><label>${esc(t('set.language'))}</label><select class="input" id="s-lang">${langOptions}</select>
          <small class="set-hint">${esc(t('set.languageHint'))}</small></div>
        <div class="field"><label>${esc(t('set.theme'))}</label>
          <div class="seg" id="s-theme">
            <button type="button" data-v="dark">${icon('moon')}${esc(t('set.themeDark'))}</button>
            <button type="button" data-v="light">${icon('sun')}${esc(t('set.themeLight'))}</button>
            <button type="button" data-v="system">${icon('monitor')}${esc(t('set.themeSystem'))}</button>
          </div></div>
        <div class="section-title">${esc(t('set.startup'))}</div>
        <label class="check"><input type="checkbox" id="s-login" ${about.openAtLogin ? 'checked' : ''}>
          <span>${esc(t('set.openAtLogin'))}<small>${esc(t('set.openAtLoginHint'))}</small></span></label>
        <label class="check"><input type="checkbox" id="s-min" ${s.minimizeToTray ? 'checked' : ''}>
          <span>${esc(t('set.minTray'))}<small>${esc(t('set.minTrayHint'))}</small></span></label>
        <label class="check"><input type="checkbox" id="s-close" ${s.closeToTray ? 'checked' : ''}>
          <span>${esc(t('set.closeTray'))}<small>${esc(t('set.closeTrayHint'))}</small></span></label>
        <div class="section-title">${esc(t('set.updates'))}</div>
        <label class="check"><input type="checkbox" id="s-upd" ${s.checkUpdates ? 'checked' : ''}>
          <span>${esc(t('set.checkUpdates'))}<small>${esc(t('set.checkUpdatesHint'))}</small></span></label>
      </section>

      <section data-page="account">
        <div class="acct-box">
          <div class="acct-who">${icon('user')}<span>${esc(t('acct.signedInAs', { email }))}</span></div>
          <label class="check"><input type="checkbox" id="s-sync" ${acct.syncEnabled ? 'checked' : ''}>
            <span>${esc(t('acct.syncToggle'))}<small>${esc(t('acct.syncHint'))}</small></span></label>
          <div class="acct-status">${icon('cloud')}<span id="acct-status">${esc(syncText(acct))}</span></div>
          <div class="acct-actions">
            <button class="btn sm" type="button" id="s-syncnow">${icon('refresh')}${esc(t('acct.syncNow'))}</button>
            <button class="btn sm" type="button" id="s-delremote">${icon('trash')}${esc(t('acct.deleteRemote'))}</button>
          </div>
          <div class="acct-actions">
            <button class="btn sm" type="button" id="s-web">${icon('open')}${esc(t('acct.myAccount'))}</button>
            <span style="flex:1"></span>
            <button class="btn sm danger" type="button" id="s-logout">${icon('logout')}${esc(t('acct.logout'))}</button>
          </div>
        </div>
        <div class="note">${icon('shield')}<span>${esc(t('privacy.note'))}</span></div>
      </section>

      <section data-page="scan">
        <div class="section-title">${esc(t('set.ports'))}</div>
        <div class="set-hint">${esc(t('set.portsHint'))}</div>
        <div class="ports">${data.ports.map((p) => `<label class="port-card ${off.has(p.port) ? '' : 'on'}"><input type="checkbox" data-port="${p.port}" ${off.has(p.port) ? '' : 'checked'}>
          <span class="pi g-${p.key}">${icon(GROUP_ICON[p.key] || 'tag')}</span><span><b>${esc(p.name)}</b><small>${esc(t('tag.group.' + p.key))} · ${p.port}/tcp</small></span></label>`).join('')}</div>
        <div class="section-title">${esc(t('set.speed'))}</div>
        <div class="row c-1-1">
          <div class="field"><label>${esc(t('set.concurrency'))}</label><input class="input" id="s-conc" type="number" min="1" max="${lim.maxConcurrency}" value="${esc(sc.concurrency || lim.maxConcurrency)}">
            <small class="hint">${esc(t('set.concurrencyHint', { max: lim.maxConcurrency }))}</small></div>
          <div class="field"><label>${esc(t('set.timeout'))}</label><div class="unit-wrap"><input class="input" id="s-tmo" type="number" min="200" max="${lim.maxTimeoutMs}" step="50" value="${esc(sc.timeoutMs || lim.maxTimeoutMs)}"><span>ms</span></div>
            <small class="hint">${esc(t('set.timeoutHint', { max: lim.maxTimeoutMs }))}</small></div>
        </div>
        <div class="note">${icon('info')}<span>${esc(t('set.limitsNote'))}</span></div>
      </section>

      <section data-page="about">
        <div class="about-head">
          <img src="../../build/icon.png" alt="">
          <div><div class="about-name">IP Tools</div>
            <div class="about-ver">${esc(t('about.version', { version: about.version }))}${about.portable ? ` · ${esc(t('about.portable'))}` : ''}</div></div>
        </div>
        <div class="set-hint">${esc(t('about.family'))}</div>
        <div class="acct-actions">
          <button class="btn sm" type="button" id="s-update">${icon('refresh')}${esc(t('about.checkUpdate'))}</button>
          <button class="btn sm" type="button" id="s-tool">${icon('globe')}${esc(t('about.toolPage'))}</button>
          <span class="about-update" id="s-update-result"></span>
        </div>
        <div class="section-title">${esc(t('about.licenses'))}</div>
        <div class="set-hint">${esc(t('about.licensesIntro'))}</div>
        <ul class="oss">${OSS.map(([n, l]) => `<li><span>${esc(n)}</span><span>${esc(l)}</span></li>`).join('')}</ul>
        <div class="acct-actions">
          <button class="btn sm" type="button" id="s-licenses">${icon('file')}${esc(t('about.chromium'))}</button>
          <span class="set-hint">Electron ${esc(about.electron)} · Chromium ${esc(about.chrome)}</span>
        </div>
      </section>
    </div>
  </div>`);

  const q = (sel) => body.querySelector(sel);
  const showTab = (k) => {
    body.querySelectorAll('.set-nav button').forEach((b) => b.classList.toggle('on', b.dataset.tab === k));
    body.querySelectorAll('.set-pages section').forEach((p) => p.classList.toggle('hidden', p.dataset.page !== k));
  };
  body.querySelectorAll('.set-nav button').forEach((b) => (b.onclick = () => showTab(b.dataset.tab)));
  showTab(startTab);

  // Tema seçimi anında uygulanır (önizleme); İptal edilirse eski temaya döner
  const originalTheme = appTheme;
  const setTheme = (v) => {
    appTheme = v;
    body.querySelectorAll('#s-theme button').forEach((b) => b.classList.toggle('on', b.dataset.v === v));
    window.api.setSettings({ appTheme: v });
  };
  body.querySelectorAll('#s-theme button').forEach((b) => (b.onclick = () => setTheme(b.dataset.v)));
  body.querySelectorAll('#s-theme button').forEach((b) => b.classList.toggle('on', b.dataset.v === appTheme));
  body.querySelectorAll('.ports input').forEach((cb) => (cb.onchange = () => cb.closest('.port-card').classList.toggle('on', cb.checked)));

  // Hesap bölümündeki işlemler anında uygulanır (Kaydet beklemez)
  q('#s-sync').onchange = async (e) => {
    const on = e.target.checked;
    const r = await window.api.setSyncEnabled(on);
    if (!r.ok) { e.target.checked = !on; toast(t('sync.error', { msg: r.code }), { type: 'err' }); }
  };
  q('#s-syncnow').onclick = () => window.api.syncNow();
  q('#s-delremote').onclick = async () => {
    const ok = await confirmBox(t('acct.deleteRemote'), esc(t('acct.deleteRemoteMsg')));
    if (!ok) return;
    const r = await window.api.deleteRemoteLibrary();
    if (r.ok) { q('#s-sync').checked = false; toast(t('acct.deleteRemoteDone'), { type: 'ok' }); }
    else toast(t('sync.error', { msg: r.code }), { type: 'err' });
  };
  q('#s-web').onclick = () => window.api.openWeb('account');
  q('#s-logout').onclick = async () => {
    const ok = await confirmBox(t('acct.logout'), esc(t('acct.logoutMsg')), { okText: t('acct.logout') });
    if (ok) window.api.logout();
  };

  // Hakkında: yeni sürüm denetimi ve lisanslar
  q('#s-update').onclick = async () => {
    const out = q('#s-update-result');
    out.className = 'about-update';
    out.textContent = t('about.checking');
    const r = await window.api.checkUpdate();
    if (!r.ok) { out.classList.add('err'); out.textContent = t('about.checkFailed', { msg: r.message || r.code }); return; }
    if (r.newer) { out.classList.add('new'); out.textContent = `${t('update.available', { version: r.latest })} — ${t('update.hint')}`; }
    else { out.classList.add('ok'); out.textContent = t('about.upToDate'); }
  };
  q('#s-tool').onclick = () => window.api.openWeb('tool');
  q('#s-licenses').onclick = () => window.api.openLicenses();

  const res = await openModal({
    title: t('set.title'), iconName: 'gear', width: 780, body,
    buttons: [
      { label: t('common.cancel'), value: null },
      { label: t('common.save'), cls: 'primary', onClick: (m) => ({
        appTheme,
        language: m.querySelector('#s-lang').value,
        openAtLogin: m.querySelector('#s-login').checked,
        minimizeToTray: m.querySelector('#s-min').checked,
        closeToTray: m.querySelector('#s-close').checked,
        checkUpdates: m.querySelector('#s-upd').checked,
        scan: {
          disabledPorts: [...m.querySelectorAll('.ports input')].filter((cb) => !cb.checked).map((cb) => Number(cb.dataset.port)),
          concurrency: Math.min(lim.maxConcurrency, Math.max(1, Number(m.querySelector('#s-conc').value) || lim.maxConcurrency)),
          timeoutMs: Math.min(lim.maxTimeoutMs, Math.max(200, Number(m.querySelector('#s-tmo').value) || lim.maxTimeoutMs)),
        },
      }) },
    ],
  });
  if (!res) {
    if (appTheme !== originalTheme) window.api.setSettings({ appTheme: originalTheme });
    return;
  }
  const langChanged = res.language !== LANG;
  if (!langChanged) delete res.language; // dil değişmediyse pencereyi yeniden yükleme
  await window.api.setSettings(res);
  if (!langChanged) toast(t('set.saved'), { type: 'ok' });
}
