import type { BleTransport } from './ble/transport';
import { QVAP_CONTROL } from './devices/qvap';
import { createDriver, modelNames } from './devices/registry';
import type { DeviceKind, DeviceState } from './devices/types';
import { sessions } from './sessions.svelte';
import { usage } from './usage.svelte';

// Replays what the background recorder (android/.../Recorder.java) logged while Glow was closed,
// through the same drivers a live connection uses, into the session log and the hours of operation.
// The log format is described in Recorder.java.

interface Line {
  t: number;
  type: string;
  service: string;
  chr: string;
  value: DataView;
}

export interface Recording {
  id: string;
  kind: DeviceKind;
  /** When the recording starts: the values are as they stood then. */
  start: number;
  values: Line[];
  /** What came after, oldest first: reads (R), notifications (N), refresh rounds (F). */
  entries: Line[];
  /** When it ended; the last entry's time when the log was cut off. */
  end: number;
  /** idle, lost, app, off; null when cut off (Glow was killed while recording). */
  reason: string | null;
}

const KINDS: DeviceKind[] = ['venty', 'veazy', 'volcano', 'crafty'];

function hexView(hex: string): DataView {
  const bytes = new Uint8Array(hex === '-' ? 0 : hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  return new DataView(bytes.buffer);
}

/** Recordings in the log, oldest first. Lines that do not parse are skipped. */
export function parseLog(text: string): Recording[] {
  const out: Recording[] = [];
  let r: Recording | null = null;
  let started = false;
  for (const raw of text.split('\n')) {
    const parts = raw.trim().split(' ');
    const t = Number(parts[0]);
    const type = parts[1];
    if (!Number.isFinite(t) || !type) continue;
    if (type === 'B') {
      const kind = parts[3] as DeviceKind;
      r = KINDS.includes(kind) ? { id: parts[2], kind, start: t, values: [], entries: [], end: t, reason: null } : null;
      if (r) out.push(r);
      started = false;
      continue;
    }
    if (!r) continue;
    if (type === 'S') started = true;
    else if (type === 'E') {
      r.end = t;
      r.reason = parts[2] ?? 'lost';
      r = null;
    } else if (type === 'F') {
      if (started) r.entries.push({ t, type, service: '', chr: '', value: new DataView(new ArrayBuffer(0)) });
    } else if ((type === 'V' || type === 'R' || type === 'N') && parts.length >= 5 && /^([0-9a-f]{2})*$|^-$/.test(parts[4])) {
      const line = { t, type, service: parts[2], chr: parts[3], value: hexView(parts[4]) };
      if (type === 'V') r.values.push(line);
      else if (started) r.entries.push(line);
      r.end = Math.max(r.end, t);
    }
  }
  return out;
}

/**
 * A BleTransport that answers from the log: a read gets the characteristic's value as it stood,
 * and a VENTY/VEAZY request gets the frame the device last sent for that command.
 */
class LogTransport implements BleTransport {
  private values = new Map<string, DataView>();
  private listeners = new Map<string, (v: DataView) => void>();

  constructor(private readonly framed: boolean) {}

  private key(chr: string, value: DataView) {
    return this.framed && chr === QVAP_CONTROL && value.byteLength > 0 ? `${chr}/${value.getUint8(0)}` : chr;
  }

  /** A copy: drivers may keep the views they are given. */
  private static copy(v: DataView) {
    return new DataView(v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength));
  }

  set(line: Line) {
    this.values.set(this.key(line.chr, line.value), line.value);
  }

  notify(line: Line) {
    this.set(line);
    this.listeners.get(`${line.service}/${line.chr}`)?.(LogTransport.copy(line.value));
  }

  async read(_service: string, chr: string): Promise<DataView> {
    const v = this.values.get(chr);
    if (!v) throw new Error(`Not in the log: ${chr}`);
    return LogTransport.copy(v);
  }

  async write(service: string, chr: string, value: DataView): Promise<void> {
    if (!this.framed || value.byteLength === 0) return;
    const frame = this.values.get(`${chr}/${value.getUint8(0)}`);
    const listener = this.listeners.get(`${service}/${chr}`);
    // The answer comes after the write, as from the device.
    if (frame && listener) queueMicrotask(() => listener(LogTransport.copy(frame)));
  }

  async writeWithoutResponse(): Promise<void> {}

  async startNotifications(service: string, chr: string, onValue: (value: DataView) => void): Promise<void> {
    this.listeners.set(`${service}/${chr}`, onValue);
  }

  async stopNotifications(service: string, chr: string): Promise<void> {
    this.listeners.delete(`${service}/${chr}`);
  }
}

/** How often the sessions hear from a recording that reports nothing new, as the live sampler does. */
const OBSERVE_MS = 5000;

async function replayOne(r: Recording) {
  const transport = new LogTransport(r.kind === 'venty' || r.kind === 'veazy');
  for (const v of r.values) transport.set(v);
  const state: DeviceState = {
    kind: r.kind,
    model: modelNames[r.kind],
    minTemp: 40,
    maxTemp: r.kind === 'volcano' ? 230 : 210,
    mode: 'normal',
    heaterOn: false,
    settings: {},
  };
  let now = r.start;
  let changed = false;
  let observed = 0;
  const apply = (patch: Partial<DeviceState>) => {
    const { settings, ...rest } = patch;
    Object.assign(state, rest);
    if (settings) state.settings = { ...state.settings, ...settings };
    changed = true;
  };
  const observe = async () => {
    changed = false;
    observed = now;
    // A copy each time: the session log keeps the last one it saw.
    const d = { ...state, settings: { ...state.settings } };
    usage.observe(d, now);
    sessions.observe(d, now);
    await sessions.settled();
  };
  const driver = createDriver(r.kind, transport);
  try {
    await driver.start(apply);
    await observe();
    for (const e of r.entries) {
      now = e.t;
      if (e.type === 'N') transport.notify(e);
      else if (e.type === 'R') transport.set(e);
      else await driver.refresh?.().catch(() => undefined);
      // Answers to requests arrive a microtask later.
      await Promise.resolve();
      if (changed || now - observed >= OBSERVE_MS) await observe();
    }
  } finally {
    await driver.stop().catch(() => undefined);
  }
  // Handed to the app: its own connection carries on from here, unmarked. Otherwise the device was gone.
  if (r.reason === 'app') sessions.suspend();
  else sessions.lost(r.end);
}

/**
 * Replays the recordings of this device into the session log and hours of operation, which must be
 * bound to it already. Recordings the log already holds (a replay cut short and read again) are
 * skipped. Returns how many were replayed.
 */
export async function replay(text: string, id: string): Promise<number> {
  const recordings = parseLog(text).filter((r) => r.id.toUpperCase() === id.toUpperCase() && r.entries.length > 0);
  let count = 0;
  sessions.pause(true);
  try {
    for (const r of recordings) {
      // Read before (a replay cut short): its sessions start within it, or one carried on through it.
      const covered = sessions.list.some(
        (s) => (s.id >= r.start && s.id <= r.end) || (s.id < r.start && Math.max(s.seen, s.end ?? 0) >= r.end),
      );
      if (covered) continue;
      try {
        await replayOne(r);
        count++;
      } catch (e) {
        console.warn('Glow: background recording not replayed', e);
      }
    }
  } finally {
    sessions.pause(false);
  }
  return count;
}
