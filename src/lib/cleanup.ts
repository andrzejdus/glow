import type { SessionSummary } from './sessions.svelte';
import { INDEX, type StoredFile } from './sessionStore';

// Settings › App › Session history: how much the log takes, and "Clean up…", which removes the
// sessions older than a chosen time (their charts and their rows in History). Nothing is removed
// on its own: the log is kept for good unless this is used.

/** One session on record, with what it takes: its chart and its row in the list. */
export interface StoredSession {
  id: number;
  end: number | null;
  bytes: number;
  /** Running or still recording its cool-down: never removed. */
  pinned?: boolean;
  /** A chart whose session is no longer in the list (a clean-up cut short): counted in bytes only. */
  orphan?: boolean;
}

export interface StorageReport {
  /** Everything the log takes, all devices. */
  bytes: number;
  /** Sessions in History, all devices. */
  count: number;
  sessions: StoredSession[];
}

export interface DeviceLog {
  dev: string;
  list: SessionSummary[];
}

/** The report from each device's list and the files on disk (`files`, all devices). */
export function report(logs: DeviceLog[], files: StoredFile[], pinned: Set<number>): StorageReport {
  const sizes = new Map(files.map((f) => [`${f.dev}\n${f.name}`, f.bytes]));
  const sessions: StoredSession[] = [];
  let bytes = files.reduce((a, f) => a + f.bytes, 0);
  for (const { dev, list } of logs) {
    // A list in memory but not saved yet (or not on disk at all, as in demo mode) counts at its size.
    if (!sizes.has(`${dev}\n${INDEX}`)) bytes += textBytes(list);
    for (const s of list) {
      const chart = sizes.get(`${dev}\n${s.id}`) ?? 0;
      sessions.push({ id: s.id, end: s.end, bytes: chart + textBytes(s), ...(s.end === null || pinned.has(s.id) ? { pinned: true } : {}) });
    }
    const known = new Set(list.map((s) => String(s.id)));
    for (const f of files) {
      if (f.dev === dev && f.name !== INDEX && !known.has(f.name)) sessions.push({ id: Number(f.name), end: Number(f.name), bytes: f.bytes, orphan: true });
    }
  }
  return { bytes, count: sessions.filter((s) => !s.orphan).length, sessions };
}

export const textBytes = (v: unknown) => new Blob([JSON.stringify(v)]).size;

/** Removed by a clean-up that keeps what started at `cut` or later. */
export function removable(s: { id: number; end: number | null; pinned?: boolean }, cut: number): boolean {
  return !s.pinned && s.end !== null && s.id < cut;
}

/** What a clean-up with this cut removes: sessions in History, and bytes (charts without a session too). */
export function removal(r: StorageReport, cut: number): { count: number; bytes: number } {
  let count = 0;
  let bytes = 0;
  for (const s of r.sessions) {
    if (!removable(s, cut)) continue;
    if (!s.orphan) count++;
    bytes += s.bytes;
  }
  return { count, bytes };
}

export interface Stop {
  label: string;
  days?: number;
  months?: number;
}

const STOPS: Stop[] = [
  { label: '1 week', days: 7 },
  { label: '1 month', months: 1 },
  { label: '3 months', months: 3 },
  { label: '6 months', months: 6 },
  { label: '1 year', months: 12 },
];
const TWO_YEARS: Stop = { label: '2 years', months: 24 };

/** The start of what a stop keeps: that long before `now`, by the calendar. */
export function cutOf(stop: Stop, now: number): number {
  const d = new Date(now);
  if (stop.days) d.setDate(d.getDate() - stop.days);
  if (stop.months) d.setMonth(d.getMonth() - stop.months);
  return d.getTime();
}

/** The slider's stops: 2 years only once the log goes back further than a year. */
export function stopsFor(r: StorageReport, now: number): Stop[] {
  const oldest = Math.min(...r.sessions.filter((s) => !s.orphan).map((s) => s.id));
  return oldest < cutOf(STOPS[STOPS.length - 1], now) ? [...STOPS, TWO_YEARS] : STOPS;
}

/** Where the slider opens: the longest stop that removes something; -1 when none does. */
export function firstStop(r: StorageReport, stops: Stop[], now: number): number {
  for (let i = stops.length - 1; i >= 0; i--) if (removal(r, cutOf(stops[i], now)).count) return i;
  return -1;
}
