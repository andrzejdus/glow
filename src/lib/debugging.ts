import { Capacitor, registerPlugin } from '@capacitor/core';

// "Debugging from a computer" (android/.../DebuggingPlugin.java). Native only: in a browser the
// page is always inspectable, so there is nothing to switch.
export interface DebuggingState {
  enabled: boolean;
  debugBuild: boolean;
}

interface DebuggingPlugin {
  get(): Promise<DebuggingState>;
  set(options: { enabled: boolean }): Promise<DebuggingState>;
}

export const debugging = Capacitor.isNativePlatform() ? registerPlugin<DebuggingPlugin>('Debugging') : null;
