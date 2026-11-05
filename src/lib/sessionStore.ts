import { Capacitor, registerPlugin } from '@capacitor/core';
import * as prefs from './prefs';
import type { SessionDetail, SessionSummary } from './sessions.svelte';

// Where the session log is kept. On Android: a file per device for its list of sessions and a file
// per session for its chart (android/.../SessionFilesPlugin.java), in the app's private storage.
// Glow used to keep both in Capacitor's Preferences, which Android keeps in one file and rewrites
// whole on every change: a few MB after a year, every few seconds during a session. In a browser
// the log stays in Preferences (localStorage), under the same keys as before.

/** One stored file: a device's list ("index") or one session's chart (its id), with its size. */
export interface StoredFile {
  dev: string;
  name: string;
  bytes: number;
}

export interface SessionStore {
  /** Throws when the list cannot be read, so it is not saved over with an empty one. */
  loadIndex(dev: string): Promise<SessionSummary[]>;
  saveIndex(dev: string, list: SessionSummary[]): Promise<void>;
  loadDetail(dev: string, id: number): Promise<SessionDetail | null>;
  saveDetail(dev: string, id: number, detail: SessionDetail): Promise<void>;
  removeDetails(dev: string, ids: number[]): Promise<void>;
  files(): Promise<StoredFile[]>;
}

export const INDEX = 'index';

/** Text files by device and name: the native plugin, or a fake in tests. */
export interface Files {
  read(dev: string, name: string): Promise<string | null>;
  write(dev: string, name: string, data: string): Promise<void>;
  remove(dev: string, names: string[]): Promise<void>;
  list(): Promise<StoredFile[]>;
}

/** Where the log was before: Preferences, as text. */
export interface Legacy {
  keys(): Promise<string[]>;
  get(key: string): Promise<string | null>;
  remove(key: string): Promise<void>;
}

const indexKey = (dev: string) => `sessions:${dev}`;
const detailKey = (dev: string, id: number | string) => `session:${dev}:${id}`;

/** The device and file name an old Preferences key moves to; null for other keys. */
export function legacyName(key: string): { dev: string; name: string } | null {
  if (key.startsWith('sessions:')) return key.length > 9 ? { dev: key.slice(9), name: INDEX } : null;
  if (!key.startsWith('session:')) return null;
  const at = key.lastIndexOf(':');
  const id = key.slice(at + 1);
  return at > 8 && /^\d+$/.test(id) ? { dev: key.slice(8, at), name: id } : null;
}

/**
 * Moves the log out of Preferences: each key is written to its file, read back, and removed only
 * once the file holds the same text. Killed at any point, nothing is lost: a key still there is
 * moved again next time, and readers look in both places meanwhile. A file that is already there
 * wins over its key: Glow writes only files once this has run, and what it wrote started from the
 * key, so the file holds as much or more. Returns the keys left behind (a file that read back wrong).
 */
export async function migrate(files: Files, legacy: Legacy): Promise<Set<string>> {
  const left = new Set<string>();
  for (const key of await legacy.keys()) {
    const to = legacyName(key);
    if (!to) continue;
    try {
      const value = await legacy.get(key);
      if (value === null) continue;
      const dev = fileDev(to.dev);
      if ((await files.read(dev, to.name)) === null) {
        await files.write(dev, to.name, value);
        if ((await files.read(dev, to.name)) !== value) {
          // Leave the key to the readers, and no file that would win over it next time.
          await files.remove(dev, [to.name]).catch(() => undefined);
          left.add(key);
          continue;
        }
      }
      await legacy.remove(key);
    } catch {
      left.add(key);
    }
  }
  return left;
}

/** The log in files, moved there from `legacy` first. Calls run one at a time, in order. */
export function fileStore(files: Files, legacy: Legacy | null): SessionStore {
  // The keys still in Preferences; null until the move has gone through them all, so readers look there too.
  let left: Set<string> | null = null;
  let queue: Promise<unknown> = legacy ? migrate(files, legacy).then((l) => (left = l), () => undefined) : Promise.resolve();
  const run = <T>(job: () => Promise<T>): Promise<T> => {
    const next = queue.then(job);
    queue = next.catch(() => undefined);
    return next;
  };
  /** A file, or the key it has not moved from yet. */
  const read = async (dev: string, name: string, key: string): Promise<string | null> => {
    const data = await files.read(dev, name);
    if (data !== null || !legacy || (left && !left.has(key))) return data;
    return legacy.get(key);
  };
  const write = (dev: string, name: string, value: unknown) => {
    // Turned into text now: the caller's object may change before the queue gets to it.
    const data = JSON.stringify(value);
    return run(() => files.write(dev, name, data)).catch(() => undefined);
  };
  return {
    loadIndex: (dev) => run(async () => JSON.parse((await read(fileDev(dev), INDEX, indexKey(dev))) ?? '[]') as SessionSummary[]),
    saveIndex: (dev, list) => write(fileDev(dev), INDEX, list),
    loadDetail: (dev, id) =>
      run(async () => {
        const data = await read(fileDev(dev), String(id), detailKey(dev, id));
        return data === null ? null : (JSON.parse(data) as SessionDetail);
      }).catch(() => null),
    saveDetail: (dev, id, detail) => write(fileDev(dev), String(id), detail),
    removeDetails: (dev, ids) =>
      run(async () => {
        if (!ids.length) return;
        await files.remove(fileDev(dev), ids.map(String));
        for (const id of ids) {
          const key = detailKey(dev, id);
          if (legacy && (!left || left.delete(key))) await legacy.remove(key).catch(() => undefined);
        }
      }),
    files: () => run(async () => (await files.list()).map((f) => ({ ...f, dev: deviceOf(f.dev) }))),
  };
}

/** The log in Preferences, as it always was in a browser. */
export function prefsStore(): SessionStore {
  return {
    loadIndex: (dev) => prefs.load<SessionSummary[]>(indexKey(dev), []),
    saveIndex: (dev, list) => prefs.save(indexKey(dev), list),
    loadDetail: (dev, id) => prefs.load<SessionDetail | null>(detailKey(dev, id), null),
    saveDetail: (dev, id, detail) => prefs.save(detailKey(dev, id), detail),
    async removeDetails(dev, ids) {
      for (const id of ids) await prefs.remove(detailKey(dev, id));
    },
    async files() {
      const out: StoredFile[] = [];
      for (const key of await prefs.keys()) {
        const to = legacyName(key);
        const data = to && (await prefs.loadRaw(key));
        if (to && data !== null) out.push({ ...to, bytes: new Blob([data]).size });
      }
      return out;
    },
  };
}

/**
 * A device's address as a file name: letters, digits, - and _ as they are, the rest (the colons of
 * a Bluetooth address, a browser's base64 id) as %XX, so it is never "." or ".." and reads back.
 */
export function fileDev(dev: string): string {
  return encodeURIComponent(dev).replace(/[.!~*'()]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

export function deviceOf(file: string): string {
  try {
    return decodeURIComponent(file);
  } catch {
    return file;
  }
}

interface SessionFilesPlugin {
  read(options: { dev: string; name: string }): Promise<{ data?: string }>;
  write(options: { dev: string; name: string; data: string }): Promise<void>;
  remove(options: { dev: string; names: string[] }): Promise<void>;
  list(): Promise<{ files: StoredFile[] }>;
}

function nativeFiles(): Files {
  const plugin = registerPlugin<SessionFilesPlugin>('SessionFiles');
  return {
    read: async (dev, name) => (await plugin.read({ dev, name })).data ?? null,
    write: (dev, name, data) => plugin.write({ dev, name, data }),
    remove: (dev, names) => plugin.remove({ dev, names }),
    list: async () => (await plugin.list()).files,
  };
}

const prefsLegacy: Legacy = { keys: () => prefs.keys(), get: (key) => prefs.loadRaw(key), remove: (key) => prefs.remove(key) };

export const sessionStore: SessionStore = Capacitor.isNativePlatform() ? fileStore(nativeFiles(), prefsLegacy) : prefsStore();
