import { Preferences } from '@capacitor/preferences';

export async function load<T>(key: string, fallback: T): Promise<T> {
  try {
    const { value } = await Preferences.get({ key });
    return value === null ? fallback : (JSON.parse(value) as T);
  } catch {
    return fallback;
  }
}

export async function save(key: string, value: unknown): Promise<void> {
  try {
    await Preferences.set({ key, value: JSON.stringify(value) });
  } catch {
    // Storage is a convenience; the app keeps working without it.
  }
}

/** The stored text as it is, null when there is none; errors are the caller's. */
export async function loadRaw(key: string): Promise<string | null> {
  return (await Preferences.get({ key })).value;
}

export async function saveRaw(key: string, value: string): Promise<void> {
  await Preferences.set({ key, value });
}

export async function remove(key: string): Promise<void> {
  await Preferences.remove({ key });
}

export async function keys(): Promise<string[]> {
  return (await Preferences.keys()).keys;
}
