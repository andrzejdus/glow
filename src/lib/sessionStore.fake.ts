import type { Files, Legacy, StoredFile } from './sessionStore';

// Storage for tests that outlives a "killed" Glow: the files (written whole or not at all, as the
// plugin's write-and-rename does) and the Preferences keys.

export interface Disk {
  files: Map<string, string>;
  prefs: Map<string, string>;
  /** Calls left before Glow is killed: every call after that fails. Infinity: never. */
  life: number;
  /** Turns what a file read gives back, to fake a write that did not land as it should. */
  garble?: (data: string) => string;
}

export const disk = (): Disk => ({ files: new Map(), prefs: new Map(), life: Infinity });

function step(d: Disk) {
  if (d.life <= 0) throw new Error('killed');
  d.life--;
}

export function fakeFiles(d: Disk): Files {
  const at = (dev: string, name: string) => `${dev}/${name}`;
  return {
    async read(dev, name) {
      step(d);
      const data = d.files.get(at(dev, name));
      return data === undefined ? null : d.garble ? d.garble(data) : data;
    },
    async write(dev, name, data) {
      step(d);
      d.files.set(at(dev, name), data);
    },
    async remove(dev, names) {
      for (const n of names) {
        step(d);
        d.files.delete(at(dev, n));
      }
    },
    async list() {
      step(d);
      return [...d.files].map(([k, v]): StoredFile => {
        const [dev, name] = k.split('/');
        return { dev, name, bytes: new Blob([v]).size };
      });
    },
  };
}

export function fakeLegacy(d: Disk): Legacy {
  return {
    async keys() {
      step(d);
      return [...d.prefs.keys()];
    },
    async get(key) {
      step(d);
      return d.prefs.get(key) ?? null;
    },
    async remove(key) {
      step(d);
      d.prefs.delete(key);
    },
  };
}
