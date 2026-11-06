/* ==== SILVA XVI messenger — core P2P (WebRTC manual + BLE bimodal) ==== */

export const NET_MODES = { WIFI: 'wifi', BLE: 'ble' };

export class NetworkError extends Error {}
export const TIMEOUT_MS = 12000;

function b64(data) {
  return btoa(String.fromCharCode(...new Uint8Array(data)));
}
function fromB64(str) {
  return new Uint8Array(atob(str.replace(/\s/g, '')).split('').map(c => c.charCodeAt(0)));
}

const RTC_CONFIG = {
  iceServers: [],
  iceCandidatePoolSize: 2,
};

export class WifiTransport {
  constructor(handlers) {
    this.h = handlers || {};
    this.pc = null;
    this.channel = null;
    this.role = null;
  }

  _setupChannel(rawChannel) {
    this.channel = rawChannel;
    this.channel.binaryType = 'arraybuffer';
    this.channel.onmessage = e => this.h.onMessage?.(e.data);
    this.channel.onopen = () => this.h.onOpen?.();
    this.channel.onclose = () => this.h.onClose?.();
    this.channel.onerror = err => this.h.onError?.(err);
  }

  _bindIce(pc, promiseFor) {
    pc.onicecandidate = ({ candidate }) => {
      if (!candidate) this.h.onLocalSDPReady?.(promiseFor);
      this.pc = pc;
    };
    pc.onconnectionstatechange = () => {
      const st = pc.connectionState;
      if (st === 'failed' || st === 'disconnected' || st === 'closed') this.h.onClose?.(st);
      if (st === 'failed') this.h.onError?.(new NetworkError('ICE failed'));
    };
  }

  async createOffer() {
    this.role = 'A';
    this.pc = new RTCPeerConnection(RTC_CONFIG);
    this._bindIce(this.pc, 'offer');
    this._setupChannel(this.pc.createDataChannel('xvi', { ordered: true }));
    await this.pc.setLocalDescription(await this.pc.createOffer());
    const sdp = await this._waitIceComplete();
    return b64(new TextEncoder().encode(JSON.stringify(sdp)));
  }

  async acceptOffer(offerB64) {
    this.role = 'B';
    this.pc = new RTCPeerConnection(RTC_CONFIG);
    this._bindIce(this.pc, 'answer');
    this.pc.ondatachannel = e => this._setupChannel(e.channel);
    await this.pc.setRemoteDescription(new RTCSessionDescription(JSON.parse(new TextDecoder().decode(fromB64(offerB64)))));
    await this.pc.setLocalDescription(await this.pc.createAnswer());
    const sdp = await this._waitIceComplete();
    return b64(new TextEncoder().encode(JSON.stringify(sdp)));
  }

  async applyAnswer(answerB64) {
    if (!this.pc) throw new NetworkError('crie a oferta primeiro');
    await this.pc.setRemoteDescription(new RTCSessionDescription(JSON.parse(new TextDecoder().decode(fromB64(answerB64)))));
  }

  async _waitIceComplete() {
    if (this.pc.iceGatheringState === 'complete') return this.pc.localDescription.toJSON();
    return await new Promise((resolve, reject) => {
      const t = setTimeout(() => resolve(this.pc.localDescription.toJSON()), TIMEOUT_MS);
      this.pc.addEventListener('icegatheringstatechange', () => {
        if (this.pc.iceGatheringState === 'complete') {
          clearTimeout(t);
          resolve(this.pc.localDescription.toJSON());
        }
      });
    });
  }

  send(text) {
    if (!this.channel || this.channel.readyState !== 'open') throw new NetworkError('canal fechado');
    this.channel.send(text);
  }

  close() {
    try { this.channel?.close(); this.pc?.close(); } catch {}
    this.channel = this.pc = null;
  }
}

/* ==== Bluetooth LE — camada Capacitor bimodal (GATT) ==== */
export const BLE_SERVICE_UUID = 'a5b0e100-6c1d-4c71-9f3b-7ad21a66c40e';
export const BLE_CHAR_UUID = 'a5b0e101-6c1d-4c71-9f3b-7ad21a66c40e';
export const BLE_CHUNK = 180;

export function classifyBLE(dataOrText) {
  return dataOrText instanceof DataView ? new Uint8Array(dataOrText.buffer) : new TextEncoder().encode(String(dataOrText));
}

export class BLETransport {
  constructor(handlers) {
    this.h = handlers || {};
    this.plugin = null;
    this.connectedId = null;
  }

  async ensurePlugin() {
    if (this.plugin) return this.plugin;
    const Cap = globalThis.Capacitor;
    if (!Cap?.isNativePlatform?.()) throw new NetworkError('BLE requer app híbrido Capacitor (@capacitor-community/bluetooth-le)');
    try {
      this.plugin = Cap.Plugins.BluetoothLe || (await import('@capacitor-community/bluetooth-le')).BluetoothLe;
    } catch {
      throw new NetworkError('Plugin bluetooth-le não instalado no build');
    }
    await this.plugin.initialize?.();
    return this.plugin;
  }

  async enable() {
    const p = await this.ensurePlugin();
    await p?.requestPermissions?.();
    this.mode = this.mode || 'peripheral';
    return p;
  }

  async advertise() {
    const p = await this.ensurePlugin();
    this.mode = 'peripheral';
    return p.startAdvertising?.({ serviceUUIDs: [BLE_SERVICE_UUID], deviceName: 'SILVA-XVI' }) ?? true;
  }

  async scanAndConnect(onFound) {
    const p = await this.ensurePlugin();
    this.mode = 'central';
    await p.requestLEScan?.({ services: [BLE_SERVICE_UUID] });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new NetworkError('nenhum peripheral SILVA-XVI no alcance')), 15000);
      p.addListener?.('onScanResult', async ({ device }) => {
        onFound?.(device);
        clearTimeout(timer);
        try {
          await p.connect({ deviceId: device.deviceId });
          this.connectedId = device.deviceId;
          await p.discoverServices?.({ deviceId: device.deviceId });
          await p.startNotifications?.({ deviceId: device.deviceId, service: BLE_SERVICE_UUID, characteristic: BLE_CHAR_UUID });
          p.addListener?.('onCharacteristicChanged', handleCharacteristicChanged);
          resolve(device);
        } catch (e) { reject(new NetworkError(String(e?.message || e))); }
      });
    });
  }

  async send(text) {
    const p = this.plugin;
    if (!p || !this.connectedId) throw new NetworkError('BLE não conectado');
    const bytes = classifyBLE(text);
    for (let i = 0; i < bytes.length; i += BLE_CHUNK) {
      const slice = bytes.slice(i, i + BLE_CHUNK);
      let bin = '';
      slice.forEach(b => (bin += String.fromCharCode(b)));
      await p.writeCharacteristic?.({
        deviceId: this.connectedId,
        service: BLE_SERVICE_UUID,
        characteristic: BLE_CHAR_UUID,
        value: btoa(bin),
      }).catch?.(() => p.write?.({ value: btoa(bin) }).catch?.());
    }
  }

  close() {
    this.connectedId && this.plugin?.disconnect?.({ deviceId: this.connectedId }).catch?.();
    this.connectedId = null;
  }
}

export let _inboundTextHandler = null;
export function attachInbound(fn) { _inboundTextHandler = fn; }
export function handleCharacteristicChanged({ value }) {
  const bytes = new Uint8Array(value.data || value);
  const text = new TextDecoder().decode(bytes);
  _inboundTextHandler?.(text);
}

/* ==== Servidor de sinalização (WebSocket relay) ==== */
export class ServerTransport {
  constructor(handlers) {
    this.h = handlers || {};
    this.ws = null;
    this.room = null;
    this.name = null;
    this.state = 'idle';
  }

  connect(url, room, name) {
    return new Promise((resolve, reject) => {
      this.room = room || 'salavip';
      this.name = name || 'Anon';
      this.state = 'connecting';
      const proto = url.startsWith('wss://') || url.startsWith('ws://')
        ? url
        : `${location.protocol === 'https:' ? 'wss' : 'ws'}://${url.replace(/^https?:\/\//, '')}`;
      try { this.ws = new WebSocket(proto); } catch (e) { this.state = 'erro'; return reject(new NetworkError('URL inválida')); }
      this.h.onStatus?.('conectando…');
      this.ws.onopen = () => this.ws.send(JSON.stringify({ type: 'join', room: this.room, name: this.name }));
      this.ws.onmessage = e => this.h.onServerMessage?.(e.data);
      this.ws.onclose = () => {
        if (this.state === 'connecting') { this.state = 'erro'; reject(new NetworkError('não conectou: server offline ou URL errada')); return; }
        this.state = 'idle';
        this.h.onClose?.('server');
      };
      this.ws.onerror = () => {};
      const installed = setInterval(() => {
        if (this.state === 'online') { clearInterval(installed); resolve(this.room); }
        if (this.state === 'erro') { clearInterval(installed); }
      }, 200);
      setTimeout(() => { if (this.state !== 'online') { clearInterval(installed); this.state = 'erro'; reject(new NetworkError('timeout no servidor')); } }, 10000);
    });
  }

  markOnline() {
    this.state = 'online';
    this.h.onOpen?.();
  }

  send(text) {
    if (this.state !== 'online') throw new NetworkError('fora da sala');
    this.ws.send(text);
  }

  close() {
    try { this.ws?.close(); } catch {}
    this.ws = null;
    this.state = 'idle';
  }
}

export class NetworkManager {
  constructor(handlers) {
    this.h = handlers;
    this.wifi = new WifiTransport(handlers);
    this.ble = new BLETransport(handlers);
    this.mode = NET_MODES.WIFI;
  }
  setMode(m) { this.mode = m; }
  async acceptOffer(b64sdp) { return this.wifi.acceptOffer(b64sdp); }
  async createOffer() { return this.wifi.createOffer(false); }
  async applyAnswer(b64sdp) { return this.wifi.applyAnswer(b64sdp); }
  sendSdp(text) {
    return this.mode === BLE ? this.ble.send(text) : this.wifi.send(text);
  }
}
