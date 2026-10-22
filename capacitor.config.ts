import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'pl.gogoad.glow',
  appName: 'Glow',
  webDir: 'dist',
  backgroundColor: '#F6F6F6',
  android: {
    // Everything ships inside the APK; the app never loads anything remote.
    allowMixedContent: false,
  },
  plugins: {
    SystemBars: {
      insetsHandling: 'css',
      initialViewportFitValueHint: 'cover',
      style: 'LIGHT',
    },
    BluetoothLe: {
      displayStrings: {
        scanning: 'Looking for your device…',
        cancel: 'Cancel',
        availableDevices: 'Devices nearby',
        noDeviceFound: 'No device found',
      },
    },
  },
};

export default config;
