import { describe, expect, it } from 'vitest';
import { CRAFTY_UUIDS as C } from './devices/crafty';
import { GAP_DEVICE_NAME, GAP_SERVICE, QVAP_CONTROL, QVAP_SERVICE } from './devices/qvap';
import { parseLog, replay } from './replay';
import { sessions } from './sessions.svelte';
import { usage } from './usage.svelte';

// Logs as android/.../Recorder.java writes them.

const T0 = new Date(2026, 9, 24, 12, 0, 0).getTime();

const hex = (bytes: number[]) => bytes.map((b) => (b & 0xff).toString(16).padStart(2, '0')).join('');
const u16 = (v: number) => hex([v & 0xff, v >> 8]);
const text = (s: string) => hex([...s].map((c) => c.charCodeAt(0)));

/** A CRAFTY+ that was off, comes on 14 s in, gets ready at 40 s, goes off at 100 s and cools down. */
function craftyLog(id: string, end = 'idle') {
  const lines: string[] = [`${T0} B ${id} crafty Storz&Bickel`];
  const v = (svc: string, chr: string, value: string) => lines.push(`${T0} V ${svc} ${chr} ${value}`);
  v(C.SVC_CONTROL, C.targetTemp, u16(1800));
  v(C.SVC_INFO, C.serial, text('CY123456'));
  v(C.SVC_CONTROL, C.currentTemp, u16(300));
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
  v(C.SVC_SYSTEM, C.status, u16(0));
  v(C.SVC_SYSTEM, C.batteryStatus, u16(0));
  lines.push(`${T0} S`);
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
