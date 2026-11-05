import type { DeviceState, HeatMode } from './devices/types';
import { removable, report, type DeviceLog, type StorageReport } from './cleanup';
import { INDEX, sessionStore, type StoredFile } from './sessionStore';

// The session log: one session from heater on to heater off, seen while Glow is connected, or
// replayed from what the background recorder logged while it was closed (replay.ts). Kept for good,
// unless removed with Clean up in Settings. Each device has an index of summaries (small, loaded on
// connect) and one record per session with its temperature samples and events (loaded when it is
// opened); sessionStore.ts keeps them.

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
  /**
   * The remaining capacity the device counts (CRAFTY 0153), mAh, at the start and at the last
   * reading, the cool-down included: to compare with the current Glow adds up itself.
   */
  capStart?: number;
  capEnd?: number;
  /** The device reports a live temperature (CRAFTY, VOLCANO), not only the target. */
  live: boolean;
  /** A few points of the temperature (or the goal, without a live one) for the timeline, with
   *  the time before and the cool-down after. */
  spark: number[];
  /** First and last point of `spark` with the heater on. */
  sparkOn?: [number, number];
  /** The Glow version that recorded it, and any it was carried on by after a restart. */
  app?: string;
  /** Some or all of it was recorded in the background, with Glow closed. */
  background?: boolean;
}

export interface SessionDetail {
  /** Seconds from the start; negative before it, past the end for the cool-down. */
  ts: number[];
  /** Live temperature, null when there is none. */
  c: (number | null)[];
  /** Goal: target plus the boost in use; null while the heater is off. */
  g: (number | null)[];
  events: SessionEvent[];
  /** Battery readings, on a clock of their own; absent on a VOLCANO and in sessions recorded before Glow kept them. */
  battery?: BatterySamples;
}

/**
 * Battery readings: with the heater on, each time a CRAFTY's voltage and current are read (every
 * ~2 s), else every 5 s with the temperature samples (VENTY, VEAZY: the percentage only); every 30 s
 * in the cool-down. Each row also has the battery % and temperature as they stand then (read less
 * often: a repeated number takes less room than a null). Whole numbers, to keep the record small; a
 * field the device does not report is left out. Sessions recorded by Glow 0.1.77 to 0.1.79 kept 5 s
 * means of the 2 s readings with the heater on instead, with `w` and `min`; up to 0.1.76 a single
 * reading every 5 s.
 */
export interface BatterySamples {
  /** Seconds from the start. */
  ts: number[];
  /** Percent. */
  p: (number | null)[];
  /** Voltage, mV (CRAFTY). */
  v?: (number | null)[];
  /** Current, mA: positive charges, negative drains (CRAFTY). */
  i?: (number | null)[];
  /**
   * Power, mW, in sessions recorded by 0.1.77–0.1.79: the mean of voltage × current since the row
   * before, signed like the current, where `v` and `i` are means; null where they are single readings.
   * Not written any more: a row's power is its voltage × current.
   */
  w?: (number | null)[];
  /** Battery temperature, °C × 10 (CRAFTY). */
  t?: (number | null)[];
  /**
   * In sessions recorded by 0.1.77–0.1.79: the lowest current (mA) and voltage × current (mW) read
   * with the heater on, the heaviest draw, which the means smooth out. Not written any more.
   */
  min?: { i: number; w: number };
}

/** The battery readings with one more at `t`, as they stand in `d`; unchanged for a device without a battery. */
export function addBattery(b: BatterySamples | undefined, t: number, d: DeviceState): BatterySamples | undefined {
  if (d.battery === undefined && !b) return b;
  if (b && b.ts[b.ts.length - 1] === t) return b;
  const n = b?.ts.length ?? 0;
  const round = (v: number | undefined) => (v === undefined ? null : Math.round(v));
  // A field that starts reporting late gets nulls for the readings before it.
  const add = (list: (number | null)[] | undefined, v: number | null) =>
    list ? [...list, v] : v === null ? undefined : [...Array<null>(n).fill(null), v];
  const out: BatterySamples = { ts: [...(b?.ts ?? []), t], p: [...(b?.p ?? []), round(d.battery)] };
  const v = add(b?.v, round(d.batteryVoltage));
  const i = add(b?.i, round(d.batteryCurrent));
  const temp = add(b?.t, d.batteryTemp === undefined ? null : Math.round(d.batteryTemp * 10));
  if (v) out.v = v;
  if (i) out.i = i;
  if (temp) out.t = temp;
  // A session from 0.1.77–0.1.79 carried on: its means stay, the new rows are single readings.
  if (b?.w) out.w = [...b.w, null];
  if (b?.min) out.min = b.min;
  return out;
}

/** A CRAFTY: voltage and current, read every ~2 s with the heater on and kept at each reading. */
const hasReadings = (d: DeviceState) => d.batteryVoltage !== undefined || d.batteryCurrent !== undefined;

const SAMPLE_MS = 5000;
/** A running session is saved at most this often (each save writes its file and the index). */
const SAVE_MS = 15_000;
/** In the cool-down the battery hardly changes: one reading every BATTERY_COOL_MS. */
const BATTERY_COOL_MS = 30_000;
/** The temperature this long before the heater comes on starts the chart, one reading every PRE_STEP_MS. */
const PRE_MS = 10_000;
const PRE_STEP_MS = 2000;
/** After the heater goes off, the cool-down is recorded until it is down to COOL_TO or for COOL_MS. */
const COOL_MS = 120_000;
const COOL_TO = 50;
/** Back within this long with the heater still on, and it is the same session. */
const RESUME_MS = 10 * 60_000;
/** A gap shorter than this (the app handing the device to the background recorder) is not marked. */
const GAP_MS = 15_000;
const SPARK = 32;

/** What the device heats to: the target plus the active boost, capped at its maximum. */
export function goalOf(d: DeviceState): number | undefined {
  const offset = d.mode === 'boost' ? d.boostOffset ?? 0 : d.mode === 'superboost' ? d.superBoostOffset ?? 0 : 0;
  return d.targetTemp === undefined ? undefined : Math.min(d.maxTemp, d.targetTemp + offset);
}

/**
 * Seconds from heater on to Ready, for a heat-up Glow saw from its start. Null when Glow joined
 * late, Ready never came, or it was Ready at once: the heater switched back on while the chamber was
 * still hot (a VENTY keeps its "reached" flag through a short off). Averages and "Ready in" use only these.
 */
export function heatUpSec(s: SessionSummary): number | null {
  return s.joined || s.readySec === null || s.readySec < 1 ? null : s.readySec;
}

/** Ready as the heater came on, the chamber still hot from just before. */
export function readyAtOnce(s: SessionSummary): boolean {
  return !s.joined && s.readySec !== null && s.readySec < 1;
}

/** The device's own flag wins (it is what drives the CRAFTY+ LED); otherwise compare temperatures. */
export function isReady(d: DeviceState): boolean {
  const goal = goalOf(d);
  const diff = goal !== undefined && d.currentTemp !== undefined ? goal - d.currentTemp : undefined;
  return d.heaterOn && (d.tempReached ?? (diff !== undefined && Math.abs(diff) < 1));
}

/** The points for the timeline, the time before and the cool-down after included, and which of
 *  them are the heater-on part. */
export function sparkOf(detail: SessionDetail, live: boolean, endSec = Infinity): Pick<SessionSummary, 'spark' | 'sparkOn'> {
  const points = detail.ts
    .map((t, i) => ({ t, v: (live ? detail.c[i] : null) ?? detail.g[i] }))
    .filter((p): p is { t: number; v: number } => p.v !== null);
  const picked =
    points.length <= SPARK ? points : Array.from({ length: SPARK }, (_, i) => points[Math.round((i * (points.length - 1)) / (SPARK - 1))]);
  const on = picked.map((p) => p.t >= 0 && p.t <= endSec);
  const from = on.indexOf(true);
  return { spark: picked.map((p) => p.v), sparkOn: from < 0 ? undefined : [from, on.lastIndexOf(true)] };
}

class Sessions {
  list = $state.raw<SessionSummary[]>([]);
  /** The running session's summary and samples, while there is one. */
  active = $state.raw<SessionSummary | null>(null);
  activeDetail = $state.raw<SessionDetail | null>(null);
  /** The session that just ended, while its cool-down is being recorded. */
  cooling = $state.raw<{ id: number; detail: SessionDetail } | null>(null);

  private key = '';
  private persist = true;
  /** Demo mode: made-up sessions, in memory only. */
  private seeded = false;
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
  /** The last seconds of temperature before a session, for the start of its chart. */
  private recent: { t: number; c: number }[] = [];
  private coolUntil = 0;
  private lastCool = 0;
  private lastCoolBattery = 0;
  /** A background recording is being replayed: the live sampler keeps still. */
  private replaying = false;
  private resuming: Promise<void> | null = null;

  /**
   * Demo mode passes made-up sessions, which are never saved. Bound to the same key again (a replay
   * and a connection at once), it waits for the first load.
   */
  bind(key: string, seed?: { list: SessionSummary[]; details: Map<number, SessionDetail> }): Promise<void> {
    if (key !== this.key) this.binding = this.open(key, seed);
    return this.binding;
  }

  private binding: Promise<void> = Promise.resolve();

  private async open(key: string, seed?: { list: SessionSummary[]; details: Map<number, SessionDetail> }) {
    this.endCooling();
    this.flush();
    this.key = key;
    this.persist = !seed;
    this.seeded = !!seed;
    this.active = null;
    this.activeDetail = null;
    this.last = null;
    this.recent = [];
    this.details = seed?.details ?? new Map();
    this.list = seed?.list ?? (await this.loadList(key));
    void this.redrawSparks(key);
  }

  private async loadList(key: string): Promise<SessionSummary[]> {
    try {
      return await sessionStore.loadIndex(key);
    } catch {
      // Unreadable: nothing is saved for this device this time, rather than an empty list over it.
      this.persist = false;
      return [];
    }
  }

  /** Sessions saved before the timeline showed the time around them get their points again, once. */
  private async redrawSparks(key: string) {
    let changed = false;
    for (const s of this.list.filter((x) => x.end !== null && !x.sparkOn)) {
      const detail = await this.detail(s.id);
      if (key !== this.key) return;
      if (!detail) continue;
      const latest = this.list.find((x) => x.id === s.id);
      if (latest) this.replace({ ...latest, ...sparkOf(detail, latest.live, (latest.end! - latest.id) / 1000) });
      changed = true;
    }
    if (changed) this.save();
  }

  async detail(id: number): Promise<SessionDetail | null> {
    if (this.active?.id === id) return this.activeDetail;
    if (this.cooling?.id === id) return this.cooling.detail;
    const known = this.details.get(id);
    if (known) return known;
    const found = this.seeded ? null : await sessionStore.loadDetail(this.key, id);
    if (found) this.details.set(id, found);
    return found;
  }

  /**
   * A report from the device; with `read`, it brings a fresh voltage and current reading (the
   * driver's pollBattery(), every ~2 s with the heater on), which the session keeps.
   */
  observe(d: DeviceState, now = Date.now(), read = false) {
    const first = this.last === null;
    this.last = d;
    if (first) this.closeStale(d, now);
    if (d.heaterOn && !this.active) {
      this.endCooling();
      this.begin(d, now, first);
    } else if (!d.heaterOn && this.active) this.finish(now);
    if (this.active) {
      this.track(d, now);
      if (read) this.reading(d, now);
    } else {
      this.remember(d, now);
      this.cool(d, now);
    }
  }

  /** When the heater went off, while its cool-down is still being recorded; null otherwise. */
  coolingSince(now = Date.now()): number | null {
    const c = this.cooling;
    if (!c || now > this.coolUntil) return null;
    return this.list.find((s) => s.id === c.id)?.end ?? null;
  }

  /** While a background recording is replayed, times come from the log, not the clock. */
  pause(on: boolean) {
    this.replaying = on;
  }

  /** Resolves once a session that is being carried on has loaded. */
  settled(): Promise<void> {
    return this.resuming ?? Promise.resolve();
  }

  /**
   * The app hands the device to the background recorder: like lost(), but unmarked, and a
   * cool-down carries on. The next report, live or replayed, carries the session on or closes it.
   */
  suspend() {
    clearInterval(this.sampler);
    if (this.cooling) this.saveCooling();
    this.recent = [];
    this.last = null;
    this.flush();
  }

  /** The connection dropped: the session stays open until the device is back. */
  lost(now = Date.now()) {
    this.endCooling();
    this.recent = [];
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
      // Still in memory (handed to the background recorder and back): carry on at once, or this
      // report would be lost to the session loading meanwhile.
      if (this.active?.id === open.id && this.activeDetail) this.carryOn(open, this.activeDetail, now);
      else this.resuming = this.resume(open, now).finally(() => (this.resuming = null));
      return;
    }
    // The heater went off while Glow was away: it ended about when Glow last saw it.
    this.close(open);
  }

  /** Ends an open session at the last time Glow saw it. */
  private close(open: SessionSummary) {
    if (this.active?.id === open.id) {
      clearInterval(this.sampler);
      this.flush();
      this.details.set(open.id, this.activeDetail!);
      this.active = null;
      this.activeDetail = null;
    }
    const latest = this.list.find((s) => s.id === open.id)!;
    const detail = this.details.get(open.id);
    this.replace({ ...latest, end: latest.seen, ...(detail ? sparkOf(detail, latest.live, (latest.seen - latest.id) / 1000) : {}) });
    this.save();
  }

  /**
   * A cool-down the background recorder took over (replay.ts), from `start` on: it carries on the
   * cool-down of the session that ended last, if that ended within COOL_MS before `start` (at
   * `offAt`, when the recorder knows). A session still open is closed first, as on any first report
   * with the heater off. Also after Glow was killed meanwhile: the session comes back from storage.
   * Samples already there (the app's own, before it went off screen, or a replay read again) stay
   * as they are; the cool-down only adds what comes after them. False when no session fits: the
   * recording then adds nothing.
   */
  async coolOn(start: number, offAt: number | null): Promise<boolean> {
    await this.settled();
    const key = this.key;
    const last = this.list[0];
    if (!last || (this.active && this.active.id !== last.id)) return false;
    const end = last.end ?? last.seen;
    if (!last.live || end > start || start - end >= COOL_MS) return false;
    // Ended at another time than the recorder says the heater went off: some other heat-up.
    if (offAt !== null && Math.abs(offAt - end) > GAP_MS) return false;
    if (last.end === null) this.close(last);
    if (this.cooling && this.cooling.id !== last.id) this.endCooling();
    const detail = await this.detail(last.id);
    if (!detail || key !== this.key) return false;
    const s = this.list.find((x) => x.id === last.id)!;
    this.cooling = { id: s.id, detail };
    this.coolUntil = end + COOL_MS;
    this.lastCool = Math.max(end, s.id + Math.max(0, ...detail.ts) * 1000);
    this.lastCoolBattery = Math.max(end, s.id + Math.max(0, ...(detail.battery?.ts ?? [])) * 1000);
    this.replace({ ...s, background: true });
    return true;
  }

  private async resume(open: SessionSummary, now: number) {
    this.carryOn(open, (await this.detail(open.id)) ?? { ts: [], c: [], g: [], events: [] }, now);
  }

  private carryOn(open: SessionSummary, detail: SessionDetail, now: number) {
    // Carried on by an updated Glow: both versions, for whoever reads the log later.
    const app = open.app?.split(' → ').includes(__APP_VERSION__) ? open.app : `${open.app ?? '?'} → ${__APP_VERSION__}`;
    this.active = { ...open, app };
    this.activeDetail = detail;
    this.wasReady = open.readySec !== null;
    this.target = this.last?.targetTemp;
    this.mode = this.last?.mode ?? 'normal';
    this.lastTick = now;
    // A drop the app saw is marked already; one it did not see (Glow closed, the recorder late) is
    // marked here unless it was too short to matter.
    const marked = detail.events[detail.events.length - 1]?.k === 'lost';
    if (!marked && now - open.seen > GAP_MS) this.event({ t: this.sec(open.seen), k: 'lost' });
    if (marked || now - open.seen > GAP_MS) this.event({ t: this.sec(now), k: 'back' });
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
      capStart: d.batteryCapacity,
      live: d.currentTemp !== undefined,
      spark: [],
      app: __APP_VERSION__,
      ...(this.replaying ? { background: true } : {}),
    };
    // The readings just before, from while the heater was still off.
    const pre = this.recent.map((r) => ({ t: Math.round((r.t - now) / 1000), c: r.c })).filter((r) => r.t < 0);
    this.recent = [];
    this.active = s;
    this.activeDetail = { ts: pre.map((r) => r.t), c: pre.map((r) => r.c), g: pre.map(() => null), events: [] };
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
      capEnd: d.batteryCapacity ?? s.capEnd,
      live: s.live || d.currentTemp !== undefined,
      ...(this.replaying ? { background: true } : {}),
    };
    if (now - this.lastSample >= SAMPLE_MS) this.sample(d, now);
    this.replace(this.active);
  }

  private sample(d: DeviceState, now: number) {
    const detail = this.activeDetail;
    const goal = goalOf(d);
    if (!detail || goal === undefined) return;
    if (detail.ts[detail.ts.length - 1] === this.sec(now)) return;
    this.lastSample = now;
    this.activeDetail = {
      ...detail,
      ts: [...detail.ts, this.sec(now)],
      c: [...detail.c, d.currentTemp === undefined ? null : Math.round(d.currentTemp * 2) / 2],
      g: [...detail.g, goal],
      // A device that reports voltage and current has its battery kept at each reading instead.
      battery: hasReadings(d) ? detail.battery : addBattery(detail.battery, this.sec(now), d),
    };
    this.scheduleSave();
  }

  /** A voltage and current reading with the heater on: kept as it is, with the battery % and temperature as they stand. */
  private reading(d: DeviceState, now: number) {
    const detail = this.activeDetail;
    if (!detail || !hasReadings(d)) return;
    const battery = addBattery(detail.battery, this.sec(now), d);
    if (battery === detail.battery) return;
    this.activeDetail = { ...detail, battery };
    this.scheduleSave();
  }

  /** Samples keep coming while the device sends nothing new (a VENTY reports on change only). */
  private startSampler() {
    clearInterval(this.sampler);
    this.sampler = setInterval(() => {
      if (this.replaying) return;
      if (this.active && this.last?.heaterOn) this.track(this.last, Date.now());
      else if (this.cooling && this.last) this.cool(this.last, Date.now());
    }, SAMPLE_MS);
  }

  private finish(now: number) {
    const s = this.active!;
    // The last stretch, counted in the level it ran in: a device drops back to Base as it turns off.
    const last = { ...this.last!, heaterOn: true, mode: this.mode, targetTemp: this.target };
    this.track(last, now);
    // A reading at the very end, so the line reaches the heater-off mark.
    this.sample(last, now);
    this.active = { ...this.active!, end: now, ...sparkOf(this.activeDetail!, s.live) };
    this.flush();
    if (s.live) {
      this.cooling = { id: s.id, detail: this.activeDetail! };
      this.coolUntil = now + COOL_MS;
      this.lastCool = now;
      this.lastCoolBattery = now;
    } else {
      clearInterval(this.sampler);
    }
    this.active = null;
    this.activeDetail = null;
  }

  /** Keeps the last few seconds of temperature while the heater is off. */
  private remember(d: DeviceState, now: number) {
    if (d.currentTemp === undefined) return;
    if (now - (this.recent[this.recent.length - 1]?.t ?? 0) >= PRE_STEP_MS) {
      this.recent = [...this.recent.filter((r) => r.t > now - PRE_MS - PRE_STEP_MS), { t: now, c: d.currentTemp }];
    }
  }

  /** After the heater went off: the temperature going down, until COOL_TO or COOL_MS. */
  private cool(d: DeviceState, now: number) {
    const c = this.cooling;
    if (!c) return;
    if (d.currentTemp === undefined) return this.endCooling();
    // Samples come every SAMPLE_MS from wherever the sampler happens to tick, so the last one inside
    // the window can land a few seconds short of it (the chart said "+1:58"). The first reading past
    // the window closes it at exactly COOL_MS instead.
    const over = now >= this.coolUntil;
    if (!over && now - this.lastCool < SAMPLE_MS) return;
    this.lastCool = now;
    const temp = Math.round(d.currentTemp * 2) / 2;
    const t = Math.round((Math.min(now, this.coolUntil) - c.id) / 1000);
    if (over && t <= (c.detail.ts[c.detail.ts.length - 1] ?? -Infinity)) return this.endCooling();
    const battery = now - this.lastCoolBattery >= BATTERY_COOL_MS ? addBattery(c.detail.battery, t, d) : c.detail.battery;
    if (battery !== c.detail.battery) this.lastCoolBattery = now;
    this.cooling = {
      id: c.id,
      detail: { ...c.detail, ts: [...c.detail.ts, t], c: [...c.detail.c, temp], g: [...c.detail.g, null], battery },
    };
    // The device's own count, to the end of the cool-down like the readings.
    const s = this.list.find((x) => x.id === c.id);
    if (s && d.batteryCapacity !== undefined && d.batteryCapacity !== s.capEnd) this.replace({ ...s, capEnd: d.batteryCapacity });
    if (over || temp <= COOL_TO) return this.endCooling();
    // Saved as it goes, so an app that is closed meanwhile keeps what was recorded.
    if (this.cooling.detail.ts.length % 6 === 0) this.saveCooling();
  }

  private saveCooling() {
    const c = this.cooling;
    const s = c && this.list.find((x) => x.id === c.id);
    if (!c || !s || s.end === null) return;
    this.replace({ ...s, ...sparkOf(c.detail, s.live, (s.end - s.id) / 1000) });
    this.details.set(c.id, c.detail);
    if (this.persist && this.key) void sessionStore.saveDetail(this.key, c.id, c.detail);
    this.save();
  }

  private endCooling() {
    if (!this.cooling) return;
    this.saveCooling();
    this.cooling = null;
    if (!this.active) clearInterval(this.sampler);
  }

  private event(e: SessionEvent) {
    if (!this.activeDetail) return;
    this.activeDetail = { ...this.activeDetail, events: [...this.activeDetail.events, e] };
  }

  private replace(s: SessionSummary) {
    this.list = this.list.map((x) => (x.id === s.id ? s : x));
  }

  /**
   * At most one save every SAVE_MS while the session runs. A timer reset by every sample never
   * fired while samples kept coming (every 5 s), so a session on screen was only saved at its
   * events: an app killed mid-heat lost everything since the last one.
   */
  private scheduleSave() {
    if (this.saveTimer !== undefined) return;
    this.saveTimer = setTimeout(() => this.flush(), SAVE_MS);
  }

  private flush() {
    clearTimeout(this.saveTimer);
    this.saveTimer = undefined;
    if (this.active && this.activeDetail) {
      const s = { ...this.active, ...sparkOf(this.activeDetail, this.active.live) };
      this.replace(s);
      this.details.set(s.id, this.activeDetail);
      if (this.persist && this.key) void sessionStore.saveDetail(this.key, s.id, this.activeDetail);
    }
    this.save();
  }

  private save() {
    if (this.persist && this.key) void sessionStore.saveIndex(this.key, this.list);
  }

  /** The running session and one still recording its cool-down: a clean-up leaves them alone. */
  private pinned() {
    return new Set([this.active?.id, this.cooling?.id].filter((id): id is number => id !== undefined));
  }

  /** What the log takes, all devices (Settings › Session history). */
  async storage(): Promise<StorageReport> {
    if (this.seeded) {
      const files = [...this.details].map(([id, d]) => ({ dev: this.key, name: String(id), bytes: new Blob([JSON.stringify(d)]).size }));
      return report([{ dev: this.key, list: this.list }], files, this.pinned());
    }
    this.flush();
    const files = await sessionStore.files();
    return report(await this.logs(files), files, this.pinned());
  }

  /** Each device's list: the bound one's from memory (it may be ahead of what is saved). */
  private async logs(files: StoredFile[]): Promise<DeviceLog[]> {
    const devs = new Set(files.map((f) => f.dev));
    if (this.key) devs.add(this.key);
    const out: DeviceLog[] = [];
    for (const dev of devs) {
      if (dev === this.key) out.push({ dev, list: this.list });
      else out.push({ dev, list: await sessionStore.loadIndex(dev).catch(() => []) });
    }
    return out;
  }

  /**
   * Removes the sessions that started before `cut`, on every device: their charts and their rows
   * in the list. The running session and a cool-down still being recorded stay. Hours of
   * operation (usage.svelte.ts) are kept apart and stay as they are.
   */
  async prune(cut: number): Promise<void> {
    const pinned = this.pinned();
    const gone = (s: SessionSummary) => removable({ ...s, pinned: pinned.has(s.id) }, cut);
    if (this.seeded) {
      for (const s of this.list.filter(gone)) this.details.delete(s.id);
      this.list = this.list.filter((s) => !gone(s));
      return;
    }
    this.flush();
    const files = await sessionStore.files();
    const devs = new Set(files.map((f) => f.dev));
    if (this.key) devs.add(this.key);
    for (const dev of devs) {
      let list: SessionSummary[];
      let ids: number[];
      if (dev === this.key) {
        // Its list could not be read: its files are not known to be orphans.
        if (!this.persist) continue;
        // Read and written in one go, so a sample coming in meanwhile is not lost.
        list = this.list;
        ids = list.filter(gone).map((s) => s.id);
        if (ids.length) {
          this.list = list.filter((s) => !gone(s));
          for (const id of ids) this.details.delete(id);
          this.save();
        }
      } else {
        try {
          list = await sessionStore.loadIndex(dev);
        } catch {
          continue;
        }
        ids = list.filter(gone).map((s) => s.id);
        if (ids.length) await sessionStore.saveIndex(dev, list.filter((s) => !gone(s)));
      }
      // The list first, then the charts: cut short in between, a chart is left without its row
      // (and goes with the next clean-up), never a row without its chart.
      const known = new Set(list.map((s) => String(s.id)));
      const orphans = files
        .filter((f) => f.dev === dev && f.name !== INDEX && !known.has(f.name) && Number(f.name) < cut)
        .map((f) => Number(f.name));
      await sessionStore.removeDetails(dev, [...ids, ...orphans]);
    }
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
      if (live) {
        for (let t = -10; t < 0; t += 2) {
          detail.ts.push(t);
          detail.c.push(Math.round((c + rnd() * 0.5) * 2) / 2);
          detail.g.push(null);
        }
      }
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
      // The cool-down: to 50° or for two minutes.
      for (let t = Math.ceil(length / 5) * 5 + 5; live && t <= length + 120; t += 5) {
        c += (24 - c) * 0.085;
        detail.ts.push(t);
        detail.c.push(Math.round(c * 2) / 2);
        detail.g.push(null);
        if (c <= 50) break;
      }
      // The same two draws as before the battery readings, so the other demo sessions stay as they were.
      if (battery) detail.battery = demoBattery(detail, live, length, readySec, boostAt, 90 - Math.round(rnd() * 30), 1.4 + rnd());
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
        ...sparkOf(detail, live, length),
      };
      if (battery) {
        const b = detail.battery as BatterySamples & { mah?: number };
        const p = b.p as number[];
        s.batteryStart = p[0];
        s.batteryEnd = p[p.length - 1];
        if (live) {
          // The device's own count, a little off Glow's.
          s.capStart = Math.round(p[0] * 31.5);
          s.capEnd = s.capStart - Math.round((b.mah ?? 0) * 1.04);
        }
        delete b.mah;
      }
      list.push(s);
      details.set(start, detail);
    }
  }
  list.sort((a, b) => b.id - a.id);
  return { list, details };
}

/**
 * Made-up battery readings for a demo session, with no random numbers of its own (the sessions'
 * stay as they were). A CRAFTY+: about 7 A drawn at ~3.1 V while heating up, 2–4 A holding, more in
 * boost, almost nothing after; the battery warms by ~10 °C. A VENTY: the percentage only.
 */
function demoBattery(
  detail: SessionDetail, electric: boolean, length: number, readySec: number | null, boostAt: number | null, pct0: number, perMin: number,
): BatterySamples & { mah?: number } {
  const b: BatterySamples & { mah?: number } = { ts: [], p: [], ...(electric ? { v: [], i: [], t: [] } : {}) };
  let mah = 0;
  let temp = 26 + (pct0 % 5);
  let prev: { t: number; a: number } | null = null;
  const times = [...detail.ts.filter((t) => t >= 0 && t <= length)];
  if (electric) for (let t = Math.ceil(length / 30) * 30; t <= length + 120; t += 30) times.push(t);
  for (const t of times) {
    const on = t <= length;
    const amps = !on ? 0.04
      : readySec === null || t < readySec ? 6.6 + 0.4 * Math.sin(t / 7)
      : boostAt !== null && t >= boostAt && t < boostAt + 40 ? 5.2
      : 2.6 + 1.1 * Math.max(0, Math.sin(t / 11)) + (boostAt !== null && t >= boostAt ? 0.6 : 0);
    if (prev) mah += ((prev.a + amps) / 2) * 1000 * ((t - prev.t) / 3600);
    prev = { t, a: amps };
    // 3.95 V at rest when full, less as it drains, and less again under load.
    const rest = 3.95 - (88 - pct0) * 0.006 - mah / 3300;
    // Warmer while it works hard, a little more just after, then cooling.
    temp += on ? 0.022 * (t - (b.ts[b.ts.length - 1] ?? 0)) * (amps / 5) : 0.9 * Math.exp(-(t - length) / 40) - 0.2;
    const pct = Math.max(0, pct0 - Math.floor(electric ? mah / 33 : (Math.min(t, length) / 60) * perMin));
    b.ts.push(t);
    b.p.push(pct);
    if (electric) {
      b.v!.push(Math.round((rest - 0.11 * amps) * 1000));
      b.i!.push(-Math.round(amps * 1000));
      b.t!.push(Math.round(temp * 10));
    }
  }
  b.mah = mah;
  return b;
}

export const sessions = new Sessions();
