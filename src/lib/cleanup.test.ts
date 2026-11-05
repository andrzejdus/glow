import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cutOf, firstStop, removal, report, stopsFor, type StorageReport } from './cleanup';
import type { DeviceState } from './devices/types';
import { fileStore, type SessionStore } from './sessionStore';
import { fakeFiles, fakeLegacy } from './sessionStore.fake';
import type { SessionDetail, SessionSummary } from './sessions.svelte';

// Settings › Session history: the size of the log and the clean-up, over the files store as on
// Android, starting from a log an older Glow left in Preferences.
const d = vi.hoisted(() => ({ files: new Map<string, string>(), prefs: new Map<string, string>(), life: Infinity }));
// A new store for each launch, as a restarted Glow makes one (and moves what is left in Preferences).
const current = vi.hoisted(() => ({ store: null as SessionStore | null }));
vi.mock('./sessionStore', async (original) => {
  const m = await original<typeof import('./sessionStore')>();
  return { ...m, sessionStore: new Proxy({}, { get: (_, k) => current.store![k as keyof SessionStore] }) };
});

const DAY = 86_400_000;
const NOW = new Date(2026, 10, 5, 12, 0, 0).getTime();
const A = 'C0:FF:EE:00:00:0A';
const B = 'C0:FF:EE:00:00:0B';

const summary = (id: number, end: number | null = id + 300_000): SessionSummary => ({
  id, end, seen: end ?? id, joined: false, readySec: 60, target: 190, peak: 191, modes: { normal: 300 }, live: true, spark: [180, 190], sparkOn: [0, 1],
});
const detail = (): SessionDetail => ({ ts: [0, 5, 10], c: [24, 120, 190], g: [190, 190, 190], events: [] });

const state = (patch: Partial<DeviceState>): DeviceState => ({
  kind: 'crafty', model: 'CRAFTY+', minTemp: 40, maxTemp: 210, mode: 'normal', heaterOn: false, targetTemp: 180, settings: {}, ...patch,
});

/** Sessions `daysAgo` before NOW, the newest first, as an older Glow kept them in Preferences. */
function oldLog(dev: string, daysAgo: number[]) {
  const ids = daysAgo.map((n) => NOW - n * DAY);
  d.prefs.set(`sessions:${dev}`, JSON.stringify(ids.map((id) => summary(id))));
  for (const id of ids) d.prefs.set(`session:${dev}:${id}`, JSON.stringify(detail()));
  return ids;
}

async function launch() {
  vi.resetModules();
  current.store = fileStore(fakeFiles(d), fakeLegacy(d));
  return (await import('./sessions.svelte')).sessions;
}

describe('clean-up choices', () => {
  const stored = (daysAgo: number[], extra: Partial<StorageReport> = {}): StorageReport => ({
    bytes: 0,
    count: daysAgo.length,
    sessions: daysAgo.map((n) => ({ id: NOW - n * DAY, end: NOW - n * DAY + 1000, bytes: 1000 })),
    ...extra,
  });

  it('counts by the calendar', () => {
    expect(new Date(cutOf({ label: '', months: 1 }, NOW)).getMonth()).toBe(9);
    expect(new Date(cutOf({ label: '', months: 12 }, NOW)).getFullYear()).toBe(2025);
    expect(cutOf({ label: '', days: 7 }, NOW)).toBe(NOW - 7 * DAY);
  });

  it('offers 2 years only once the log goes back more than a year', () => {
    expect(stopsFor(stored([1, 200]), NOW).map((s) => s.label)).toEqual(['1 week', '1 month', '3 months', '6 months', '1 year']);
    expect(stopsFor(stored([1, 400]), NOW).map((s) => s.label)).toContain('2 years');
  });

  it('opens on the longest stop that removes something, or none', () => {
    const stops = stopsFor(stored([1, 50, 100]), NOW);
    expect(stops[firstStop(stored([1, 50, 100]), stops, NOW)].label).toBe('3 months');
    expect(firstStop(stored([1, 3]), stops, NOW)).toBe(-1);
    expect(firstStop(stored([]), stops, NOW)).toBe(-1);
  });

  it('never removes a running or pinned session, and counts charts without a row by size only', () => {
    const r = stored([10, 20], {
      sessions: [
        { id: NOW - 30 * DAY, end: null, bytes: 5 },
        { id: NOW - 40 * DAY, end: NOW, bytes: 7, pinned: true },
        { id: NOW - 50 * DAY, end: NOW - 50 * DAY, bytes: 11, orphan: true },
        { id: NOW - 60 * DAY, end: NOW - 60 * DAY, bytes: 13 },
        { id: NOW - 1 * DAY, end: NOW - 1 * DAY, bytes: 17 },
      ],
    });
    expect(removal(r, NOW - 7 * DAY)).toEqual({ count: 1, bytes: 24 });
  });

  it('adds up the files, and a list not saved yet at its size', () => {
    const list = [summary(1), summary(2)];
    const r = report([{ dev: A, list }], [{ dev: A, name: '1', bytes: 100 }, { dev: A, name: '9', bytes: 50 }], new Set([2]));
    expect(r.count).toBe(2);
    expect(r.bytes).toBe(150 + new Blob([JSON.stringify(list)]).size);
    expect(r.sessions.find((s) => s.id === 2)?.pinned).toBe(true);
    expect(r.sessions.find((s) => s.id === 9)?.orphan).toBe(true);
  });
});

describe('session history clean-up', () => {
  beforeEach(() => {
    d.files.clear();
    d.prefs.clear();
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  it('moves an old log to files on start and reads it from there', async () => {
    const ids = oldLog(A, [1, 2]);
    d.prefs.set(`reheats:${A}`, '[]');
    const sessions = await launch();
    await sessions.bind(A);
    expect(sessions.list.map((s) => s.id)).toEqual(ids);
    expect(await sessions.detail(ids[1])).toEqual(detail());
    expect([...d.prefs.keys()]).toEqual([`reheats:${A}`]);
  });

  it('reports the size of every device and removes what is older than the cut, on every device', async () => {
    const a = oldLog(A, [1, 10, 40, 100]);
    const b = oldLog(B, [5, 200]);
    d.prefs.set(`usage:${A}`, '[{"t":1}]');
    const sessions = await launch();
    await sessions.bind(A);
    const r = await sessions.storage();
    expect(r.count).toBe(6);
    expect(r.bytes).toBe([...d.files.values()].reduce((n, v) => n + new Blob([v]).size, 0));

    await sessions.prune(NOW - 30 * DAY);
    expect(sessions.list.map((s) => s.id)).toEqual(a.slice(0, 2));
    expect(await sessions.detail(a[2])).toBeNull();
    expect((await sessions.storage()).count).toBe(3);
    // The other device's list and charts, as a fresh Glow finds them.
    const fresh = await launch();
    await fresh.bind(B);
    expect(fresh.list.map((s) => s.id)).toEqual([b[0]]);
    expect(await fresh.detail(b[1])).toBeNull();
    // Hours of operation are kept apart and stay.
    expect(d.prefs.get(`usage:${A}`)).toBe('[{"t":1}]');
  });

  it('keeps the running session and anything newer than the cut', async () => {
    const sessions = await launch();
    await sessions.bind(A);
    const old = oldLog(A, [60]);
    // Bound again from storage, with a session running that started before the cut.
    const again = await launch();
    await again.bind(A);
    vi.setSystemTime(NOW - 40 * DAY);
    again.observe(state({ heaterOn: true, currentTemp: 100 }));
    vi.setSystemTime(NOW);
    again.observe(state({ heaterOn: true, currentTemp: 150 }));
    await again.prune(NOW - 7 * DAY);
    expect(again.list.map((s) => s.id)).toEqual([NOW - 40 * DAY]);
    expect(again.active?.id).toBe(NOW - 40 * DAY);
    expect(await again.detail(old[0])).toBeNull();
  });

  it('removes from demo mode in memory only', async () => {
    const sessions = await launch();
    const { demoSessions } = await import('./sessions.svelte');
    const demo = demoSessions(true, true, NOW);
    await sessions.bind('demo', demo);
    const before = sessions.list.length;
    const r = await sessions.storage();
    expect(r.count).toBe(before);
    expect(r.bytes).toBeGreaterThan(before * 500);
    await sessions.prune(NOW - 7 * DAY);
    expect(sessions.list.length).toBeLessThan(before);
    expect(sessions.list.every((s) => s.id >= NOW - 7 * DAY)).toBe(true);
    expect(d.files.size).toBe(0);
  });
});
