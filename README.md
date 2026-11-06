# SILVA XVI messenger 🕹️💬

Clone nostálgico do MSN Messenger, focado em comunicação **P2P 100% offline** (sem internet).

## Estética
Janelas flutuantes estilo Windows Live Messenger, menu de status clássico (Online, Ocupado, Volto logo, Offline), botão "Chamar Atenção" com janela que **treme** e som retrô.

## 🔌 Modos desconectados
| Modo | Como funciona |
|---|---|
| 📶 **Wi-Fi Local (WebRTC manual)** | Mesmo roteador SEM internet (ou hotspot). Criador gera SDP Offer em Base64 → QR Code. Contato escaneia → gera SDP Answer → QR de resposta. Criador escaneia e o canal P2P abre para mensagens em tempo real. Sem servidor de sinalização: tudo trocado via QR/strings. |
| 🔵 **Bluetooth LE (Capacitor)** | Modo Peripheral anuncia UUID `a5b0e100-…`; Central escaneia, conecta e troca pacotes (chunks de 180 B) por GATT characteristic. Requer build híbrido Capacitor com `@capacitor-community/bluetooth-le`. |

## 💾 Persistência
- **Service Worker** cache-first: após instalar uma vez, o PWA abre em modo avião
- **IndexedDB**: histórico de conversas por contato (mensagens, lero-lero e nudge ficam no aparelho)

## 📱 Instalação
1. Abra a URL do GitHub Pages no Chrome
2. Menu → *Adicionar à tela inicial* / *Instalar app*

## 🦊 App híbrido (BLE)
Para ativar o transporte via Bluetooth:
```bash
npm i -D @capacitor/cli @capacitor/core
npx cap init "SILVA XVI" -i com.silva16.messenger
npm i @capacitor-community/bluetooth-le
npx cap add android && npx cap sync android
```
(o modo Wi-Fi funciona até no navegador puro)

## Stack
Vanilla ES6+ modular · RTCPeerConnection manual · GATT bimodal · jsQR vendado · qrcode-generator vendado · WebAudio clássico · CSS custom properties

⚠️ Projeto educacional sem coleções de dados — nada sai do aparelho. 💙
