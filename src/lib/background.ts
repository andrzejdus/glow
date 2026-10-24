import { Capacitor, registerPlugin } from '@capacitor/core';

// Background recording (android/.../BackgroundPlugin.java, Background.java, RecorderService.java).
// Android 12+ only: the system wakes Glow when the device comes into range, and a recorder with
// its own connection logs what the device reports. The app replays that log (replay.ts) before it
// connects itself, so its sessions and hours of operation carry on as if it had been there.
export interface BackgroundState {
  /** Android 12 or newer. */
  supported: boolean;
  enabled: boolean;
  /** The device it records, when one was ever set up. */
  id?: string;
  /** The system dialog was dismissed. */
  cancelled?: boolean;
}

interface BackgroundPlugin {
  status(): Promise<BackgroundState>;
  /** Shows Android's "Allow Glow to manage …?" dialog the first time. */
  enable(options: { id: string; name: string; kind: string; model: string }): Promise<BackgroundState>;
  disable(): Promise<BackgroundState>;
  /** The app's own connection is up: recording stops, and the log so far comes back. */
  hold(): Promise<{ log: string }>;
  /** The replayed log is stored; the recorder drops it. */
  done(): Promise<void>;
  /** The app's own connection ended; `present` when it let a device that is still on go. */
  release(options: { present: boolean }): Promise<void>;
}

export const background = Capacitor.isNativePlatform() ? registerPlugin<BackgroundPlugin>('Background') : null;
