import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CRAFTY_UUIDS as C } from './devices/crafty';
import type { DeviceState } from './devices/types';

// The cool-down after Glow leaves the screen with the heater just off: the app's own cool-down stops
// with the page, the background recorder (android/.../Recorder.java) records the rest as a
// cool-down recording, and the replay adds it to the session that just ended.

// Storage that outlives the modules, as Preferences outlives a killed Glow.
const store = vi.hoisted(() => new Map<string, string>());
vi.mock('./prefs', () => ({
  load: async <T>(key: string, fallback: T): Promise<T> => (store.has(key) ? (JSON.parse(store.get(key)!) as T) : fallback),
  save: async (key: string, value: unknown) => void store.set(key, JSON.stringify(value)),
}));

// The background plugin, with the recorder's log.
const bg = vi.hoisted(() => {
  const self = {
    id: '',
    log: '',
    calls: [] as string[],
    status: async () => ({ supported: true, enabled: true, id: self.id }),
    hold: async () => self.give('hold'),
    take: async () => self.give('take'),
    give(call: string) {
      self.calls.push(call);
      const log = self.log;
      self.log = '';
      return { log };
    },
    done: async () => void self.calls.push('done'),
    release: async () => void self.calls.push('release'),
    hide: async () => undefined,
  };
  return self;
});
vi.mock('./background', () => ({ background: bg }));

/** A fresh Glow (new modules, the same storage), bound to the device unless it is the connection's to bind. */
async function launch(id?: string) {
  vi.resetModules();
  const { sessions } = await import('./sessions.svelte');
  const { replay } = await import('./replay');
  const { usage } = await import('./usage.svelte');
  if (id) {
    await usage.bind(id);
    await sessions.bind(id);
  }
  return { sessions, replay, usage };
}

type App = Awaited<ReturnType<typeof launch>>;

const T0 = new Date(2026, 10, 5, 0, 20, 0).getTime();
const at = (sec: number) => T0 + Math.round(sec * 1000);

const hex = (bytes: number[]) => bytes.map((b) => (b & 0xff).toString(16).padStart(2, '0')).join('');
const u16 = (v: number) => hex([v & 0xff, v >> 8]);
const text = (s: string) => hex([...s].map((c) => c.charCodeAt(0)));

const state = (patch: Partial<DeviceState>): DeviceState => ({
  kind: 'crafty', model: 'CRAFTY+', minTemp: 40, maxTemp: 210, mode: 'normal', heaterOn: false, targetTemp: 180, settings: {}, ...patch,
});

/** Cools 2° a second from 180° at heater off (60 s): 50° at 125 s. */
const fast = (sec: number) => Math.max(30, 180 - (sec - 60) * 2);
/** Cools half a degree a second: still 120° two minutes after heater off. */
const slow = (sec: number) => Math.max(30, 180 - (sec - 60) * 0.5);

/** Heats with Glow on screen from 11 s, heater off at 60 s, and Glow cools down with it for 5 s. */
function onScreen(app: App, cool = fast) {
  for (let sec = 0; sec <= 10; sec += 2) app.sessions.observe(state({ currentTemp: 30 }), at(sec));
  for (let sec = 11; sec < 60; sec++) app.sessions.observe(state({ heaterOn: true, currentTemp: Math.min(180, 30 + (sec - 11) * 4) }), at(sec));
  for (let sec = 60; sec <= 65; sec++) app.sessions.observe(state({ currentTemp: cool(sec) }), at(sec));
  expect(app.sessions.list[0].id).toBe(at(11));
  expect(app.sessions.list[0].end).toBe(at(60));
}

/**
 * A cool-down recording as the recorder writes it: it comes in at `start` with the heater off,
 * notifies the temperature every 2.5 s and ends at 50° ("idle"), at `until`, or with `end`.
 */
function coolLog(id: string, start: number, off: number | null, cool: (sec: number) => number, opts: { until?: number; end?: string; heaterOn?: [number, number] } = {}) {
  const t0 = at(start);
  const lines = [`${t0} B ${id} crafty Storz&Bickel`, `${t0} C ${off === null ? '-' : at(off)}`];
  const v = (svc: string, chr: string, value: string) => lines.push(`${t0} V ${svc} ${chr} ${value}`);
  v(C.SVC_CONTROL, C.targetTemp, u16(1800));
  v(C.SVC_INFO, C.serial, text('CY123456'));
  v(C.SVC_CONTROL, C.currentTemp, u16(cool(start) * 10));
  v(C.SVC_CONTROL, C.boostOffset, u16(100));
  v(C.SVC_INFO, C.firmware, text('V03.24'));
  v(C.SVC_SYSTEM, C.status2, u16(0));
  v(C.SVC_SYSTEM, C.useHours, u16(10));
  v(C.SVC_SYSTEM, C.useMinutes, u16(5));
  v(C.SVC_INFO, C.firmwareBle, hex([1, 2, 3]));
  v(C.SVC_CONTROL, C.ledBrightness, u16(100));
  v(C.SVC_CONTROL, C.autoShutoff, u16(120));
  v(C.SVC_CONTROL, C.autoShutoffRemaining, u16(0));
  v(C.SVC_CONTROL, C.battery, u16(80));
  v(C.SVC_SYSTEM, C.batteryVoltage, u16(3900));
  v(C.SVC_SYSTEM, C.batteryCurrent, u16(0));
  v(C.SVC_SYSTEM, C.status, u16(0x0400));
  v(C.SVC_SYSTEM, C.batteryStatus, u16(0));
  lines.push(`${t0} S`);
  const until = opts.until ?? (off ?? start) + 125;
  let end = until;
  let reason = opts.end ?? 'idle';
  for (let sec = start + 2.5; sec <= until; sec += 2.5) {
    const [on, offAgain] = opts.heaterOn ?? [Infinity, Infinity];
    if (sec - 2.5 < on && sec >= on) lines.push(`${at(sec)} N ${C.SVC_SYSTEM} ${C.status} ${u16(0x0410)}`);
    if (sec - 2.5 < offAgain && sec >= offAgain) lines.push(`${at(sec)} N ${C.SVC_SYSTEM} ${C.status} ${u16(0x0400)}`);
    const temp = cool(sec);
    lines.push(`${at(sec)} N ${C.SVC_CONTROL} ${C.currentTemp} ${u16(temp * 10)}`);
    if (temp <= 50 && !(sec >= on && sec < offAgain + 125)) {
      end = sec;
      reason = 'idle';
      break;
    }
  }
  lines.push(`${at(end)} E ${reason}`);
  return lines.join('\n');
}

/** The cool-down part of a session's samples: seconds after heater off (49 s in) and °C. */
async function cooldown(app: App) {
  const s = app.sessions.list.find((x) => x.id === at(11))!;
  const d = (await app.sessions.detail(s.id))!;
  const end = (s.end! - s.id) / 1000;
  return d.ts.map((t, i) => ({ t, c: d.c[i], g: d.g[i] })).filter((p) => p.t > end);
}

describe('cool-down after Glow leaves the screen', () => {
  beforeEach(() => store.clear());

  it('carries the cool-down on from the recorder, to 50°, once and in order', async () => {
    const id = 'AA:BB:CC:00:00:01';
    const app = await launch(id);
    onScreen(app);
    // Glow goes off screen 5 s after heater off: the app passes the time to the recorder, and stops.
    expect(app.sessions.coolingSince(at(65))).toBe(at(60));
    app.sessions.suspend();
    const log = coolLog(id, 68, 60, fast);
    expect(await app.replay(log, id)).toBe(1);
    // Back on screen with the device still connected.
    app.sessions.observe(state({ currentTemp: 30 }), at(300));
    expect(app.sessions.list).toHaveLength(1);
    const after = await cooldown(app);
    expect(after.map((p) => p.t)).toEqual([...new Set(after.map((p) => p.t))].sort((a, b) => a - b));
    expect(after.filter((p) => p.t === 54)).toHaveLength(1); // the app's own sample, 5 s after heater off
    expect(after.length).toBeGreaterThanOrEqual(12);
    expect(after.at(-1)!.c).toBeLessThanOrEqual(50);
    expect(after.every((p) => p.g === null)).toBe(true);
    const [s] = app.sessions.list;
    expect(s.background).toBe(true);
    // The timeline's points take in the cool-down.
    expect(s.spark.at(-1)).toBeLessThanOrEqual(50);
    // Read again (a replay cut short): nothing doubles.
    await app.replay(log, id);
    expect((await cooldown(app)).length).toBe(after.length);
  });

  it('stops 2 minutes after heater off when the device stays warm', async () => {
    const id = 'AA:BB:CC:00:00:02';
    const app = await launch(id);
    onScreen(app, slow);
    app.sessions.suspend();
    await app.replay(coolLog(id, 68, 60, slow), id);
    const after = await cooldown(app);
    expect(after.at(-1)!.t).toBeLessThanOrEqual(49 + 120);
    expect(after.at(-1)!.t).toBeGreaterThan(49 + 110);
  });

  it('fills the cool-down of a session already stored when Glow was killed in between', async () => {
    const id = 'AA:BB:CC:00:00:03';
    const before = await launch(id);
    onScreen(before);
    before.sessions.suspend();
    // Killed off screen; started from cold later, the recorder's log waiting.
    const app = await launch(id);
    expect(app.sessions.cooling).toBeNull();
    expect(await app.replay(coolLog(id, 68, 60, fast), id)).toBe(1);
    const after = await cooldown(app);
    expect(after.length).toBeGreaterThanOrEqual(12);
    expect(after.at(-1)!.c).toBeLessThanOrEqual(50);
    // Stored, for the next Glow.
    const again = await launch(id);
    expect((await cooldown(again)).length).toBe(after.length);
  });

  it('goes by the time alone when the recorder does not know when the heater went off', async () => {
    const id = 'AA:BB:CC:00:00:04';
    const app = await launch(id);
    onScreen(app);
    app.sessions.suspend();
    await app.replay(coolLog(id, 68, null, fast), id);
    expect((await cooldown(app)).at(-1)!.c).toBeLessThanOrEqual(50);
  });

  it('starts a new session when the heater comes back on during the cool-down', async () => {
    const id = 'AA:BB:CC:00:00:05';
    const app = await launch(id);
    onScreen(app);
    app.sessions.suspend();
    const heat = (sec: number) => (sec < 90 ? fast(sec) : sec < 150 ? Math.min(180, fast(90) + (sec - 90) * 3) : Math.max(30, 180 - (sec - 150) * 2));
    await app.replay(coolLog(id, 68, 60, heat, { heaterOn: [90, 150], until: 275 }), id);
    expect(app.sessions.list).toHaveLength(2);
    const [second, first] = app.sessions.list;
    expect(first.id).toBe(at(11));
    expect(second.id).toBe(at(90.5)); // the first report after 90 s
    expect(second.end).toBe(at(150.5));
    expect(second.background).toBe(true);
    // The first cool-down stops where the heater came back on.
    const after = await cooldown(app);
    expect(after.at(-1)!.t).toBeLessThan(90 - 11);
    expect(after.length).toBeGreaterThanOrEqual(4);
    // The second one has its own, to 50°.
    const d = (await app.sessions.detail(second.id))!;
    expect(d.c.at(-1)).toBeLessThanOrEqual(50);
  });

  it('never makes a session out of a cool-down that follows none', async () => {
    const id = 'AA:BB:CC:00:00:06';
    const app = await launch(id);
    await app.replay(coolLog(id, 68, null, fast), id);
    expect(app.sessions.list).toHaveLength(0);
    // Nor adds it to a session that ended long before.
    onScreen(app);
    app.sessions.observe(state({ currentTemp: 30 }), at(400));
    const stored = (await cooldown(app)).length;
    app.sessions.suspend();
    await app.replay(coolLog(id, 600, null, (sec) => 120 - (sec - 600)), id);
    expect(app.sessions.list).toHaveLength(1);
    expect((await cooldown(app)).length).toBe(stored);
  });
});

describe('replaying the background log without a connection', () => {
  const listeners = new Map<string, () => void>();
  const page = { visibilityState: 'visible', addEventListener: (type: string, f: () => void) => listeners.set(type, f) };

  beforeEach(() => {
    store.clear();
    bg.calls = [];
    bg.log = '';
    vi.stubGlobal('location', { search: '' });
    vi.stubGlobal('document', page);
  });
  afterEach(() => vi.unstubAllGlobals());

  /** Glow with its connection module, the remembered device's recording switched on. */
  async function withConnection(id: string) {
    bg.id = id;
    store.set('connection', JSON.stringify({ last: { id, name: 'Storz&Bickel', kind: 'crafty' }, autoConnect: true }));
    const app = await launch();
    const { conn } = await import('./connection.svelte');
    const { ble } = await import('./ble/adapter');
    // Switched off, or gone: it never connects.
    Object.assign(ble, { connect: async () => Promise.reject(new Error('out of range')), known: async () => [] });
    return { ...app, conn };
  }

  it('fills the cool-down on a cold start, with the device switched off', async () => {
    const id = 'AA:BB:CC:00:00:07';
    const before = await launch(id);
    onScreen(before);
    before.sessions.suspend();
    // Killed off screen while the recorder took the cool-down over.
    bg.log = coolLog(id, 68, 60, fast);
    const app = await withConnection(id);
    await app.conn.start();
    await vi.waitFor(() => expect(bg.calls).toEqual(['take', 'done']));
    const after = await cooldown(app);
    expect(after.length).toBeGreaterThanOrEqual(12);
    expect(after.at(-1)!.c).toBeLessThanOrEqual(50);
  });

  it('replays on screen again after the device dropped meanwhile, while it does not come back', async () => {
    const id = 'AA:BB:CC:00:00:08';
    const app = await withConnection(id);
    await app.conn.start();
    await vi.waitFor(() => expect(bg.calls).toEqual(['take', 'done']));
    // Heated with Glow on screen, off screen 5 s after heater off; the device was then switched off.
    onScreen(app);
    app.sessions.suspend();
    const internals = app.conn as unknown as { away: boolean; target: unknown; phase: string; generation: number };
    Object.assign(internals, { away: true, target: { id, name: 'Storz&Bickel', kind: 'crafty' }, phase: 'reconnecting' });
    bg.log = coolLog(id, 68, 60, fast, { end: 'lost', until: 100 });
    listeners.get('visibilitychange')!();
    try {
      await vi.waitFor(() => expect(bg.calls).toEqual(['take', 'done', 'take', 'done']));
      expect(app.conn.phase).toBe('reconnecting');
      const after = await cooldown(app);
      expect(after.at(-1)!.t).toBeGreaterThan(30);
      expect(after.at(-1)!.t).toBeLessThanOrEqual(100 - 11);
      expect(app.sessions.cooling).toBeNull();
    } finally {
      internals.generation++; // stops the reconnect loop
    }
  });
});
