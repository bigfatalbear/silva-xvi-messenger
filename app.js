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
  _p: null,
  open() {
    if (this._p) return this._p;
    this._p = new Promise((res, rej) => {
      const r = indexedDB.open('xvi-db', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('msgs', { keyPath: 'id' });
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    return this._p;
  },
  async put(peer, msg) {
    const db = await this.open();
    return new Promise(res => {
      const tx = db.transaction('msgs', 'readwrite');
      tx.objectStore('msgs').put({ id: `${peer}:${Date.now()}:${Math.random().toString(36).slice(2, 6)}`, peer, msg });
      tx.oncomplete = res;
    });
  },
  async byPeer(peer) {
    const db = await this.open();
    return new Promise(res => {
      const out = [];
      const req = db.transaction('msgs', 'readonly').objectStore('msgs').openCursor();
      req.onsuccess = () => {
        const c = req.result;
        if (!c) { res(out); return; }
        if (c.value.peer === peer) out.push(c.value);
        c.continue();
      };
      req.onerror = () => res(out);
    });
  },
};
DB.open().then(db => {
  const store = db.transaction('msgs', 'readwrite').objectStore('msgs');
  if (!store.indexNames.contains('peer')) {
    db.close();
    indexedDB.deleteDatabase('xvi-db');
    const r2 = indexedDB.open('xvi-db', 2);
    r2.onupgradeneeded = () => {
      const s = r2.result.createObjectStore('msgs', { keyPath: 'id' });
      s.createIndex('peer', 'peer', { unique: false });
    };
    r2.onsuccess = () => { DB._p = Promise.resolve(r2.result); };
  }
});

/* ============ contatos / lista ============ */
function contactEntry(id, name, avatar) {
  return { id, name, avatar, st: 'offline', preview: '' };
}
function knownPeers() {
  const chats = STATE.chats;
  const entry = k => chats[k] || contactEntry(k, k.split('|')[0] || 'Contato', '🙂');
  return Object.keys(chats).map(k => {
    const e = contactEntry(k, chats[k]?.name || k.split('|')[0], chats[k]?.avatar || '🙂');
    e.st = STATE.sdp.answer && k === activePeerLabel() ? 'online' : 'offline';
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
  $('#defTitle').textContent = `▾ Disponíveis (${on.length})`;
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
  const id = STATE.sdp.answer ? $('#chatName').textContent : 'Novo contato';
  if (!STATE.peer) {
    const key = `${id}|${Date.now()}`;
    STATE.chats[key] = contactEntry(key, id, '🙂');
    STATE.chats[key].st = 'online';
    LS.set('xvi_chats', STATE.chats);
    renderContacts();
    selectContact(key);
  }
}

async function onChannelMessage(payload) {
  const data = safeParse(payload);
  if (data?.type === 'nudge') {
    nudgeReceived();
    sfx.nudge();
    await DB.put($('#chatName').textContent || 'peer', { side: 'them', text: '📢 chamou sua atenção!', ts: Date.now() });
    appendBubble({ side: 'them', text: '📢 chamou sua atenção!', ts: Date.now() });
    return;
  }
  if (data?.type === 'hello') {
    const key = `${data.name}|${Date.now()}`;
    STATE.chats[key] = { ...contactEntry(key, data.name, data.avatar) , preview: '' };
    LS.set('xvi_chats', STATE.chats);
    renderContacts();
    toast(data.name + ' conectou! 💙');
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
function drawQR(canvas, text) {
  const qr = window.qrcode(0, 'L');
  qr.addData(text);
  qr.make();
  const cell = Math.max(2, Math.floor(210 / qr.getModuleCount()));
  canvas.width = canvas.height = qr.getModuleCount() * cell;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#0a2a5e';
  for (let r = 0; r < qr.getModuleCount(); r++) {
    for (let c = 0; c < qr.getModuleCount(); c++) {
      if (qr.isDark(r, c)) ctx.fillRect(c * cell, r * cell, cell, cell);
    }
  }
}

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
  $('#bleFlow').classList.toggle('hidden', wifi);
  STATE.net.setMode(wifi ? NET_MODES.WIFI : NET_MODES.BLE);
};

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
$('#chatName').closest('.win-title.chat').insertAdjacentHTML(
  'afterbegin', '<button class="back-btn" id="backBtn">← Voltar</button>');
$('#backBtn').onclick = () => document.documentElement.classList.remove('chat-open');

/* ============ boot ============ */
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
$('#myName').value = STATE.me.name;
$('#statusLabel').textContent = STATUS_CFG[STATE.me.st].label;
renderContacts();
setInterval(() => {
  const ready = STATE.net?.wifi.channel?.readyState === 'open';
  $('#netStatus').textContent = ready ? 'canal P2P ativo' : 'sem canal';
}, 2000);

window.addEventListener('exportBLEDebug', e => toast('BLE: ' + (e.detail || 'ok')));
