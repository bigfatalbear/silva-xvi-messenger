import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'br.xvi.messenger',
  appName: 'SILVA XVI',
  webDir: 'www',
  server: {
    androidScheme: 'https',
  },
  plugins: {
    BluetoothLe: {
      displayPermission: 'SILVA XVI precisa do Bluetooth para conversar sem internet por perto.',
    },
  },
};

export default config;
