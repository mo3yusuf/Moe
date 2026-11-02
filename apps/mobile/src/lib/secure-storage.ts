import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/**
 * Supabase session storage backed by the iOS Keychain / Android Keystore.
 * SecureStore values are limited to ~2 KB, so long session payloads are split
 * into chunks. On web (development only) falls back to localStorage.
 */
const CHUNK = 1800;

const web = {
  getItem: async (k: string) => (typeof localStorage === 'undefined' ? null : localStorage.getItem(k)),
  setItem: async (k: string, v: string) => {
    if (typeof localStorage !== 'undefined') localStorage.setItem(k, v);
  },
  removeItem: async (k: string) => {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(k);
  },
};

const safeKey = (k: string) => k.replace(/[^A-Za-z0-9._-]/g, '_');

const native = {
  async getItem(key: string): Promise<string | null> {
    const k = safeKey(key);
    const count = await SecureStore.getItemAsync(`${k}__n`);
    if (count === null) return null;
    const parts: string[] = [];
    for (let i = 0; i < Number(count); i++) {
      const part = await SecureStore.getItemAsync(`${k}__${i}`);
      if (part === null) return null;
      parts.push(part);
    }
    return parts.join('');
  },
  async setItem(key: string, value: string): Promise<void> {
    const k = safeKey(key);
    await native.removeItem(key);
    const n = Math.ceil(value.length / CHUNK);
    for (let i = 0; i < n; i++) await SecureStore.setItemAsync(`${k}__${i}`, value.slice(i * CHUNK, (i + 1) * CHUNK));
    await SecureStore.setItemAsync(`${k}__n`, String(n));
  },
  async removeItem(key: string): Promise<void> {
    const k = safeKey(key);
    const count = await SecureStore.getItemAsync(`${k}__n`);
    if (count !== null) for (let i = 0; i < Number(count); i++) await SecureStore.deleteItemAsync(`${k}__${i}`);
    await SecureStore.deleteItemAsync(`${k}__n`);
  },
};

export const secureStorage = Platform.OS === 'web' ? web : native;
