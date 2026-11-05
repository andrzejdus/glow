import { describe, expect, it } from 'vitest';
import { seriesOf } from './battery';
import {
  formatValue, legendName, nearestIndex, neighbours, readoutLine, stepFrom, summaryLine, swipeIntent, swipeStep, timeLabel, valueAt, valuesAt,
  type ReadoutSession,
} from './readout';
import type { BatterySamples, SessionDetail } from './sessions.svelte';

// A CRAFTY+: temperature every 5 s, the battery at 0, 5 and 10 s, then once in the cool-down.
const battery: BatterySamples = {
  ts: [0, 5, 10, 40],
  p: [78, 78, 77, 76],
  v: [3600, 3500, 3550, 3700],
  i: [-7000, -6900, -3100, -40],
  t: [290, 300, 320, 330],
};
const detail: SessionDetail = {
  ts: [-4, 0, 5, 10, 15, 20, 40],
  c: [24, 30, 80, 150, 180, 170, 120],
  g: [null, 190, 190, 190, 190, null, null],
  events: [{ t: 15, k: 'ready' }],
  battery,
};
const crafty: ReadoutSession = { detail, unit: 'C', live: true, readySec: 15, endSec: 18, peak: 181, target: 190 };
const venty: ReadoutSession = {
  detail: { ts: [0, 5, 10, 15], c: [null, null, null, null], g: [185, 185, 185, 185], events: [], battery: { ts: [0, 5, 10, 15], p: [64, 64, 63, 63] } },
  unit: 'C', live: false, readySec: 10, endSec: null, peak: null, target: 185,
};

describe('values on the chart', () => {
  it('has a dot per value the session has readings of', () => {
    expect(seriesOf(detail)).toEqual(['temp', 'battery', 'voltage', 'current', 'power', 'batteryTemp']);
    // VENTY: two dots. VOLCANO, or a session from before the battery was kept: none.
    expect(seriesOf(venty.detail)).toEqual(['temp', 'battery']);
    expect(seriesOf({ ...detail, battery: undefined })).toEqual(['temp']);
  });

  it('reads the last value at or before a moment', () => {
    expect(valueAt(crafty, 'temp', 12)).toBe(150);
    expect(valueAt(crafty, 'current', 7)).toBe(6.9);
    // Between the last heating reading and the cool-down one, the earlier stands.
    expect(valueAt(crafty, 'current', 30)).toBe(3.1);
    expect(valueAt(crafty, 'current', 40)).toBe(0.04);
    // Before the first reading: the first.
    expect(valueAt(crafty, 'battery', -4)).toBe(78);
    // Without a live temperature, the target once Ready, nothing before it.
    expect(valueAt(venty, 'temp', 5)).toBeNull();
    expect(valueAt(venty, 'temp', 12)).toBe(185);
  });

  it('does not reach across a gap in the battery readings', () => {
    const gappy: ReadoutSession = { ...crafty, detail: { ...detail, battery: { ...battery, ts: [0, 5, 10, 100] } } };
    expect(valueAt(gappy, 'voltage', 60)).toBeNull();
    expect(valueAt(gappy, 'voltage', 100)).toBe(3.7);
  });

  it('snaps a touch to the nearest sample', () => {
    expect(nearestIndex(detail.ts, 12)).toBe(3);
    expect(nearestIndex(detail.ts, 13)).toBe(4);
    expect(nearestIndex(detail.ts, 999)).toBe(6);
    expect(nearestIndex([], 3)).toBe(-1);
  });

  it('writes every value with its unit, amps as A', () => {
    expect(formatValue('current', 7.04, 'C')).toBe('7.0 A');
    expect(formatValue('voltage', 3.6, 'C')).toBe('3.60 V');
    expect(formatValue('power', 21.66, 'C')).toBe('21.7 W');
    expect(formatValue('battery', 78, 'C')).toBe('78 %');
    expect(formatValue('temp', 190, 'F')).toBe('374°');
    expect(formatValue('batteryTemp', null, 'C')).toBe('–');
    expect(legendName('current', 'C')).toBe('Current (A)');
    expect(legendName('batteryTemp', 'F')).toBe('Battery temp (°F)');
  });

  it('writes moments as the axis does', () => {
    expect(timeLabel(150, null)).toBe('2:30');
    expect(timeLabel(150, 100)).toBe('+0:50');
    expect(timeLabel(-4, 100)).toBe('−0:04');
  });
});

describe('the readout', () => {
  it('says the value now and the most telling number while the session runs', () => {
    const running = { ...crafty, endSec: null };
    expect(readoutLine(running, 'current', { kind: 'now' })).toBe('0.0 A now · peak 7.0 A');
    expect(readoutLine(running, 'voltage', { kind: 'now' })).toBe('3.70 V now · low 3.50 V');
    expect(readoutLine(running, 'battery', { kind: 'now' })).toBe('76 % now · start 78 %');
    expect(readoutLine(running, 'batteryTemp', { kind: 'now' })).toBe('33° now · max 33°');
    expect(readoutLine(running, 'temp', { kind: 'now' })).toBe('120° now · peak 181°');
    // VENTY: no live temperature, so no peak; the target once Ready.
    expect(readoutLine(venty, 'temp', { kind: 'now' })).toBe('185° now');
    expect(readoutLine(venty, 'battery', { kind: 'now' })).toBe('63 % now · start 64 %');
  });

  it('says the value at the touched moment', () => {
    expect(readoutLine(crafty, 'current', { kind: 'at', t: 5 })).toBe('At 0:05 · 6.9 A');
    expect(readoutLine(crafty, 'temp', { kind: 'at', t: 40 })).toBe('At +0:22 · 120°');
  });

  it('sums up a finished session', () => {
    const wh = /^peak 7\.0 A · \d\.\d\d Wh$/;
    expect(readoutLine(crafty, 'current', { kind: 'summary' })).toMatch(wh);
    expect(summaryLine(crafty, 'battery')).toBe('78 → 76 % · −2 %');
    expect(summaryLine(crafty, 'voltage')).toBe('3.60 → 3.70 V · low 3.50 V');
    expect(summaryLine(crafty, 'batteryTemp')).toBe('29 → 33° · max at +0:22');
    expect(summaryLine(crafty, 'temp')).toBe('peak 181° · target 190°');
    expect(summaryLine(venty, 'temp')).toBe('target 185°');
    expect(summaryLine(venty, 'battery')).toBe('64 → 63 % · −1 %');
  });

  it('reads 2 s readings between the 5 s temperature samples, and peaks at the highest one', () => {
    // As kept now: a reading every 2 s while heating, the current switching between -8 A and 0.
    const fine: BatterySamples = {
      ts: [1, 3, 5, 7, 9, 11, 40], p: [78, 78, 78, 78, 77, 77, 76], v: [3100, 3550, 3100, 3550, 3100, 3550, 3700],
      i: [-8000, 0, -8000, 0, -8000, 0, -40], t: [290, 290, 300, 300, 300, 310, 330],
    };
    const s = { ...crafty, detail: { ...detail, battery: fine } };
    expect(readoutLine(s, 'current', { kind: 'at', t: 3 })).toBe('At 0:03 · 0.0 A');
    expect(valueAt(s, 'current', 6)).toBe(8);
    expect(readoutLine(s, 'current', { kind: 'at', t: 9 })).toBe('At 0:09 · 8.0 A');
    expect(summaryLine(s, 'current')).toMatch(/^peak 8\.0 A · \d\.\d\d Wh$/);
    expect(summaryLine(s, 'power')).toMatch(/^peak 24\.8 W · /);
  });

  it('gives the true peak of the 2 s reads in a session from 0.1.77–0.1.79, not of the 5 s means drawn', () => {
    const fine = { ...crafty, detail: { ...detail, battery: { ...battery, min: { i: -8100, w: -28000 } } } };
    expect(summaryLine(fine, 'current')).toMatch(/^peak 8\.1 A · /);
    expect(readoutLine(fine, 'power', { kind: 'now' })).toContain('peak 28');
  });

  it('gives every value at a moment for the bubble', () => {
    expect(valuesAt(crafty, ['temp', 'current', 'batteryTemp'], 5)).toEqual([
      { key: 'temp', text: '80°', tag: 'temp' },
      { key: 'current', text: '6.9 A', tag: '' },
      { key: 'batteryTemp', text: '30°', tag: 'batt' },
    ]);
  });
});

describe('swiping the chart', () => {
  it('waits for a clear direction, and leaves vertical moves to the page', () => {
    expect(swipeIntent(4, 3)).toBe('wait');
    expect(swipeIntent(-30, 6)).toBe('swipe');
    expect(swipeIntent(20, 18)).toBe('scroll');
    expect(swipeIntent(2, 40)).toBe('scroll');
  });

  it('moves one value on a long enough swipe or a flick', () => {
    expect(swipeStep(-70, 400, 318)).toBe(1);
    expect(swipeStep(70, 400, 318)).toBe(-1);
    expect(swipeStep(-30, 400, 318)).toBe(0);
    expect(swipeStep(-30, 50, 318)).toBe(1);
    // A narrow chart needs less.
    expect(swipeStep(-45, 600, 200)).toBe(1);
  });

  it('goes round at the ends', () => {
    const keys = seriesOf(detail);
    expect(stepFrom(keys, 'temp', 1)).toBe('battery');
    expect(stepFrom(keys, 'temp', -1)).toBe('batteryTemp');
    expect(stepFrom(keys, 'batteryTemp', 1)).toBe('temp');
    expect(stepFrom(['temp', 'battery'], 'battery', -1)).toBe('temp');
    expect(stepFrom(['temp', 'battery'], 'battery', 1)).toBe('temp');
  });
});

describe('the stepper', () => {
  it('leads to the values on either side, round at the ends', () => {
    const keys = seriesOf(detail);
    expect(neighbours(keys, 'current')).toEqual({ prev: 'voltage', next: 'power' });
    expect(neighbours(keys, 'temp')).toEqual({ prev: 'batteryTemp', next: 'battery' });
    expect(neighbours(keys, 'batteryTemp')).toEqual({ prev: 'power', next: 'temp' });
  });

  it('has both arrows on the other value with two (VENTY)', () => {
    expect(neighbours(['temp', 'battery'], 'temp')).toEqual({ prev: 'battery', next: 'battery' });
  });

  it('has no arrows without battery readings (VOLCANO)', () => {
    expect(neighbours(['temp'], 'temp')).toBeNull();
    expect(neighbours([], 'temp')).toBeNull();
  });
});
