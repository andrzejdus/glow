import { describe, expect, it } from 'vitest';
import { CRAFTY_UUIDS as C } from './devices/crafty';
import { GAP_DEVICE_NAME, GAP_SERVICE, QVAP_CONTROL, QVAP_SERVICE } from './devices/qvap';
import type { DeviceState } from './devices/types';
import { parseLog, replay } from './replay';
import { sessions } from './sessions.svelte';
import { usage } from './usage.svelte';

// Logs as android/.../Recorder.java writes them.

const T0 = new Date(2026, 9, 24, 12, 0, 0).getTime();

const hex = (bytes: number[]) => bytes.map((b) => (b & 0xff).toString(16).padStart(2, '0')).join('');
const u16 = (v: number) => hex([v & 0xff, v >> 8]);
const text = (s: string) => hex([...s].map((c) => c.charCodeAt(0)));

/** The header of a CRAFTY+ recording: the values as they stood at `t0`. */
function craftyHead(id: string, t0: number, status: number, temp: number) {
  const lines: string[] = [`${t0} B ${id} crafty Storz&Bickel`];
  const v = (svc: string, chr: string, value: string) => lines.push(`${t0} V ${svc} ${chr} ${value}`);
  v(C.SVC_CONTROL, C.targetTemp, u16(1800));
  v(C.SVC_INFO, C.serial, text('CY123456'));
  v(C.SVC_CONTROL, C.currentTemp, u16(temp));
  v(C.SVC_CONTROL, C.boostOffset, u16(100));
  v(C.SVC_INFO, C.firmware, text('V03.24'));
  v(C.SVC_SYSTEM, C.status2, u16(0));
  v(C.SVC_SYSTEM, C.useHours, u16(10));
  v(C.SVC_SYSTEM, C.useMinutes, u16(5));
  v(C.SVC_INFO, C.firmwareBle, hex([1, 2, 3]));
  v(C.SVC_CONTROL, C.ledBrightness, u16(100));
  v(C.SVC_CONTROL, C.autoShutoff, u16(120));
  v(C.SVC_CONTROL, C.autoShutoffRemaining, u16(120));
  v(C.SVC_CONTROL, C.battery, u16(80));
  v(C.SVC_SYSTEM, C.batteryVoltage, u16(3900));
  v(C.SVC_SYSTEM, C.batteryCurrent, u16(0));
  v(C.SVC_SYSTEM, C.status, u16(status));
  v(C.SVC_SYSTEM, C.batteryStatus, u16(0));
  lines.push(`${t0} S`);
  return lines;
}

/** A CRAFTY+ that was off, comes on 14 s in, gets ready at 40 s, goes off at 100 s and cools down. */
function craftyLog(id: string, end = 'idle') {
  const lines = craftyHead(id, T0, 0, 300);
  const at = (sec: number, chr: string, svc: string, value: string) => lines.push(`${T0 + sec * 1000} N ${svc} ${chr} ${value}`);
  for (let sec = 2; sec <= 12; sec += 2) at(sec, C.currentTemp, C.SVC_CONTROL, u16(300));
  at(14, C.status, C.SVC_SYSTEM, u16(0x10));
  for (let sec = 15; sec <= 99; sec++) at(sec, C.currentTemp, C.SVC_CONTROL, u16(Math.min(1800, 300 + (sec - 14) * 60)));
  at(40, C.status, C.SVC_SYSTEM, u16(0x110));
  lines.push(`${T0 + 45_000} R ${C.SVC_CONTROL} ${C.targetTemp} ${u16(1850)}`);
  lines.push(`${T0 + 45_100} F`);
  at(100, C.status, C.SVC_SYSTEM, u16(0));
  for (let sec = 102; sec <= 220; sec += 2) at(sec, C.currentTemp, C.SVC_CONTROL, u16(Math.max(300, 1800 - (sec - 100) * 25)));
  if (end) lines.push(`${T0 + 230_000} E ${end}`);
  return lines.sort((a, b) => Number(a.split(' ')[0]) - Number(b.split(' ')[0]) || 0).join('\n');
}

describe('background recording replay', () => {
  it('reads the log, recording by recording', () => {
    const log = `${craftyLog('AA:BB:CC:DD:EE:01')}\nnot a line\n${T0 + 300_000} B AA:BB:CC:DD:EE:01 crafty x\n${T0 + 300_000} S`;
    const recs = parseLog(log);
    expect(recs).toHaveLength(2);
    expect(recs[0].values).toHaveLength(17);
    expect(recs[0].reason).toBe('idle');
    expect(recs[0].end).toBe(T0 + 230_000);
    // Cut off: Glow was killed while it recorded.
    expect(recs[1].reason).toBeNull();
  });

  it('turns a CRAFTY+ recording into a session, with the time before and the cool-down', async () => {
    const id = 'AA:BB:CC:DD:EE:01';
    await usage.bind(id);
    await sessions.bind(id);
    expect(await replay(craftyLog(id), id)).toBe(1);
    expect(sessions.active).toBeNull();
    const [s] = sessions.list;
    expect(s.id).toBe(T0 + 14_000);
    expect(s.end).toBe(T0 + 100_000);
    expect(s.joined).toBe(false);
    expect(s.background).toBe(true);
    expect(s.readySec).toBe(26);
    expect(s.peak).toBe(180);
    expect(s.batteryStart).toBe(80);
    const detail = (await sessions.detail(s.id))!;
    expect(detail.events.map((e) => e.k)).toEqual(['ready', 'target']);
    expect(detail.ts[0]).toBeLessThan(0);
    expect(detail.c[detail.c.length - 1]).toBeLessThanOrEqual(50);
    expect(detail.g[detail.g.length - 1]).toBeNull();
    // Read again (a replay cut short before it was stored): nothing doubles.
    expect(await replay(craftyLog(id), id)).toBe(0);
    expect(sessions.list).toHaveLength(1);
  });

  it('replays the battery polls of a recording into the session, with the capacity', async () => {
    const id = 'AA:BB:CC:DD:EE:08';
    await usage.bind(id);
    await sessions.bind(id);
    // As the recorder logs them now: battery temperature and remaining capacity among the values,
    // then voltage, current and battery temperature every 5 s with the heater on, each round a P line.
    const lines = craftyHead(id, T0, 0, 300);
    const s0 = lines.indexOf(`${T0} S`);
    lines.splice(s0, 0, `${T0} V ${C.SVC_SYSTEM} ${C.batteryTemp} ${u16(279)}`, `${T0} V ${C.SVC_SYSTEM} ${C.batteryCapacity} ${u16(1931)}`);
    const log = craftyLog(id).split('\n').filter((l) => !l.includes(' V ') && !l.includes(' B ') && l !== `${T0} S`);
    const body = [...log];
    for (let sec = 15; sec <= 95; sec += 5) {
      const t = T0 + sec * 1000 + 300;
      body.push(
        `${t} R ${C.SVC_SYSTEM} ${C.batteryVoltage} ${u16(3600 - sec * 5)}`,
        `${t + 100} R ${C.SVC_SYSTEM} ${C.batteryCurrent} ${u16(-5000 - sec * 10)}`,
        `${t + 200} R ${C.SVC_SYSTEM} ${C.batteryTemp} ${u16(279 + sec)}`,
        `${t + 300} P`,
      );
    }
    body.push(`${T0 + 45_050} R ${C.SVC_SYSTEM} ${C.batteryCapacity} ${u16(1900)}`);
    body.push(`${T0 + 140_000} R ${C.SVC_SYSTEM} ${C.batteryCapacity} ${u16(1870)}`, `${T0 + 140_100} F`);
    body.sort((a, b) => Number(a.split(' ')[0]) - Number(b.split(' ')[0]));
    expect(await replay([...lines, ...body].join('\n'), id)).toBe(1);
    const [s] = sessions.list;
    expect(s.capStart).toBe(1931);
    expect(s.capEnd).toBe(1870);
    const b = (await sessions.detail(s.id))!.battery!;
    expect(b.ts.filter((t) => t <= 86).length).toBeGreaterThanOrEqual(15);
    // From the polls: the current drains, the battery warms.
    expect(Math.min(...(b.i!.filter((v) => v !== null) as number[]))).toBeLessThanOrEqual(-5800);
    expect(Math.max(...(b.t!.filter((v) => v !== null) as number[]))).toBeGreaterThan(330);
    // The first reading is from the values the recording starts with; the next the mean of that one
    // (14…15.6 s) and the poll at 15.6 s (to 19 s).
    expect(b.v!.slice(0, 2)).toEqual([3900, Math.round((1.6 * 3900 + 3.4 * (3600 - 15 * 5)) / 5)]);
    // The cool-down part, every 30 s: down to 50° in about 50 s here.
    expect(b.ts.filter((t) => t > 86)).toEqual([116]);
  });

  it('replays the 2 s battery polls into 5 s means, with the peak read', async () => {
    const id = 'AA:BB:CC:DD:EE:0B';
    await usage.bind(id);
    await sessions.bind(id);
    // As the recorder logs them now: voltage and current every 2 s, the battery temperature every 5 s.
    // The current switches between -8 A and 0 at each poll from 30 s on.
    const lines = craftyHead(id, T0, 0, 300);
    const log = craftyLog(id).split('\n').filter((l) => !l.includes(' V ') && !l.includes(' B ') && l !== `${T0} S`);
    const body = [...log];
    let n = 0;
    const amps = (sec: number) => (sec < 30 || n % 2 === 0 ? -8000 : 0);
    for (let sec = 16, temp = 0; sec <= 98; sec += 2, n++) {
      const t = T0 + sec * 1000;
      const a = amps(sec);
      body.push(`${t} R ${C.SVC_SYSTEM} ${C.batteryVoltage} ${u16(a ? 3100 : 3550)}`, `${t + 400} R ${C.SVC_SYSTEM} ${C.batteryCurrent} ${u16(a)}`);
      if (sec >= temp) {
        body.push(`${t + 800} R ${C.SVC_SYSTEM} ${C.batteryTemp} ${u16(300 + sec)}`);
        temp = sec + 5;
      }
      body.push(`${t + 900} P`);
    }
    body.sort((a, b) => Number(a.split(' ')[0]) - Number(b.split(' ')[0]));
    expect(await replay([...lines, ...body].join('\n'), id)).toBe(1);
    const [s] = sessions.list;
    const b = (await sessions.detail(s.id))!.battery!;
    // Every 5 s with the heater on, each a mean with its power.
    const on = b.ts.map((t, k) => ({ t, k })).filter(({ t }) => t > 0 && t <= 86);
    expect(on.every(({ k }) => b.w![k] !== null)).toBe(true);
    // From 30 s on (16 s into the session) half the time at -8 A: the means sit between 0 and -8 A.
    // (The last, 85–86 s, is the second up to heater off.)
    const holding = on.filter(({ t }) => t >= 25 && t < 86).map(({ k }) => b.i![k]!);
    expect(Math.max(...holding)).toBeLessThan(-1500);
    expect(Math.min(...holding)).toBeGreaterThan(-6500);
    expect(b.min).toEqual({ i: -8000, w: -24_800 });
    // The cool-down keeps single readings.
    expect(b.w![b.ts.length - 1]).toBeNull();
  });

  it('replays an older recording without battery polls: the battery % and what the refresh read', async () => {
    const id = 'AA:BB:CC:DD:EE:0A';
    await usage.bind(id);
    await sessions.bind(id);
    expect(await replay(craftyLog(id), id)).toBe(1);
    const [s] = sessions.list;
    expect(s.capStart).toBeUndefined();
    const b = (await sessions.detail(s.id))!.battery!;
    expect(b.p[0]).toBe(80);
    expect(b.v?.[0]).toBe(3900);
    expect(b.t).toBeUndefined();
  });

  it('ignores recordings of another device', async () => {
    await sessions.bind('AA:BB:CC:DD:EE:02');
    expect(await replay(craftyLog('AA:BB:CC:DD:EE:09'), 'AA:BB:CC:DD:EE:02')).toBe(0);
    expect(sessions.list).toHaveLength(0);
  });

  it('leaves a session handed to the app open, for the live connection to carry on', async () => {
    const id = 'AA:BB:CC:DD:EE:03';
    await sessions.bind(id);
    const log = craftyLog(id, '').split('\n').filter((l) => Number(l.split(' ')[0]) <= T0 + 60_000);
    await replay([...log, `${T0 + 61_000} E app`].join('\n'), id);
    expect(sessions.active?.id).toBe(T0 + 14_000);
    expect(sessions.active?.end).toBeNull();
  });

  it('carries a session on through a recording made alongside the app off screen, unmarked', async () => {
    const id = 'AA:BB:CC:DD:EE:05';
    await usage.bind(id);
    await sessions.bind(id);
    const live = (sec: number, temp: number) => {
      const d: DeviceState = { kind: 'crafty', model: 'CRAFTY+', minTemp: 40, maxTemp: 210, mode: 'normal', heaterOn: true, targetTemp: 180, currentTemp: temp, settings: {} };
      sessions.observe(d, T0 + sec * 1000);
    };
    for (let sec = 0; sec <= 20; sec += 5) live(sec, 100 + sec * 2);
    // Glow goes off screen; the recorder connects 2 s later, with the heater on, and stops when Glow
    // is back on screen.
    sessions.suspend();
    const lines = craftyHead(id, T0 + 22_000, 0x10, 1450);
    for (let sec = 23; sec <= 60; sec++) lines.push(`${T0 + sec * 1000} N ${C.SVC_CONTROL} ${C.currentTemp} ${u16(1450 + (sec - 22) * 10)}`);
    lines.push(`${T0 + 61_000} E app`);
    expect(await replay(lines.join('\n'), id)).toBe(1);
    live(62, 184);
    await sessions.settled();
    expect(sessions.list).toHaveLength(1);
    expect(sessions.active?.id).toBe(T0);
    expect(sessions.active?.seen).toBe(T0 + 62_000);
    const detail = (await sessions.detail(T0))!;
    expect(detail.events.filter((e) => e.k === 'lost' || e.k === 'back')).toEqual([]);
    expect(detail.ts).toContain(40);
  });

  it('reads a recording closed after a restart as killed, ending at its last line', () => {
    const log = craftyLog('AA:BB:CC:DD:EE:01', '').split('\n').filter((l) => Number(l.split(' ')[0]) <= T0 + 60_000);
    const recs = parseLog([...log, `${T0 + 60_000} E killed`].join('\n'));
    expect(recs).toHaveLength(1);
    expect(recs[0].reason).toBe('killed');
    expect(recs[0].end).toBe(T0 + 60_000);
  });

  it('carries a session on through a kill and the restarted recorder, marked as a drop', async () => {
    const id = 'AA:BB:CC:DD:EE:06';
    await usage.bind(id);
    await sessions.bind(id);
    // Killed 60 s in, while heating; restarted 40 s later, the heater still on, until it cools down.
    const before = craftyLog(id, '').split('\n').filter((l) => Number(l.split(' ')[0]) <= T0 + 60_000);
    const after = craftyHead(id, T0 + 100_000, 0x110, 1800);
    for (let sec = 101; sec <= 130; sec++) after.push(`${T0 + sec * 1000} N ${C.SVC_CONTROL} ${C.currentTemp} ${u16(1800)}`);
    after.push(`${T0 + 131_000} N ${C.SVC_SYSTEM} ${C.status} ${u16(0)}`);
    for (let sec = 133; sec <= 251; sec += 2) after.push(`${T0 + sec * 1000} N ${C.SVC_CONTROL} ${C.currentTemp} ${u16(Math.max(300, 1800 - (sec - 131) * 25))}`);
    after.push(`${T0 + 260_000} E idle`);
    // The restarted recorder closes the cut-off recording before it writes its own.
    const log = [...before, `${T0 + 60_000} E killed`, ...after].join('\n');
    expect(await replay(log, id)).toBe(2);
    expect(sessions.list).toHaveLength(1);
    const [s] = sessions.list;
    expect(s.id).toBe(T0 + 14_000);
    expect(s.end).toBe(T0 + 131_000);
    expect(s.readySec).toBe(26);
    const detail = (await sessions.detail(s.id))!;
    expect(detail.events.filter((e) => e.k === 'lost' || e.k === 'back')).toEqual([
      { t: 46, k: 'lost' },
      { t: 86, k: 'back' },
    ]);
    // Read again: nothing doubles.
    expect(await replay(log, id)).toBe(0);
    expect(sessions.list).toHaveLength(1);
  });

  it('carries on the same way when the cut-off recording was never closed', async () => {
    const id = 'AA:BB:CC:DD:EE:07';
    await usage.bind(id);
    await sessions.bind(id);
    const before = craftyLog(id, '').split('\n').filter((l) => Number(l.split(' ')[0]) <= T0 + 60_000);
    const after = craftyHead(id, T0 + 100_000, 0x110, 1800);
    after.push(`${T0 + 101_000} N ${C.SVC_SYSTEM} ${C.status} ${u16(0)}`, `${T0 + 102_000} E app`);
    expect(await replay([...before, ...after].join('\n'), id)).toBe(2);
    expect(sessions.list).toHaveLength(1);
    expect(sessions.list[0].end).toBe(T0 + 101_000);
  });

  it('turns a VENTY recording into a session, answering its requests from the log', async () => {
    const id = 'AA:BB:CC:DD:EE:04';
    await usage.bind(id);
    await sessions.bind(id);
    const frame = (fields: Record<number, number>) => {
      const out = new Array(20).fill(0);
      for (const [i, v] of Object.entries(fields)) out[Number(i)] = v;
      return hex(out);
    };
    const status = (heater: number, reached: boolean) =>
      frame({ 0: 1, 2: 0x00, 3: 0x80, 4: 1900 & 0xff, 5: 1900 >> 8, 6: 15, 7: 15, 8: 70, 9: 120, 11: heater, 14: reached ? 2 : 0 });
    const firmware = hex([2, 1, ...[...'01.08 '].map((c) => c.charCodeAt(0)), 0, 0, 0, ...[...'01.02 '].map((c) => c.charCodeAt(0)), 0, 0, 0]);
    const lines = [
      `${T0} B ${id} venty S&B VY 123`,
      `${T0} V ${GAP_SERVICE} ${GAP_DEVICE_NAME} ${text('S&B VY 1234567')}`,
      `${T0} V ${QVAP_SERVICE} ${QVAP_CONTROL} ${firmware}`,
      `${T0} V ${QVAP_SERVICE} ${QVAP_CONTROL} ${status(0, false)}`,
      `${T0} V ${QVAP_SERVICE} ${QVAP_CONTROL} ${frame({ 0: 4, 1: 30 })}`,
      `${T0} V ${QVAP_SERVICE} ${QVAP_CONTROL} ${frame({ 0: 6, 2: 5, 5: 1 })}`,
      `${T0} S`,
    ];
    for (let sec = 1; sec <= 90; sec++) {
      lines.push(`${T0 + sec * 1000} N ${QVAP_SERVICE} ${QVAP_CONTROL} ${status(sec >= 5 && sec < 80 ? 1 : 0, sec >= 50 && sec < 80)}`);
    }
    lines.push(`${T0 + 91_000} E lost`);
    expect(await replay(lines.join('\n'), id)).toBe(1);
    const [s] = sessions.list;
    expect(s.id).toBe(T0 + 5000);
    expect(s.end).toBe(T0 + 80_000);
    expect(s.readySec).toBe(45);
    expect(s.target).toBe(190);
    expect(s.live).toBe(false);
  });
});
