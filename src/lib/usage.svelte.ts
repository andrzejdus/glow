import type { DeviceState } from './devices/types';
import { load, save } from './prefs';

// Hours of operation. The device only reports its lifetime total, so Glow keeps
// a snapshot of it every time it is connected (one per hour at most) and works
// out the monthly usage from those snapshots.

interface Snap {
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

const HOUR = 3_600_000;
const KEEP = 400 * 24 * HOUR;

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
  private lastTemp: { t: number; c: number } | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    setInterval(() => (this.now = Date.now()), 1000);
  }

  async bind(key: string, seed?: Snap[]) {
    if (key === this.key) return;
    this.key = key;
    this.shown = 0;
    this.reading = null;
    this.snaps = seed ?? (await load<Snap[]>(`usage:${key}`, []));
  }

  observe(d: DeviceState, now = Date.now()) {
    if (d.operatingMinutes !== undefined && d.operatingMinutes !== this.reading?.m) {
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
  months(count = 8, now = this.now): UsageBar[] {
    return this.bars('month', count, now);
  }

  /** Usage per day, week (from Monday) or calendar month, oldest first, the current one last. */
  bars(unit: 'day' | 'week' | 'month', count: number, now = this.now): UsageBar[] {
    const live = this.lifetimeSec(now);
    const today = new Date(now);
    const y = today.getFullYear();
    const mo = today.getMonth();
    const monday = today.getDate() - ((today.getDay() + 6) % 7);
    const bars: UsageBar[] = [];
    for (let i = count - 1; i >= 0; i--) {
      const start =
        unit === 'month' ? new Date(y, mo - i, 1) : unit === 'week' ? new Date(y, mo, monday - 7 * i) : new Date(y, mo, today.getDate() - i);
      const next =
        unit === 'month' ? new Date(y, mo - i + 1, 1) : unit === 'week' ? new Date(y, mo, monday - 7 * i + 7) : new Date(y, mo, today.getDate() - i + 1);
      const from = start.getTime();
      const to = next.getTime();
      const current = i === 0;
      const end = current && live !== null ? live / 60 : this.at(to);
      const begin = this.at(from) ?? this.snaps.find((s) => s.t >= from && s.t < to)?.m;
      const hours = end === undefined || begin === undefined ? null : Math.max(0, end - begin) / 60;
      const label =
        unit === 'month'
          ? start.toLocaleString('en', { month: 'short' })
          : unit === 'week'
            ? start.toLocaleString('en', { month: 'short', day: 'numeric' })
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
