import type { DeviceState } from './devices/types';
import { load, save } from './prefs';
import { goalOf, isReady, sessions, type SessionDetail, type SessionSummary } from './sessions.svelte';

// "Ready in …" while heating. The first guess comes from earlier sessions: how long they still
// took to Ready when they were as many degrees below the goal as the device is now (the median
// of the last few). While the device heats, the last half minute is compared with them over the
// same degrees, and the guess is scaled by how much faster or slower this heat-up runs (battery,
// charger, a warm or cold device).
//
// A reheat (Ready lost to a draw) is its own case: a draw cools a CRAFTY+ by only a few degrees,
// yet its Ready comes back seconds after the temperature does, so the last seconds of a first
// heat-up guessed far too short. Glow keeps the last reheats of each device, from the bottom of
// the dip to Ready, and guesses from those once the temperature climbs again.

/** The guess is taken from this many of the latest sessions that got Ready. */
const HISTORY = 8;
/** The pace is measured over this long, and counts fully once it covers PACE_FULL_MS. */
const PACE_MS = 30_000;
const PACE_FULL_MS = 20_000;
/** The heater takes a few seconds to get going (a CRAFTY+ started at 47° climbed 0.8° a second for
 *  5 s, then 2°), which earlier heat-ups from a colder start never show at those degrees: the pace
 *  is measured only after this. */
const SPIN_UP_MS = 10_000;
/** Reheats kept per device. */
const REHEATS = 12;

/** An earlier heat-up: degrees below the goal and the seconds it still took to Ready, in time order. */
export interface HeatUp {
  below: number[];
  left: number[];
}

/** The part of a session from heater on to its first reading past Ready. */
export function heatUpOf(s: SessionSummary, detail: SessionDetail): HeatUp | null {
  if (s.readySec === null) return null;
  const h: HeatUp = { below: [], left: [] };
  for (let i = 0; i < detail.ts.length; i++) {
    const t = detail.ts[i];
    const c = detail.c[i];
    const g = detail.g[i];
    if (t < 0 || c === null || g === null) continue;
    h.below.push(g - c);
    h.left.push(s.readySec - t);
    if (t >= s.readySec) break;
  }
  return h.below.length >= 2 ? h : null;
}

/** Seconds a heat-up still took to Ready once it was `deg` below the goal; null if it started closer. */
export function leftAt(h: HeatUp, deg: number): number | null {
  if (deg > h.below[0]) return null;
  for (let i = 1; i < h.below.length; i++) {
    if (h.below[i] > deg) continue;
    const a = h.below[i - 1];
    const b = h.below[i];
    const f = a === b ? 1 : (a - deg) / (a - b);
    return Math.max(0, h.left[i - 1] + (h.left[i] - h.left[i - 1]) * f);
  }
  // It never got that close: the device said Ready before.
  return 0;
}

/** For a goal further away than a heat-up started: its whole time plus the extra degrees at its first rate. */
function carriedOn(h: HeatUp, deg: number): number | null {
  let k = h.left.findIndex((l) => h.left[0] - l >= 10);
  // A reheat is shorter than that: its whole climb.
  if (k < 0) k = h.left.length - 1;
  if (h.left[0] - h.left[k] < 2) return null;
  const rate = (h.below[0] - h.below[k]) / (h.left[0] - h.left[k]);
  return rate > 0.2 ? h.left[0] + (deg - h.below[0]) / rate : null;
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const v = [...values].sort((a, b) => a - b);
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

/** Seconds to Ready from `deg` below the goal, going by earlier heat-ups. */
export function fromHistory(curves: HeatUp[], deg: number): number | null {
  const seen = median(curves.map((h) => leftAt(h, deg)).filter((v): v is number => v !== null));
  return seen ?? median(curves.map((h) => carriedOn(h, deg)).filter((v): v is number => v !== null));
}

/** How long earlier heat-ups took from `from` to `to` degrees below the goal, only those that went
 *  through both: a carried-on guess is no yardstick for the pace. */
function took(curves: HeatUp[], from: number, to: number): number | null {
  return median(
    curves
      .map((h) => {
        const a = leftAt(h, from);
        const b = leftAt(h, to);
        return a === null || b === null ? null : a - b;
      })
      .filter((v): v is number => v !== null),
  );
}

/** Seconds to Ready, from earlier heat-ups, scaled by the pace over the readings in `trail`. */
export function estimate(curves: HeatUp[], trail: { t: number; below: number }[], now: { t: number; below: number }): number | null {
  const left = fromHistory(curves, now.below);
  if (left === null) return null;
  // From the oldest reading that earlier heat-ups went through.
  const from = trail.find((r) => curves.some((h) => r.below <= h.below[0])) ?? now;
  const expected = took(curves, from.below, now.below) ?? 0;
  const actual = (now.t - from.t) / 1000;
  // Too little of a climb to compare (just started, or holding near the goal): no correction.
  if (expected < 3 || actual <= 0) return left;
  const pace = Math.max(0.5, Math.min(2.5, actual / expected));
  const weight = Math.min(1, (now.t - from.t) / PACE_FULL_MS);
  return left * (1 + weight * (pace - 1));
}

class Ready {
  /** When the device should say Ready, epoch ms; 0 without a guess. */
  at = $state(0);

  private curves: HeatUp[] = [];
  private reheats: HeatUp[] = [];
  private key = '';
  private persist = true;
  /** Ready was reached at this goal, so losing it is a reheat. */
  private wasReady = false;
  /** Readings since Ready was lost. */
  private dip: { t: number; below: number }[] = [];
  /** Seconds from heater on to Ready of earlier sessions, for devices without a live temperature. */
  private times: number[] = [];
  private trail: { t: number; below: number }[] = [];
  private heating = false;
  private onAt = 0;
  private goal: number | undefined;
  private updated = 0;
  private gen = 0;

  /** Demo mode keeps its reheats in memory only. */
  async bind(key: string, demo = false) {
    if (key === this.key) return;
    this.key = key;
    this.persist = !demo;
    // Another device: its own earlier heat-ups load at its first report.
    this.heating = false;
    this.at = 0;
    this.reheats = demo ? [] : await load<HeatUp[]>(`reheats:${key}`, []);
  }

  observe(d: DeviceState, now = Date.now()) {
    if (!d.heaterOn) {
      this.heating = false;
      this.at = 0;
      return;
    }
    if (!this.heating) {
      this.heating = true;
      this.onAt = now;
      this.trail = [];
      this.at = 0;
      this.wasReady = false;
      this.dip = [];
      void this.prepare();
    }
    const goal = goalOf(d);
    if (goal === undefined) return;
    if (goal !== this.goal) {
      const step = this.goal === undefined ? Infinity : goal - this.goal;
      this.goal = goal;
      if (Math.abs(step) < 5) {
        // A few degrees with + or -: the same climb, a little longer or shorter. Starting over lost
        // the pace and made the count jump (39 to 41 s for one degree less).
        this.trail = this.trail.map((r) => ({ ...r, below: r.below + step }));
        this.dip = this.dip.map((r) => ({ ...r, below: r.below + step }));
      } else {
        // A boost, or a new target far away: a new climb, shown at once.
        this.trail = [];
        this.at = 0;
        this.wasReady = false;
        this.dip = [];
      }
    }
    const below = d.currentTemp === undefined ? undefined : goal - d.currentTemp;
    if (isReady(d)) {
      if (this.dip.length && below !== undefined) this.learn([...this.dip, { t: now, below }], now);
      // A Ready far below the goal is the flag of the last goal, which the device drops a moment
      // after a boost; the climb to the boost is not a reheat.
      this.wasReady ||= below === undefined || below < 5;
      this.dip = [];
      this.trail = [];
      this.at = 0;
      return;
    }
    if (this.wasReady) {
      // A reheat: guess once the temperature climbs again, as the draw may still be going on.
      // Without a live temperature (VENTY/VEAZY) there is nothing to go by.
      if (below === undefined) return;
      this.dip.push({ t: now, below });
      const bottom = Math.max(...this.dip.map((r) => r.below));
      const left = below <= bottom - 1 ? fromHistory(this.reheats, below) : null;
      this.settle(left === null ? null : now + left * 1000, now);
      return;
    }
    if (d.currentTemp === undefined) {
      // VENTY/VEAZY: no live temperature, so the usual heat-up time, counted from heater on.
      const s = sessions.active;
      const usual = median(this.times);
      this.settle(s && !s.joined && usual !== null ? s.id + usual * 1000 : null, now);
      return;
    }
    const reading = { t: now, below: goal - d.currentTemp };
    if (now - this.onAt >= SPIN_UP_MS) this.trail = [...this.trail.filter((r) => r.t > now - PACE_MS), reading];
    // Above the goal it has to cool down first, which earlier heat-ups say nothing about.
    const left = reading.below < -1 ? null : estimate(this.curves, this.trail, reading);
    this.settle(left === null ? null : now + left * 1000, now);
  }

  /**
   * Whole seconds to Ready; null without a guess, 0 once the guess has run out. `now` may be the
   * UI's last clock tick, from before the latest report: counting from it showed a second more
   * for a moment when the report moved the end a little later.
   */
  left(now: number): number | null {
    return this.at ? Math.max(0, Math.ceil((this.at - Math.max(now, this.updated)) / 1000)) : null;
  }

  /** Earlier heat-ups of this device, loaded as the heater comes on. */
  private async prepare() {
    const gen = ++this.gen;
    const past = sessions.list.filter((s) => s.end !== null && !s.joined && s.readySec !== null).slice(0, HISTORY);
    const curves: HeatUp[] = [];
    for (const s of past.filter((x) => x.live)) {
      const detail = await sessions.detail(s.id);
      if (gen !== this.gen) return;
      const h = detail && heatUpOf(s, detail);
      if (h) curves.push(h);
    }
    this.curves = curves;
    this.times = past.map((s) => s.readySec!);
  }

  /** Keeps a reheat from the bottom of its dip (where the draw ended) to Ready. */
  private learn(dip: { t: number; below: number }[], readyAt: number) {
    const bottom = Math.max(...dip.map((r) => r.below));
    let from = dip.length - 1;
    while (dip[from].below !== bottom) from--;
    const climb = dip.slice(from);
    // Longer than two minutes, Glow was most likely away for part of it.
    if (climb.length < 2 || readyAt - climb[0].t > 120_000) return;
    const h: HeatUp = {
      below: climb.map((r) => Math.round(r.below * 2) / 2),
      left: climb.map((r) => Math.round((readyAt - r.t) / 100) / 10),
    };
    this.reheats = [h, ...this.reheats].slice(0, REHEATS);
    if (this.persist && this.key) save(`reheats:${this.key}`, this.reheats);
  }

  /**
   * Moves the shown end towards a new guess, so the count runs faster or slower instead of
   * jumping: it moves at most 0.6 s earlier or 0.5 s later per second, so the count runs between
   * half and 1.6 times the clock's speed, never steps back up and skips at most a second. A big
   * error takes a while to catch up; a recording on the phone showed that letting it catch up
   * faster made the count step back up (60, 61, 57, 59). A new goal is shown at once.
   *
   * Once the count has run out ("Almost ready") it stays there until Ready: a guess a second later
   * on each report showed "Almost ready" and "1 s" in turn. Without a guess the count carries on.
   */
  private settle(end: number | null, now: number) {
    if (end === null || (this.at && this.at <= now)) {
      this.updated = now;
      return;
    }
    if (!this.at) this.at = end;
    else {
      const dt = Math.min(1000, now - this.updated);
      this.at += Math.max(-0.6 * dt, Math.min(0.5 * dt, end - this.at));
    }
    this.updated = now;
  }
}

export const ready = new Ready();
