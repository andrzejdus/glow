import type { DeviceState, HeatMode } from './devices/types';
import { load, save } from './prefs';

// The session log: one session from heater on to heater off, seen while Glow is connected.
// Kept for good. Each device has an index of summaries (small, loaded on connect) and one
// record per session with its temperature samples and events (loaded when it is opened).

/** Something that happened in a session, at `t` seconds from its start. */
export type SessionEvent =
  | { t: number; k: 'ready' }
  | { t: number; k: 'mode'; v: HeatMode }
  | { t: number; k: 'target'; v: number }
  | { t: number; k: 'air'; v: boolean }
  | { t: number; k: 'lost' }
  | { t: number; k: 'back' };

export interface SessionSummary {
  /** Start, epoch ms; also the session's id. */
  id: number;
  /** End, epoch ms; null while it runs. */
  end: number | null;
  /** The last time Glow saw the device during it. */
  seen: number;
  /** The heater was already on when Glow connected, so the start is when Glow saw it. */
  joined: boolean;
  /** Seconds from the start to Ready. */
  readySec: number | null;
  /** The goal (target plus any boost) when it got ready, or the last one. */
  target: number | null;
  peak: number | null;
  /** Seconds spent in each heat level. */
  modes: Partial<Record<HeatMode, number>>;
  airSec?: number;
  batteryStart?: number;
  batteryEnd?: number;
  /** The device reports a live temperature (CRAFTY, VOLCANO), not only the target. */
  live: boolean;
  /** A few points of the temperature (or the goal, without a live one) for the timeline. */
  spark: number[];
}

export interface SessionDetail {
  /** Seconds from the start. */
  ts: number[];
  /** Live temperature, null when there is none. */
  c: (number | null)[];
  /** Goal: target plus the boost in use. */
  g: number[];
  events: SessionEvent[];
}

const SAMPLE_MS = 5000;
/** Back within this long with the heater still on, and it is the same session. */
const RESUME_MS = 10 * 60_000;
const SPARK = 24;

/** What the device heats to: the target plus the active boost, capped at its maximum. */
export function goalOf(d: DeviceState): number | undefined {
  const offset = d.mode === 'boost' ? d.boostOffset ?? 0 : d.mode === 'superboost' ? d.superBoostOffset ?? 0 : 0;
  return d.targetTemp === undefined ? undefined : Math.min(d.maxTemp, d.targetTemp + offset);
}

/** The device's own flag wins (it is what drives the CRAFTY+ LED); otherwise compare temperatures. */
export function isReady(d: DeviceState): boolean {
  const goal = goalOf(d);
  const diff = goal !== undefined && d.currentTemp !== undefined ? goal - d.currentTemp : undefined;
  return d.heaterOn && (d.tempReached ?? (diff !== undefined && Math.abs(diff) < 1));
}

export function spark(detail: SessionDetail, live: boolean): number[] {
  const values = detail.ts.map((_, i) => (live ? detail.c[i] : null) ?? detail.g[i]);
  if (values.length <= SPARK) return values;
  return Array.from({ length: SPARK }, (_, i) => values[Math.round((i * (values.length - 1)) / (SPARK - 1))]);
}

class Sessions {
  list = $state.raw<SessionSummary[]>([]);
  /** The running session's summary and samples, while there is one. */
  active = $state.raw<SessionSummary | null>(null);
  activeDetail = $state.raw<SessionDetail | null>(null);

  private key = '';
  private persist = true;
  private last: DeviceState | null = null;
  private lastTick = 0;
  private lastSample = 0;
  private wasReady = false;
  private mode: HeatMode = 'normal';
  private target: number | undefined;
  private pendingTarget: { v: number; at: number } | null = null;
  private air = false;
  private saveTimer: ReturnType<typeof setTimeout> | undefined;
  private sampler: ReturnType<typeof setInterval> | undefined;
  private details = new Map<number, SessionDetail>();

  /** Demo mode passes made-up sessions, which are never saved. */
  async bind(key: string, seed?: { list: SessionSummary[]; details: Map<number, SessionDetail> }) {
    if (key === this.key) return;
    this.flush();
    this.key = key;
    this.persist = !seed;
    this.active = null;
    this.activeDetail = null;
    this.last = null;
    this.details = seed?.details ?? new Map();
    this.list = seed?.list ?? (await load<SessionSummary[]>(`sessions:${key}`, []));
  }

  async detail(id: number): Promise<SessionDetail | null> {
    if (this.active?.id === id) return this.activeDetail;
    const known = this.details.get(id);
    if (known) return known;
    const found = await load<SessionDetail | null>(`session:${this.key}:${id}`, null);
    if (found) this.details.set(id, found);
    return found;
  }

  observe(d: DeviceState, now = Date.now()) {
    const first = this.last === null;
    this.last = d;
    if (first) this.closeStale(d, now);
    if (d.heaterOn && !this.active) this.begin(d, now, first);
    else if (!d.heaterOn && this.active) this.finish(now);
    if (this.active) this.track(d, now);
  }

  /** The connection dropped: the session stays open until the device is back. */
  lost(now = Date.now()) {
    if (!this.active || !this.activeDetail) return;
    this.event({ t: this.sec(now), k: 'lost' });
    this.last = null;
    this.flush();
  }

  private sec(now: number) {
    return Math.max(0, Math.round((now - (this.active?.id ?? now)) / 1000));
  }

  /** On the first report after connecting: carry on with an open session, or close it. */
  private closeStale(d: DeviceState, now: number) {
    const open = this.list.find((s) => s.end === null);
    if (!open) return;
    if (d.heaterOn && now - open.seen < RESUME_MS) {
      void this.resume(open, now);
      return;
    }
    // The heater went off while Glow was away: it ended about when Glow last saw it.
    if (this.active?.id === open.id) {
      clearInterval(this.sampler);
      this.flush();
      this.details.set(open.id, this.activeDetail!);
      this.active = null;
      this.activeDetail = null;
    }
    const latest = this.list.find((s) => s.id === open.id)!;
    const detail = this.details.get(open.id);
    this.replace({ ...latest, end: latest.seen, spark: detail ? spark(detail, latest.live) : latest.spark });
    this.save();
  }

  private async resume(open: SessionSummary, now: number) {
    const detail = (await this.detail(open.id)) ?? { ts: [], c: [], g: [], events: [] };
    this.active = open;
    this.activeDetail = detail;
    this.wasReady = open.readySec !== null;
    this.target = this.last?.targetTemp;
    this.mode = this.last?.mode ?? 'normal';
    this.lastTick = now;
    this.event({ t: this.sec(now), k: 'back' });
    this.startSampler();
  }

  private begin(d: DeviceState, now: number, joined: boolean) {
    // A resume in flight claims the open session; do not start a second one meanwhile.
    if (this.list.some((s) => s.end === null)) return;
    const s: SessionSummary = {
      id: now,
      end: null,
      seen: now,
      joined,
      readySec: null,
      target: goalOf(d) ?? null,
      peak: d.currentTemp ?? null,
      modes: {},
      batteryStart: d.battery,
      live: d.currentTemp !== undefined,
      spark: [],
    };
    this.active = s;
    this.activeDetail = { ts: [], c: [], g: [], events: [] };
    this.wasReady = false;
    this.mode = d.mode;
    this.target = d.targetTemp;
    this.air = !!d.pumpOn;
    this.pendingTarget = null;
    this.lastTick = now;
    this.lastSample = 0;
    if (d.mode !== 'normal') this.event({ t: 0, k: 'mode', v: d.mode });
    this.list = [s, ...this.list];
    this.startSampler();
  }

  private track(d: DeviceState, now: number) {
    const s = this.active!;
    const t = this.sec(now);
    const dt = this.lastTick ? Math.min(30, (now - this.lastTick) / 1000) : 0;
    this.lastTick = now;
    const modes = { ...s.modes, [this.mode]: (s.modes[this.mode] ?? 0) + dt };
    const airSec = this.air ? (s.airSec ?? 0) + dt : s.airSec;
    if (d.mode !== this.mode) {
      this.mode = d.mode;
      this.event({ t, k: 'mode', v: d.mode });
    }
    // A target set with + and - comes in steps: log where it settles.
    const goal = goalOf(d);
    if (d.targetTemp !== undefined && d.targetTemp !== this.target) {
      this.target = d.targetTemp;
      this.pendingTarget = { v: d.targetTemp, at: now };
    }
    if (this.pendingTarget && now - this.pendingTarget.at >= 3000) {
      this.event({ t: Math.round((this.pendingTarget.at - s.id) / 1000), k: 'target', v: this.pendingTarget.v });
      this.pendingTarget = null;
    }
    if (!!d.pumpOn !== this.air) {
      this.air = !!d.pumpOn;
      this.event({ t, k: 'air', v: this.air });
    }
    const ready = isReady(d);
    let readySec = s.readySec;
    let target = s.target;
    if (ready && !this.wasReady && readySec === null) {
      readySec = t;
      target = goal ?? target;
      this.event({ t, k: 'ready' });
    } else if (readySec === null) {
      target = goal ?? target;
    }
    this.wasReady = ready;
    const peak = d.currentTemp === undefined ? s.peak : Math.max(s.peak ?? -Infinity, d.currentTemp);
    this.active = {
      ...s,
      seen: now,
      modes,
      airSec,
      readySec,
      target,
      peak,
      batteryEnd: d.battery ?? s.batteryEnd,
      live: s.live || d.currentTemp !== undefined,
    };
    if (now - this.lastSample >= SAMPLE_MS) this.sample(d, now);
    this.replace(this.active);
  }

  private sample(d: DeviceState, now: number) {
    const detail = this.activeDetail;
    const goal = goalOf(d);
    if (!detail || goal === undefined) return;
    this.lastSample = now;
    this.activeDetail = {
      ...detail,
      ts: [...detail.ts, this.sec(now)],
      c: [...detail.c, d.currentTemp === undefined ? null : Math.round(d.currentTemp * 2) / 2],
      g: [...detail.g, goal],
    };
    this.scheduleSave();
  }

  /** Samples keep coming while the device sends nothing new (a VENTY reports on change only). */
  private startSampler() {
    clearInterval(this.sampler);
    this.sampler = setInterval(() => {
      if (this.active && this.last?.heaterOn) this.track(this.last, Date.now());
    }, SAMPLE_MS);
  }

  private finish(now: number) {
    const s = this.active!;
    // The last stretch, counted in the level it ran in: a device drops back to Base as it turns off.
    this.track({ ...this.last!, heaterOn: true, mode: this.mode, targetTemp: this.target }, now);
    clearInterval(this.sampler);
    this.active = { ...this.active!, end: now, spark: spark(this.activeDetail!, s.live) };
    this.flush();
    this.active = null;
    this.activeDetail = null;
  }

  private event(e: SessionEvent) {
    if (!this.activeDetail) return;
    this.activeDetail = { ...this.activeDetail, events: [...this.activeDetail.events, e] };
  }

  private replace(s: SessionSummary) {
    this.list = this.list.map((x) => (x.id === s.id ? s : x));
  }

  private scheduleSave() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.flush(), 15000);
  }

  private flush() {
    clearTimeout(this.saveTimer);
    if (this.active && this.activeDetail) {
      const s = { ...this.active, spark: spark(this.activeDetail, this.active.live) };
      this.replace(s);
      this.details.set(s.id, this.activeDetail);
      if (this.persist && this.key) save(`session:${this.key}:${s.id}`, this.activeDetail);
    }
    this.save();
  }

  private save() {
    if (this.persist && this.key) save(`sessions:${this.key}`, this.list);
  }
}

/** Made-up sessions for demo mode only, the newest first. */
export function demoSessions(live: boolean, battery: boolean, now = Date.now()) {
  const list: SessionSummary[] = [];
  const details = new Map<number, SessionDetail>();
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const day = 86_400_000;
  for (let back = 1; back <= 24; back++) {
    const count = rnd() < 0.25 ? 0 : rnd() < 0.6 ? 1 : 2;
    for (let n = 0; n < count; n++) {
      const start = now - back * day + (n ? -3 : 2) * 3_600_000 + Math.round(rnd() * 3_600_000);
      const base = [175, 180, 185, 190, 195][Math.floor(rnd() * 5)];
      const length = Math.round(240 + rnd() * 420);
      const boostAt = rnd() < 0.5 ? Math.round(length * (0.4 + rnd() * 0.3)) : null;
      const detail: SessionDetail = { ts: [], c: [], g: [], events: [] };
      let c = 24 + rnd() * 10;
      let readySec: number | null = null;
      let peak = c;
      for (let t = 0; t <= length; t += 5) {
        const g = boostAt !== null && t >= boostAt ? base + 10 : base;
        c += (g - c) * (c < g ? 0.09 : 0.25) + (c < g ? 0.4 : 0) - (readySec !== null && rnd() < 0.08 ? 6 + rnd() * 6 : 0);
        peak = Math.max(peak, c);
        if (readySec === null && g - c < 1) {
          readySec = t;
          detail.events.push({ t, k: 'ready' });
        }
        if (boostAt !== null && t === Math.ceil(boostAt / 5) * 5) detail.events.push({ t, k: 'mode', v: 'boost' });
        detail.ts.push(t);
        detail.c.push(live ? Math.round(c * 2) / 2 : null);
        detail.g.push(g);
      }
      const boostSec = boostAt === null ? 0 : length - boostAt;
      const s: SessionSummary = {
        id: start,
        end: start + length * 1000,
        seen: start + length * 1000,
        joined: false,
        readySec,
        target: base,
        peak: live ? Math.round(peak * 2) / 2 : null,
        modes: { normal: length - boostSec, ...(boostSec ? { boost: boostSec } : {}) },
        live,
        spark: spark(detail, live),
      };
      if (battery) {
        s.batteryStart = 90 - Math.round(rnd() * 30);
        s.batteryEnd = s.batteryStart - Math.round((length / 60) * (1.4 + rnd()));
      }
      list.push(s);
      details.set(start, detail);
    }
  }
  list.sort((a, b) => b.id - a.id);
  return { list, details };
}

export const sessions = new Sessions();
