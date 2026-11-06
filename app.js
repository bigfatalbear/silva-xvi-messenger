import { NetworkManager, NET_MODES, BLE_SERVICE_UUID, NetworkError } from './network.js';

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const LS = {
  get: (k, d) => JSON.parse(localStorage.getItem(k) ?? 'null') ?? d,
  set: (k, v) => localStorage.setItem(k, JSON.stringify(v)),
};

/* ============ estado ============ */
const STATE = {
  me: LS.get('xvi_me', { name: 'Pilotinho' + Math.floor(Math.random() * 99), st: 'online', avatar: '🙂' }),
  peer: null,
  chats: LS.get('xvi_chats', {}),
  sdp: LS.get('xvi_sdp', { offer: '', answer: '' }),
  net: new NetworkManager({
    onOpen: () => onChannelOpen(),
    onMessage: txt => onChannelMessage(txt),
    onClose: () => onChannelClose(),
    onError: e => toast('Erro de rede: ' + (e.message || e)),
  }),
};

const STATUS_CFG = {
  online: { label: 'Online', cls: 'online' },
  ocupado: { label: 'Ocupado', cls: 'ocupado' },
  volto: { label: 'Volto logo', cls: 'volto' },
  offline: { label: 'Aparecer offline', cls: 'offline' },
};

/* ============ toast / áudio ============ */
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.remove('show'), 2600);
}
const sfx = {
  nudge: () => $('#sfxNudge')?.play().catch(() => {}),
  msg: () => $('#sfxMsg')?.play().catch(() => {}),
  ring: () => $('#sfxRing')?.play().catch(() => {}),
};

/* ============ IndexedDB ============ */
const DB = {
  _p: new Promise((res, rej) => {
    const r = indexedDB.open('xvi-db', 1);
    r.onupgradeneeded = () => {
      const s = r.result.createObjectStore('msgs', { keyPath: 'id' });
      s.createIndex('peer', 'peer', { unique: false });
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }),
  async put(peer, msg) {
    const db = await this._p;
    return new Promise(res => {
      const tx = db.transaction('msgs', 'readwrite');
      tx.objectStore('msgs').put({ id: `${peer}:${Date.now()}:${Math.random().toString(36).slice(2, 6)}`, peer, msg });
      tx.oncomplete = res;
      tx.onerror = res;
    });
  },
  async byPeer(peer) {
    const db = await this._p;
    return new Promise(res => {
      const out = [];
      const req = db.transaction('msgs', 'readonly').objectStore('msgs').index('peer').getAll(peer);
      req.onsuccess = () => res((req.result || []).map(r => r.msg).sort((a, b) => a.ts - b.ts));
      req.onerror = () => res(out);
    });
  },
};

/* ============ contatos / lista ============ */
function contactEntry(id, name, avatar) {
  return { id, name, avatar, st: 'offline', preview: '' };
}
function knownPeers() {
  const chats = STATE.chats;
  const srvPeers = STATE.net.server?.st && STATE.net.server.st.state === 'online' ? STATE.net.server.peers : [];
  return Object.keys(chats).map(k => {
    const e = contactEntry(k, chats[k]?.name || k.split('|')[0], chats[k]?.avatar || '🙂');
    if (srvPeers.some(p => p.name === e.name)) e.st = 'online';
    else e.st = chats[k]?.st === 'online' ? 'online' : 'offline';
    e.preview = chats[k]?.preview || '';
    return e;
  });
}
function activePeerLabel() { return $('#chatName').textContent || ''; }

function renderContacts(filter = '') {
  const peers = knownPeers().filter(p => p.name.toLowerCase().includes(filter.toLowerCase()));
  const on = peers.filter(p => p.st !== 'offline');
  const off = peers.filter(p => p.st === 'offline');
  $('#grpAvailable').innerHTML = on.length ? on.map(contactHTML).join('') :
    '<p class="empty-list">Ninguém ainda — conecte alguém!</p>';
  $('#grpOffline').innerHTML = off.length ? off.map(contactHTML).join('') :
    '<p class="empty-list">Sem contatos offline.</p>';
  $('#defTitle').textContent = `▾ Online (${on.length})`;
  $('#offTitle').textContent = `▸ Offline (${off.length})`;
  $$('.contact').forEach(c => c.onclick = () => selectContact(c.dataset.id));
}
function contactHTML(c) {
  return `<div class="contact ${c.name === STATE.peer?.name ? 'selected' : ''}" data-id="${c.id}">
    <div class="avatar">${c.avatar}</div>
    <div><b>${escapeHTML(c.name)}</b>
    <span class="msg-preview">${c.preview ? escapeHTML(c.preview) : '&lt;sem mensagens&gt;'}</span></div>
  </div>`;
}
function escapeHTML(s) { return (s + '').replace(/[<>&"]/g, ch => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[ch])); }

function selectContact(id) {
  const info = STATE.chats[id] || { name: id.split('|')[0] || id, avatar: '🙂', preview: '' };
  STATE.peer = { id, ...info };
  $('#chatName').textContent = info.name;
  $('#chatSub').textContent = STATE.net?.wifi.channel?.readyState === 'open' ? 'canal aberto' : 'aguardando canal P2P';
  $('#msgInput').disabled = false;
  $('#sendBtn').disabled = false;
  renderChat();
  $$('.contact').forEach(el => el.classList.toggle('selected', el.dataset.id === id));
  if (matchMedia('(max-width:760px)').matches) document.documentElement.classList.add('chat-open');
}

async function renderChat() {
  const log = $('#chatLog');
  if (!STATE.peer) return;
  const history = await DB.byPeer(STATE.peer.id);
  const body = history.length ? history.map(m => bubbleHTML(m)) :
    '<div class="chat-empty"><img src="icons/icon-192.png" alt=""><p>Say say hello!<br><small>o histórico fica salvo no aparelho</small></p></div>';
  log.innerHTML = body;
  log.scrollTop = log.scrollHeight;
}

function bubbleHTML(msg) {
  if (msg.side === 'sys')
    return `<div class="bubble sys">${escapeHTML(msg.text)} · ${new Date(msg.ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</div>`;
  const who = msg.side === 'me' ? STATE.me.name : (STATE.peer?.name || 'Contato');
  return `<div class="bubble ${msg.side === 'me' ? 'me' : 'them'}">
    <span class="who">${escapeHTML(who)} · ${new Date(msg.ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>
    ${escapeHTML(msg.text)}</div>`;
}

/* ============ chat / envio / mensagens ============ */
function onChannelOpen() {
  $('#chatSub').textContent = 'canal aberto';
  $('#netStatus').textContent = 'canal P2P ativo';
  toast('Canal P2P aberto! 🎉');
  sfx.ring();
  const fromHello = pendingHello;
  const name = fromHello || 'Novo contato';
  let key = STATE.peer?.id || keyByName(name);
  if (!key || !STATE.chats[key]) {
    key = `${name}|${Date.now()}`;
    STATE.chats[key] = contactEntry(key, name, '🙂');
  }
  STATE.chats[key].st = 'online';
  if (fromHello) STATE.chats[key].name = name;
  STATE.sdp.answer = STATE.sdp.answer || '';
  LS.set('xvi_chats', STATE.chats);
  LS.set('xvi_sdp', STATE.sdp);
  STATE.peer = { id: key, ...STATE.chats[key] };
  $('#chatName').textContent = STATE.chats[key].name;
  pendingHello = null;
  renderContacts();
  selectContact(key);
  try { STATE.net.sendSdp(JSON.stringify({ type: 'hello', name: STATE.me.name, avatar: STATE.me.avatar })); } catch {}
}
let pendingHello = null;

async function onChannelMessage(payload) {
  const data = safeParse(payload);
  if (data?.type === 'nudge') {
    nudgeReceived();
    sfx.nudge();
    const id = STATE.peer?.id || 'peer';
    await DB.put(id, { side: 'them', text: '📢 chamou sua atenção!', ts: Date.now() });
    appendBubble({ side: 'them', text: '📢 chamou sua atenção!', ts: Date.now() });
    return;
  }
  if (data?.type === 'hello') {
    if (STATE.peer && STATE.peer.name.startsWith('Novo contato')) {
      STATE.chats[STATE.peer.id].name = data.name || STATE.peer.name;
      STATE.chats[STATE.peer.id].avatar = data.avatar || '🙂';
      LS.set('xvi_chats', STATE.chats);
      $('#chatName').textContent = data.name;
      pendingHello = data.name;
      renderContacts();
    }
    appendBubble({ side: 'sys', text: `${data.name || 'Contato'} conectou 💙`, ts: Date.now() });
    return;
  }
  const text = data?.text ?? String(payload);
  const side = 'them';
  sfx.msg();
  const name = data?.from || $('#chatName').textContent || 'peer';
  const entryKey = STATE.peer?.name === name ? STATE.peer.id : keyByName(name);
  await DB.put(entryKey, { side, text, ts: Date.now() });
  if (STATE.peer && entryKey === STATE.peer.id) appendBubble({ side, text, ts: Date.now() });
  STATE.chats[entryKey] = STATE.chats[entryKey] || {};
  STATE.chats[entryKey].preview = text.slice(0, 40);
  LS.set('xvi_chats', STATE.chats);
  renderContacts();
}
const keyByName = n => Object.keys(STATE.chats).find(k => STATE.chats[k]?.name === n) || n;

function transportSend(text) {
  const srv = STATE.net.server?.st;
  if (srv && srv.state === 'online') return srv.send(text);
  return STATE.net.sendSdp(text);
}
const _S = { sendSdp: transportSend };
STATE.net.sendSdp = transportSend;

function safeParse(s) { try { return JSON.parse(s); } catch { return null; } }

function appendBubble(m) {
  const log = $('#chatLog');
  log.insertAdjacentHTML('beforeend', bubbleHTML(m));
  log.scrollTop = log.scrollHeight;
}

function sendMessage() {
  const input = $('#msgInput');
  const text = input.value.trim();
  if (!text || !STATE.peer) return;
  try {
    STATE.net.sendSdp(JSON.stringify({ type: 'msg', from: STATE.me.name, text }));
    DB.put(STATE.peer.id, { side: 'me', text, ts: Date.now() });
    STATE.chats[STATE.peer.id] = STATE.chats[STATE.peer.id] || {};
    STATE.chats[STATE.peer.id].preview = text.slice(0, 40);
    LS.set('xvi_chats', STATE.chats);
    appendBubble({ side: 'me', text, ts: Date.now() });
    renderContacts();
    input.value = '';
  } catch (e) {
    toast('⚠ ' + (e.message || 'canal não aberto'));
  }
}

function markNudge() {
  if (!STATE.peer) return toast('Selecione um contato');
  try {
    STATE.net.sendSdp(JSON.stringify({ type: 'nudge' }));
    DB.put(STATE.peer.id, { side: 'me', text: '📢 você chamou a atenção!', ts: Date.now() });
    appendBubble({ side: 'me', text: '📢 você chamou a atenção!', ts: Date.now() });
    sfx.nudge();
  } catch (e) { toast('⚠ ' + (e.message || 'canal não aberto')); }
}

function nudgeReceived() {
  $('#chatWin').classList.remove('shake');
  requestAnimationFrame(() => $('#chatWin').classList.add('shake'));
  setTimeout(() => $('#chatWin').classList.remove('shake'), 1300);
}

/* ============ fluxo de conexão WebRTC manual ============ */
function drawQRLegacy() {} // reimplementado abaixo (createDataURL, img)
const _unusedDraw = drawQRLegacy;

$('#connBtn').onclick = () => {
  $('#connModal').classList.remove('hidden');
  $('#wifiFlow').classList.toggle('hidden', $('#netMode').value !== 'wifi');
  $('#bleFlow').classList.toggle('hidden', $('#netMode').value !== 'ble');
};
$('#connClose').onclick = () => $('#connModal').classList.add('hidden');
$('#scanClose').onclick = () => stopScanner();
$('#netMode').onchange = () => {
  const wifi = $('#netMode').value === 'wifi';
  $('#wifiFlow').classList.toggle('hidden', !wifi);
  $('#bleFlow').classList.toggle('hidden', $('#netMode').value !== 'ble');
  $('#serverFlow').classList.toggle('hidden', $('#netMode').value !== 'server');
  STATE.net.setMode($('#netMode').value);
};

/* ============ MODO SERVIDOR ============ */
STATE.net.server = { st: null, peers: [] };
$('#srvUrl').value = LS.get('xvi_srv_url', '');
$('#srvRoom').value = LS.get('xvi_srv_room', 'salavip');

$('#srvJoin').onclick = async () => {
  const url = $('#srvUrl').value.trim().replace(/\s/g, '');
  const room = $('#srvRoom').value.trim() || 'salavip';
  if (!url) return toast('Informe a URL do servidor');
  LS.set('xvi_srv_url', url); LS.set('xvi_srv_room', room);
  $('#srvState').textContent = '⏳ conectando…';
  const { ServerTransport } = await import('./network.js');
  STATE.net.server.st = new ServerTransport({
    onServerMessage: txt => onServerMessage(txt),
    onClose: () => {
      $('#srvState').textContent = 'saiu da sala';
      $('#srvLeave').classList.add('hidden');
      $('#srvJoin').classList.remove('hidden');
      renderContacts();
    },
  });
  try {
    await STATE.net.server.st.connect(url, room, STATE.me.name);
    $('#srvLeave').classList.remove('hidden');
    $('#srvState').textContent = `✅ na sala "${room}" — aguardando presença…`;
  } catch (e) {
    $('#srvState').textContent = '⚠ ' + e.message;
  }
};

$('#srvLeave')?.addEventListener('click', () => {
  STATE.net.server.st?.close();
  STATE.net.server.st = null;
  $('#srvLeave').classList.add('hidden');
  $('#srvJoin').classList.remove('hidden');
});

function onServerMessage(txt) {
  const d = safeParse(txt);
  if (!d) return;
  if (d.type === 'welcome') {
    STATE.net.server.st.markOnline();
    $('#srvState').textContent = `✅ online na sala "${d.room}"`;
    toast('Conectado ao servidor! 🌐');
    return;
  }
  if (d.type === 'presence') {
    STATE.net.server.peers = d.peers || [];
    renderContacts();
    $('#srvState').textContent = `✅ sala com ${STATE.net.server.peers.length} pessoa(s)`;
    return;
  }
  if (d.type === 'sys') {
    appendBubble({ side: 'sys', text: (d.text || '') + ' 💙', ts: d.ts || Date.now() });
    return;
  }
  onChannelMessage(JSON.stringify({ ...d, via: 'server' }));
}

$('#roleA').onclick = async () => {
  $('#flowA').classList.remove('hidden');
  $('#flowB').classList.add('hidden');
  toast('Gerando cartão de oferta… aguarde ICE (~10s)');
  const o = await STATE.net.createOffer();
  $('#offerText').value = o;
  try { drawQR($('#qrOffer'), o); } catch (e) { toast('QR acima do limite, use copy/paste'); }
  STATE.sdp.offer = o;
  LS.set('xvi_sdp', STATE.sdp);
};

$('#acceptOffer').onclick = async () => {
  const raw = $('#offerPaste').value.trim();
  if (!raw) return toast('Cole o SDP Offer Base64');
  try {
    $('#answerText').value = await STATE.net.acceptOffer(raw);
    $('#answerZone').classList.remove('hidden');
    drawQR($('#qrAnswer'), $('#answerText').value);
    toast('Resposta gerada! Mostre o QR ao criador.');
  } catch (e) { toast('⚠ oferta inválida: ' + e.message); }
};

$('#applyAnswer').onclick = async () => {
  const raw = $('#answerPaste').value.trim();
  if (!raw) return toast('Cole o SDP Answer Base64');
  try {
    await STATE.net.applyAnswer(raw);
    toast('Aplicando resposta — canal abrindo…');
  } catch (e) { toast('⚠ resposta inválida: ' + e.message); }
};

$('#offerText').onclick = e => e.target.select();
$('#answerText').onclick = e => e.target.select();

/* ============ scanner (jsQR) ============ */
let scanStream = null, scanJob = null, scanResolve = null;

$('#scanOffer').onclick = () => scan(onOfferScanned);
$('#scanAnswer').onclick = () => scan(onAnswerScanned);

async function scan(cb) {
  scanResolve = cb;
  $('#scanErr').textContent = '';
  $('#scanModal').classList.remove('hidden');
  try {
    scanStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 1280 } },
      audio: false,
    });
    $('#scanVideo').srcObject = scanStream;
    $('#scanVideo').play();
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const video = $('#scanVideo');
    scanJob = setInterval(() => {
      if (video.readyState < 2) return;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0);
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = window.jsQR(img.data, img.width, img.height, { inversionAttempts: 'attemptBoth' });
      if (code?.data) onScanned(code.data);
    }, 220);
  } catch (e) {
    $('#scanErr').textContent = 'Câmera indisponível: ' + (e.message || e.name);
  }
}

function onScanned(text) {
  stopScanner();
  scanResolve?.(text);
}

function onOfferScanned(offer) {
  $('#offerPaste').value = offer;
  $('#acceptOffer').click();
}

function onAnswerScanned(answer) {
  $('#answerPaste').value = answer;
  $('#applyAnswer').click();
  $('#connModal').classList.add('hidden');
}

function stopScanner() {
  clearInterval(scanJob);
  scanStream?.getTracks().forEach(t => t.stop());
  scanStream = null;
  $('#scanModal').classList.add('hidden');
}

/* ============ status clássico ============ */
$('#statusOpen').onclick = e => { e.stopPropagation(); $('#statusMenu').classList.toggle('hidden'); };
document.addEventListener('click', e => {
  if (!e.target.closest('.status-line') && !e.target.closest('.status-menu'))
    $('#statusMenu').classList.add('hidden');
});
$$('#statusMenu button').forEach(b => b.onclick = () => {
  STATE.me.st = b.dataset.st;
  LS.set('xvi_me', STATE.me);
  $('#statusLabel').textContent = STATUS_CFG[b.dataset.st].label;
  $('#statusMenu .dot').className = 'dot ' + STATUS_CFG[b.dataset.st].cls;
  $('#statusMenu').classList.add('hidden');
  toast('Status: ' + STATUS_CFG[b.dataset.st].label);
});
$('#statusMenu .dot').className = 'dot online';

$('#myName').addEventListener('change', () => {
  STATE.me.name = $('#myName').value.trim() || STATE.me.name;
  LS.set('xvi_me', STATE.me);
  $('#myName').value = STATE.me.name;
  try { STATE.net.sendSdp(JSON.stringify({ type: 'hello', name: STATE.me.name, avatar: STATE.me.avatar })); } catch {}
});

/* ============ envio & teclado ============ */
$('#sendBtn').onclick = sendMessage;
$('#msgInput').addEventListener('keydown', e => { if (e.key === 'Enter') sendMessage(); });
$('#nudgeBtn').onclick = markNudge;
$('#chatLog').addEventListener('animationend', () => {});

/* mobile: voltar */
$('#chatName').closest('.xp-title.chat').insertAdjacentHTML(
  'afterbegin', '<button class="back-btn" id="backBtn">← Voltar</button>');
$('#backBtn').onclick = () => document.documentElement.classList.remove('chat-open');

/* ============ boot e portão de acesso (estilo WLM) ============ */
function drawQR(img, text) {
  const qr = window.qrcode(0, 'L');
  qr.addData(text);
  qr.make();
  img.style.width = '210px';
  img.style.height = '210px';
  img.src = qr.createDataURL(4, 0);
  img.alt = 'QRcode';
}

function loginOk(email = '') {
  localStorage.setItem('xvi_auth', JSON.stringify({ email, ts: Date.now() }));
  $('#gate').classList.add('hidden');
  $('#session').classList.remove('hidden');
  $('#myName').value = STATE.me.name;
  STATE.me.st = $('#gateAs')?.value || 'online';
  $('#statusLabel').textContent = STATUS_CFG[STATE.me.st.toLowerCase()]?.label || 'Online';
  $('#psmPreview').textContent = '("' + LS.get('xvi_psm', 'lerolero da Silva XVI') + '")';
  updatePsm();
  renderContacts();
}

function updatePsm() {
  const psm = LS.get('xvi_psm', '');
  const p = $('#psmPreview');
  if (p) p.textContent = psm ? `("${psm}")` : '';
  $('#myName') && LS.set('xvi_me', { ...STATE.me, name: STATE.me.name });
}

$('#gateBtn').onclick = async () => {
  const email = $('#gateEmail').value.trim().toLowerCase().replace(/\s+/g, '');
  const pass = $('#gatePass').value;
  if (!email) return gateMsg('Digite o endereço de email.');
  const cfg = window.__gsCfg;
  if (!cfg) return gateMsg('Não carregou lista. Recarregue.');
  // se a "senha" for a master, abre painel admin pós-login
  const masterOk = pass && (await (async () => {
    const h = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pass)))]
      .map(x => x.toString(16).padStart(2, '0')).join('');
    return h === cfg.adminPassHash;
  })());
  const hEmail = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(email)))]
    .map(x => x.toString(16).padStart(2, '0')).join('');
  if (cfg.authorized.includes(hEmail) || localStorage.getItem('xvi_auth_em_' + hEmail) === '1') {
    loginOk(email);
    if (masterOk) openAdmin();
    return;
  }
  if (masterOk) {
    localStorage.setItem('xvi_auth_em_' + hEmail, '1');
    loginOk(email);
    openAdmin();
    return;
  }
  gateMsg('E-mail não autorizado. Entre como admin para liberar.');
};

function gateMsg(m) { $('#gateMsg').textContent = m; }

let localAuth = [];
function openAdmin() {
  localAuth = [...new Set([...(window.__gsCfg?.authorized ?? [])])].filter(Boolean);
  $('#adminEmail') && ($('#adminModal').classList.remove('hidden'), fillAdmin());
}
function fillAdmin() {
  const box = $('#adminList');
  if (!box) return;
  box.innerHTML = localAuth.length
    ? localAuth.map(h => `<div class="item"><span style="font-size:11px">${h.slice(0, 14)}…</span>
      <button class="wlm-btn" data-rm="${h}" style="padding:3px 8px">✕</button></div>`).join('')
    : '<p class="hint">Nenhum e-mail autorizado.</p>';
  box.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => {
    localAuth = localAuth.filter(x => x !== b.dataset.rm);
    fillAdmin();
  });
}
$('#adminExport')?.addEventListener('click', () => {
  if (!$('#adminExport')) return;
  const blob = new Blob([JSON.stringify({
    _comment: 'Lista de e-mails autorizados (SHA-256)',
    adminPassHash: window.__gsCfg?.adminPassHash,
    authorized: localAuth,
  }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'authorized.json';
  a.click();
  toast('Faça commit do authorized.json para publicar');
});
$('#adminAdd')?.addEventListener('click', async () => {
  const email = $('#adminEmail').value.trim().toLowerCase();
  if (!email) return;
  const h = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(email)))]
    .map(x => x.toString(16).padStart(2, '0')).join('');
  if (!localAuth.includes(h)) localAuth.push(h);
  $('#adminEmail').value = '';
  fillAdmin();
  toast('Autorizado! Exporte o authorized.json ✔');
});
$('#gateAdmin')?.addEventListener('click', () => openAdmin());

/* ===== busca na lista ===== */
$('#searchBox').addEventListener('input', e => renderContacts(e.target.value));
$('#addContactBtn')?.addEventListener('click', () => $('#connModal').classList.remove('hidden'));
$('#logout')?.addEventListener('click', () => {
  $('#session').classList.add('hidden');
  $('#gate').classList.remove('hidden');
});

/* ===== relógio XP ===== */
function xpClock() {
  const d = new Date();
  $('#xpClock') && ($('#xpClock').textContent =
    d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }));
}
setInterval(xpClock, 15000); xpClock();

/* ============ boot ============ */
(async () => {
  try { window.__gsCfg = await (await fetch('authorized.json', { cache: 'no-store' })).json(); } catch {}
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
  $('#myName').value = STATE.me.name;
  $('#statusLabel').textContent = STATUS_CFG[STATE.me.st]?.label || 'Online';
  renderContacts();
  const ready = () => { $('#netStatus').textContent = STATE.net?.wifi.channel?.readyState === 'open' ? 'canal P2P ativo' : 'sem canal'; };
  setInterval(ready, 2000);
})();
