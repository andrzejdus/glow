import type { DeviceState } from './devices/types';
import { locale } from './locale.svelte';
import { load, save } from './prefs';

// Hours of operation. The device only reports its lifetime total, so Glow keeps
// a snapshot of it every time it is connected (one per hour at most) and works
// out the monthly usage from those snapshots.

export interface Snap {
  /** epoch ms */
  t: number;
  /** operating minutes */
  m: number;
}

export interface UsageBar {
  label: string;
  hours: number | null;
  current: boolean;
}

/** Set by tests; the app uses the phone's own and the week start chosen in Settings. */
export interface BarOptions {
  /** Language for month names. */
  locales?: Intl.LocalesArgument;
  /** 0 for Sunday to 6 for Saturday. */
  firstDayOfWeek?: number;
}

const HOUR = 3_600_000;
const KEEP = 400 * 24 * HOUR;
/** Minutes a reading may run back, or ahead of the clock, before it is taken as wrong: rounding at both ends. */
const BACK = 1;
const AHEAD = 2;
/** Readings in a row that agree with each other, though not with the last one, before they are believed. */
const RUN = 3;

/**
 * Whether the device's counter can have gone from `a` to `b`: it never runs back, and counts at most
 * one minute a minute. A read answered with another register's value (docs/protocol/crafty.md,
 * "Reads answered out of turn") once showed 57466 hours on a CRAFTY+ with 877.
 */
export function plausible(a: Snap, b: Snap): boolean {
  return b.m >= a.m - BACK && b.m <= a.m + Math.max(0, b.t - a.t) / 60_000 + AHEAD;
}

/**
 * The stored history without the readings the counter cannot have shown: a spike up or a dip that
 * the next readings (up to RUN of them) come back from, a first reading that the ones after it
 * disagree with while they agree, and a last few that nothing confirms. A longer run that agrees with itself is the
 * counter's own and stays.
 */
export function repair(snaps: Snap[]): Snap[] {
  // A first reading is wrong when it disagrees with each of the next ones while they agree.
  const oddFirst = (i: number) => {
    const next = snaps.slice(i + 1, i + 1 + RUN);
    return next.length >= 2 && next.every((s, k) => !plausible(snaps[i], s) && (k === 0 || plausible(next[k - 1], s)));
  };
  let from = 0;
  while (oddFirst(from)) from++;
  const out: Snap[] = [];
  for (let i = from; i < snaps.length; i++) {
    const prev = out[out.length - 1];
    if (!prev || plausible(prev, snaps[i])) {
      out.push(snaps[i]);
      continue;
    }
    let j = i + 1;
    while (j < snaps.length && j - i <= RUN && !plausible(prev, snaps[j])) j++;
    if (j < snaps.length && j - i <= RUN) i = j - 1;
    else if (j === snaps.length && j - i <= RUN) break;
    else out.push(snaps[i]);
  }
  return out.length === snaps.length ? snaps : out;
}

class Usage {
  now = $state(Date.now());
  snaps = $state.raw<Snap[]>([]);
  /** The latest device reading and when it arrived. */
  reading = $state<{ m: number; t: number } | null>(null);
  heating = $state(false);
  sessionStart = $state<number | null>(null);
  lastSessionSec = $state(0);
  /** Measured heating rate, °C per second. */
  rate = $state(0);

  private key = '';
  private shown = 0;
  /** Readings in a row that were not believed, while they agree with each other. */
  private doubt: Snap[] = [];
  private lastTemp: { t: number; c: number } | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    setInterval(() => (this.now = Date.now()), 1000);
  }

  /** Bound to the same key again (a replay and a connection at once), it waits for the first load. */
  bind(key: string, seed?: Snap[]): Promise<void> {
    if (key !== this.key) this.binding = this.open(key, seed);
    return this.binding;
  }

  private binding: Promise<void> = Promise.resolve();

  private async open(key: string, seed?: Snap[]) {
    this.key = key;
    this.shown = 0;
    this.reading = null;
    this.doubt = [];
    this.snaps = repair(seed ?? (await load<Snap[]>(`usage:${key}`, [])));
  }

  /**
   * Whether a new reading can be right, against the last one (this connection's, else the stored
   * history's). A counter that really moved on its own (a reset, say) reads alike from then on:
   * RUN readings in a row that agree with each other are believed.
   */
  private believe(m: number, t: number): boolean {
    const last = this.reading ?? this.snaps[this.snaps.length - 1];
    if (!last || plausible(last, { m, t })) {
      this.doubt = [];
      return true;
    }
    const prev = this.doubt[this.doubt.length - 1];
    // The same reading again: the driver's state, not a new read.
    if (prev?.m === m) return false;
    this.doubt = prev && plausible(prev, { m, t }) ? [...this.doubt, { m, t }] : [{ m, t }];
    if (this.doubt.length >= RUN) {
      this.doubt = [];
      return true;
    }
    console.warn(`Glow: hours of operation ignored: ${m} min after ${last.m} min`);
    return false;
  }

  observe(d: DeviceState, now = Date.now()) {
    if (d.operatingMinutes !== undefined && d.operatingMinutes !== this.reading?.m && this.believe(d.operatingMinutes, now)) {
      this.reading = { m: d.operatingMinutes, t: now };
      this.record(d.operatingMinutes, now);
    }
    if (d.heaterOn && !this.heating) {
      this.sessionStart = now;
      this.rate = 0;
    } else if (!d.heaterOn && this.heating && this.sessionStart) {
      this.lastSessionSec = (now - this.sessionStart) / 1000;
      this.sessionStart = null;
    }
    this.heating = d.heaterOn;
    if (d.currentTemp !== undefined) {
      if (this.lastTemp && now - this.lastTemp.t >= 900) {
        const r = (d.currentTemp - this.lastTemp.c) / ((now - this.lastTemp.t) / 1000);
        this.rate = this.rate === 0 ? r : this.rate * 0.7 + r * 0.3;
        this.lastTemp = { t: now, c: d.currentTemp };
      } else if (!this.lastTemp) {
        this.lastTemp = { t: now, c: d.currentTemp };
      }
    }
  }

  /** Lifetime seconds, counting on between device readings while the heater runs. */
  lifetimeSec(now = this.now): number | null {
    if (!this.reading) return null;
    // The device counts whole minutes of heating. Between its ticks, add the seconds heated since
    // the last tick, counted from when the heater came on if that was later, and never a full minute.
    const since = Math.max(this.reading.t, this.sessionStart ?? now);
    const extra = this.heating ? Math.max(0, now - since) / 1000 : 0;
    const value = this.reading.m * 60 + Math.min(extra, 59);
    this.shown = Math.max(this.shown, value);
    return this.shown;
  }

  sessionSec(now = this.now): number {
    return this.sessionStart ? (now - this.sessionStart) / 1000 : this.lastSessionSec;
  }

  /** Seconds until the target is reached, from the measured heating rate. */
  etaSec(current?: number, target?: number): number | null {
    if (current === undefined || target === undefined || !this.heating) return null;
    const left = target - current;
    if (left <= 0.5) return 0;
    if (this.rate < 0.05) return null;
    return Math.ceil(left / this.rate);
  }

  /** Usage per calendar month, oldest first, the current month last. */
  months(count = 8, now = this.now, opts: BarOptions = {}): UsageBar[] {
    return this.bars('month', count, now, opts);
  }

  /**
   * Usage per day, week or calendar month, oldest first, the current one last. Weeks start on the
   * day chosen in Settings › App, else the phone's first day of the week. Every bar is worked out from the snapshots when it is drawn, so
   * a different week start regroups the whole history at once; nothing stored depends on it.
   */
  bars(
    unit: 'day' | 'week' | 'month',
    count: number,
    now = this.now,
    { locales, firstDayOfWeek = locale.weekStart }: BarOptions = {},
  ): UsageBar[] {
    const live = this.lifetimeSec(now);
    const today = new Date(now);
    const y = today.getFullYear();
    const mo = today.getMonth();
    const weekStart = today.getDate() - ((today.getDay() - firstDayOfWeek + 7) % 7);
    const bars: UsageBar[] = [];
    for (let i = count - 1; i >= 0; i--) {
      const start =
        unit === 'month' ? new Date(y, mo - i, 1) : unit === 'week' ? new Date(y, mo, weekStart - 7 * i) : new Date(y, mo, today.getDate() - i);
      const next =
        unit === 'month' ? new Date(y, mo - i + 1, 1) : unit === 'week' ? new Date(y, mo, weekStart - 7 * i + 7) : new Date(y, mo, today.getDate() - i + 1);
      const from = start.getTime();
      const to = next.getTime();
      const current = i === 0;
      const end = current && live !== null ? live / 60 : this.at(to);
      const begin = this.at(from) ?? this.snaps.find((s) => s.t >= from && s.t < to)?.m;
      const hours = end === undefined || begin === undefined ? null : Math.max(0, end - begin) / 60;
      // Month names and the day-month order follow the phone's language.
      const label =
        unit === 'month'
          ? start.toLocaleString(locales, { month: 'short' })
          : unit === 'week'
            ? start.toLocaleString(locales, { month: 'short', day: 'numeric' })
            : String(start.getDate());
      bars.push({ label, hours, current });
    }
    return bars;
  }

  /** Hours on the device's own counter since `from`, as far as Glow has seen it. */
  hoursSince(from: number, now = this.now): number | null {
    const live = this.lifetimeSec(now);
    const begin = this.at(from) ?? this.snaps.find((s) => s.t >= from)?.m;
    return live === null || begin === undefined ? null : Math.max(0, live / 60 - begin) / 60;
  }

  private at(t: number): number | undefined {
    let m: number | undefined;
    for (const s of this.snaps) {
      if (s.t > t) break;
      m = s.m;
    }
    return m;
  }

  private record(m: number, t: number) {
    const snaps = this.snaps.filter((s) => s.t > t - KEEP);
    // Keep the first and the latest reading of each hour: the first one is where a month's
    // count starts when Glow was first connected in the middle of it.
    const hour = (x: Snap | undefined) => (x ? Math.floor(x.t / HOUR) : -1);
    const last = snaps[snaps.length - 1];
    const before = snaps[snaps.length - 2];
    if (hour(last) === Math.floor(t / HOUR) && hour(before) === hour(last)) snaps[snaps.length - 1] = { t, m };
    else snaps.push({ t, m });
    this.snaps = snaps;
    clearTimeout(this.saveTimer);
    const key = this.key;
    this.saveTimer = setTimeout(() => key && save(`usage:${key}`, this.snaps), 2000);
  }
}

/** Made-up history for demo mode only: hours per month before the made-up sessions (or this month). */
export function demoHistory(minutesNow: number, sessions: { id: number; end: number | null }[] = []): Snap[] {
  const monthly = [6.1, 8.4, 7.2, 10.5, 9.1, 11.3, 8.8];
  const snaps: Snap[] = [];
  // The sessions, newest first, counted back from the reading now; then the months before them.
  let m = sessions.length ? minutesNow : minutesNow - 4.2 * 60;
  for (const s of sessions) {
    if (s.end === null) continue;
    snaps.push({ t: s.end, m });
    m -= (s.end - s.id) / 60_000;
    snaps.push({ t: s.id, m });
  }
  const anchor = new Date(sessions.length ? sessions[sessions.length - 1].id : Date.now());
  if (sessions.length) m -= 90;
  snaps.push({ t: new Date(anchor.getFullYear(), anchor.getMonth(), 1).getTime() - 60_000, m });
  for (let i = monthly.length - 1; i >= 0; i--) {
    m -= monthly[i] * 60;
    snaps.push({ t: new Date(anchor.getFullYear(), anchor.getMonth() - monthly.length + i, 1).getTime() - 60_000, m });
  }
  return snaps.sort((a, b) => a.t - b.t);
}

export const usage = new Usage();
