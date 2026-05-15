import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';

const STORAGE_KEY = 'proactivity:session:v1';

export const API_BASE = (Constants.expoConfig?.extra as { apiBaseUrl?: string } | undefined)?.apiBaseUrl
  ?? 'https://proactivity-web.vercel.app';

export interface MeUser {
  id: string;
  email: string;
  name: string | null;
}

interface StoredSession {
  token: string;
  user: MeUser;
}

let inMemorySession: StoredSession | null = null;

export async function loadStoredSession(): Promise<StoredSession | null> {
  if (inMemorySession) return inMemorySession;
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredSession;
    if (!parsed.token || !parsed.user?.id) return null;
    inMemorySession = parsed;
    return parsed;
  } catch {
    return null;
  }
}

export async function saveSession(session: StoredSession): Promise<void> {
  inMemorySession = session;
  try { await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(session)); } catch { /* ignore */ }
}

export async function clearSession(): Promise<void> {
  inMemorySession = null;
  try { await AsyncStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
}

/**
 * Trade a magic-link token (carried in the proactivity://auth/verify deep
 * link) for a long-lived session token. Returns the user + session on
 * success.
 */
export async function exchangeMagicLink(magicToken: string): Promise<StoredSession> {
  const res = await fetch(`${API_BASE}/api/auth/exchange`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: magicToken }),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error ?? `HTTP ${res.status}`);
  }
  const data = (await res.json()) as { sessionToken: string; user: MeUser };
  const session: StoredSession = { token: data.sessionToken, user: data.user };
  await saveSession(session);
  return session;
}

/**
 * Request a magic link email for the given address. The user picks up the
 * link in their inbox; tapping the "Open in app" link returns to the app
 * via the proactivity:// deep link.
 */
export async function requestMagicLink(email: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error ?? `HTTP ${res.status}`);
  }
}

/**
 * Fetch wrapper that attaches the bearer token when a session exists.
 */
export async function authFetch(path: string, init?: RequestInit): Promise<Response> {
  const session = await loadStoredSession();
  const headers = new Headers(init?.headers);
  if (session) headers.set('Authorization', `Bearer ${session.token}`);
  if (init?.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  return fetch(`${API_BASE}${path}`, { ...init, headers });
}

/**
 * Parse the magic-link token out of a deep link URL like
 * `proactivity://auth/verify?token=...`. Returns null if no token found.
 */
export function tokenFromDeepLink(url: string): string | null {
  try {
    const u = new URL(url);
    if (!u.pathname.includes('verify') && !u.hostname.includes('verify')) return null;
    return u.searchParams.get('token');
  } catch {
    return null;
  }
}
