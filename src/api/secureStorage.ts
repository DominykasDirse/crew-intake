// supabase-js session storage on top of expo-secure-store. SecureStore values are capped
// around 2 KB and a session is larger, so values are split into chunks under key.0, key.1, …
import * as SecureStore from 'expo-secure-store';

const CHUNK = 1800;
const countKey = (key: string) => `${key}.n`;
const chunkKey = (key: string, i: number) => `${key}.${i}`;

export const secureStorage = {
  async getItem(key: string): Promise<string | null> {
    const n = Number((await SecureStore.getItemAsync(countKey(key))) ?? '0');
    if (!n) return null;
    let out = '';
    for (let i = 0; i < n; i++) {
      const part = await SecureStore.getItemAsync(chunkKey(key, i));
      if (part === null) return null;
      out += part;
    }
    return out;
  },
  async setItem(key: string, value: string): Promise<void> {
    const prev = Number((await SecureStore.getItemAsync(countKey(key))) ?? '0');
    const n = Math.ceil(value.length / CHUNK);
    for (let i = 0; i < n; i++) {
      await SecureStore.setItemAsync(chunkKey(key, i), value.slice(i * CHUNK, (i + 1) * CHUNK));
    }
    for (let i = n; i < prev; i++) await SecureStore.deleteItemAsync(chunkKey(key, i));
    await SecureStore.setItemAsync(countKey(key), String(n));
  },
  async removeItem(key: string): Promise<void> {
    const n = Number((await SecureStore.getItemAsync(countKey(key))) ?? '0');
    for (let i = 0; i < n; i++) await SecureStore.deleteItemAsync(chunkKey(key, i));
    await SecureStore.deleteItemAsync(countKey(key));
  },
};
