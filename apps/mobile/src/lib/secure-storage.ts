import * as SecureStore from 'expo-secure-store';

/**
 * Supabase auth storage adapter backed by the iOS Keychain / Android Keystore.
 * Sessions (JWT + refresh token) can exceed SecureStore's recommended ~2KB value size, so values
 * are split into chunks. Tokens never touch plain AsyncStorage.
 */
const CHUNK = 1800;
const countKey = (key: string) => `${key}.chunks`;
const chunkKey = (key: string, i: number) => `${key}.${i}`;
const safe = (key: string) => key.replace(/[^A-Za-z0-9._-]/g, '_');

export const secureStorage = {
  async getItem(rawKey: string): Promise<string | null> {
    const key = safe(rawKey);
    const n = Number(await SecureStore.getItemAsync(countKey(key)));
    if (!n) return null;
    const parts: string[] = [];
    for (let i = 0; i < n; i++) {
      const part = await SecureStore.getItemAsync(chunkKey(key, i));
      if (part == null) return null;
      parts.push(part);
    }
    return parts.join('');
  },
  async setItem(rawKey: string, value: string): Promise<void> {
    const key = safe(rawKey);
    await this.removeItem(rawKey);
    const n = Math.ceil(value.length / CHUNK);
    for (let i = 0; i < n; i++) {
      await SecureStore.setItemAsync(chunkKey(key, i), value.slice(i * CHUNK, (i + 1) * CHUNK));
    }
    await SecureStore.setItemAsync(countKey(key), String(n));
  },
  async removeItem(rawKey: string): Promise<void> {
    const key = safe(rawKey);
    const n = Number(await SecureStore.getItemAsync(countKey(key)));
    for (let i = 0; i < n; i++) await SecureStore.deleteItemAsync(chunkKey(key, i));
    await SecureStore.deleteItemAsync(countKey(key));
  },
};
