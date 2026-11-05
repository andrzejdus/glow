import { describe, expect, it } from 'vitest';
import { deviceOf, fileDev, fileStore, legacyName, migrate } from './sessionStore';
import { disk, fakeFiles, fakeLegacy, type Disk } from './sessionStore.fake';
import type { SessionDetail, SessionSummary } from './sessions.svelte';

const MAC = 'C0:FF:EE:00:12:34';

const summary = (id: number): SessionSummary => ({
  id, end: id + 300_000, seen: id + 300_000, joined: false, readySec: 60, target: 190, peak: 191, modes: { normal: 300 }, live: true, spark: [180, 190],
});
const detail = (id: number): SessionDetail => ({ ts: [0, 5, 10], c: [24, 60 + (id % 7), 90], g: [190, 190, 190], events: [{ t: 5, k: 'ready' }] });

/** A log as an older Glow left it in Preferences: two devices, a few sessions each. */
function oldLog(d: Disk) {
  const devs = { [MAC]: [1_700_000_000_000, 1_700_100_000_000, 1_700_200_000_000], 'web/id+x==': [1_700_300_000_000] };
  for (const [dev, ids] of Object.entries(devs)) {
    d.prefs.set(`sessions:${dev}`, JSON.stringify(ids.map(summary)));
    for (const id of ids) d.prefs.set(`session:${dev}:${id}`, JSON.stringify(detail(id)));
  }
  d.prefs.set(`reheats:${MAC}`, '[]');
  d.prefs.set(`usage:${MAC}`, '[{"t":1,"m":2}]');
  d.prefs.set('connection', '{}');
  return devs;
}

/** Everything a fresh Glow reads back for each device. */
async function readAll(d: Disk, devs: Record<string, number[]>) {
  const store = fileStore(fakeFiles(d), fakeLegacy(d));
  const out: Record<string, { list: SessionSummary[]; details: (SessionDetail | null)[] }> = {};
  for (const [dev, ids] of Object.entries(devs)) {
    out[dev] = { list: await store.loadIndex(dev), details: await Promise.all(ids.map((id) => store.loadDetail(dev, id))) };
  }
  return out;
}

const expected = (devs: Record<string, number[]>) =>
  Object.fromEntries(Object.entries(devs).map(([dev, ids]) => [dev, { list: ids.map(summary), details: ids.map(detail) }]));

describe('session store names', () => {
  it('maps the old Preferences keys to a device and a file', () => {
    expect(legacyName(`sessions:${MAC}`)).toEqual({ dev: MAC, name: 'index' });
    expect(legacyName(`session:${MAC}:1700000000000`)).toEqual({ dev: MAC, name: '1700000000000' });
    expect(legacyName(`reheats:${MAC}`)).toBeNull();
    expect(legacyName(`usage:${MAC}`)).toBeNull();
    expect(legacyName('sessions:')).toBeNull();
    expect(legacyName(`session:${MAC}:abc`)).toBeNull();
  });

  it('turns any device id into a safe file name and back', () => {
    for (const dev of [MAC, 'aB3+/x==', '.', '..', 'ünï cödé']) {
      const f = fileDev(dev);
      expect(f).toMatch(/^[A-Za-z0-9_%-]+$/);
      expect(deviceOf(f)).toBe(dev);
    }
  });
});

describe('session store', () => {
  it('moves the log out of Preferences and leaves the other settings there', async () => {
    const d = disk();
    const devs = oldLog(d);
    expect(await readAll(d, devs)).toEqual(expected(devs));
    expect([...d.prefs.keys()].sort()).toEqual(['connection', `reheats:${MAC}`, `usage:${MAC}`]);
    expect(d.files.get(`${fileDev(MAC)}/index`)).toBe(JSON.stringify(devs[MAC].map(summary)));
    expect(d.files.size).toBe(6);
  });

  it('moves nothing twice', async () => {
    const d = disk();
    const devs = oldLog(d);
    await readAll(d, devs);
    const files = new Map(d.files);
    await migrate(fakeFiles(d), fakeLegacy(d));
    expect(d.files).toEqual(files);
    expect(await readAll(d, devs)).toEqual(expected(devs));
  });

  it('loses nothing when Glow is killed at any point of the move', async () => {
    let k = 0;
    for (; ; k++) {
      const d = disk();
      const devs = oldLog(d);
      d.life = k;
      await migrate(fakeFiles(d), fakeLegacy(d)).catch(() => undefined);
      const finished = d.life > 0;
      // Started again: the rest moves, and every session reads back as it was.
      d.life = Infinity;
      expect(await readAll(d, devs)).toEqual(expected(devs));
      expect([...d.prefs.keys()].filter((key) => legacyName(key))).toEqual([]);
      if (finished) break;
    }
    expect(k).toBeGreaterThan(20);
  });

  it('reads the old key meanwhile, while a killed move is not finished', async () => {
    const d = disk();
    const devs = oldLog(d);
    d.life = 9;
    // The move fails part way; the same Glow keeps running and must still find every session.
    const store = fileStore(fakeFiles(d), fakeLegacy(d));
    await new Promise((r) => setTimeout(r));
    d.life = Infinity;
    expect(await store.loadIndex(MAC)).toEqual(devs[MAC].map(summary));
    expect(await Promise.all(devs[MAC].map((id) => store.loadDetail(MAC, id)))).toEqual(devs[MAC].map(detail));
  });

  it('keeps the key when the file does not read back the same, and no file to win over it', async () => {
    const d = disk();
    const devs = oldLog(d);
    d.garble = (s) => s.slice(1);
    const store = fileStore(fakeFiles(d), fakeLegacy(d));
    expect(await store.loadIndex(MAC)).toEqual(devs[MAC].map(summary));
    expect(d.prefs.has(`sessions:${MAC}`)).toBe(true);
    expect(d.files.size).toBe(0);
    expect(await store.loadDetail(MAC, devs[MAC][0])).toEqual(detail(devs[MAC][0]));
  });

  it('lets a file win over the key it came from: Glow writes only files after the move', async () => {
    const d = disk();
    const id = 1_700_000_000_000;
    d.prefs.set(`session:${MAC}:${id}`, JSON.stringify(detail(id)));
    const longer = { ...detail(id), ts: [0, 5, 10, 15], c: [24, 60, 90, 120], g: [190, 190, 190, 190] };
    d.files.set(`${fileDev(MAC)}/${id}`, JSON.stringify(longer));
    const store = fileStore(fakeFiles(d), fakeLegacy(d));
    expect(await store.loadDetail(MAC, id)).toEqual(longer);
    expect(d.prefs.size).toBe(0);
  });

  it('writes in the order it was asked, with what was passed at the time', async () => {
    const d = disk();
    const store = fileStore(fakeFiles(d), fakeLegacy(d));
    const s = detail(1);
    void store.saveDetail(MAC, 1, s);
    s.ts.push(99);
    void store.saveDetail(MAC, 1, { ...s });
    await store.saveIndex(MAC, [summary(1)]);
    expect((await store.loadDetail(MAC, 1))?.ts).toEqual([0, 5, 10, 99]);
  });

  it('throws when a list cannot be read, so it is not saved over', async () => {
    const d = disk();
    d.files.set(`${fileDev(MAC)}/index`, '[{"id":');
    const store = fileStore(fakeFiles(d), fakeLegacy(d));
    await expect(store.loadIndex(MAC)).rejects.toThrow();
    expect(await store.loadIndex('other')).toEqual([]);
  });

  it('removes charts, and a key left behind with them', async () => {
    const d = disk();
    const devs = oldLog(d);
    const [a, b] = devs[MAC];
    const old = d.prefs.get(`session:${MAC}:${a}`);
    d.garble = (s) => (s === old ? s + ' ' : s);
    const store = fileStore(fakeFiles(d), fakeLegacy(d));
    await store.loadIndex(MAC);
    d.garble = undefined;
    expect(d.prefs.has(`session:${MAC}:${a}`)).toBe(true);
    await store.removeDetails(MAC, [a, b]);
    expect(d.prefs.has(`session:${MAC}:${a}`)).toBe(false);
    expect(await store.loadDetail(MAC, a)).toBeNull();
    expect(await store.loadDetail(MAC, b)).toBeNull();
    expect(await store.loadDetail(MAC, devs[MAC][2])).toEqual(detail(devs[MAC][2]));
    expect((await store.files()).map((f) => `${f.dev} ${f.name}`).sort()).toEqual(
      [`${MAC} index`, `${MAC} ${devs[MAC][2]}`, 'web/id+x== 1700300000000', 'web/id+x== index'].sort(),
    );
  });
});
