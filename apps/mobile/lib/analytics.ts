/**
 * Lightweight GA4 analytics for the app via the Measurement Protocol — no
 * native SDK, so it ships over-the-air with no rebuild. Events POST to GA4's
 * /mp/collect endpoint and land in the same Google Analytics property as the
 * website (tagged platform: ios|android so you can split app vs web).
 *
 * Config (app.json -> expo.extra): gaMeasurementId ("G-XXXXXXX") + gaApiSecret
 * (created in GA4 Admin -> Data Streams -> [stream] -> Measurement Protocol API
 * secrets). If either is missing, every call is a no-op.
 *
 * Best-effort: failures are swallowed; analytics must never break the app.
 */
import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

const extra = (Constants.expoConfig?.extra ?? {}) as {
  gaMeasurementId?: string;
  gaApiSecret?: string;
};
const MEASUREMENT_ID = extra.gaMeasurementId;
const API_SECRET = extra.gaApiSecret;
const ENABLED = Boolean(MEASUREMENT_ID && API_SECRET);

const CLIENT_ID_KEY = 'proactivity:ga_client_id:v1';
// One session id per app launch — GA4 needs session_id + engagement_time_msec
// on each event to attribute sessions/engagement.
const SESSION_ID = String(Date.now());

let clientIdPromise: Promise<string> | null = null;

function uuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// Stable per-install id so GA4 counts users correctly across launches.
async function getClientId(): Promise<string> {
  if (!clientIdPromise) {
    clientIdPromise = (async () => {
      try {
        const existing = await AsyncStorage.getItem(CLIENT_ID_KEY);
        if (existing) return existing;
        const id = uuid();
        await AsyncStorage.setItem(CLIENT_ID_KEY, id);
        return id;
      } catch {
        return uuid();
      }
    })();
  }
  return clientIdPromise;
}

type Params = Record<string, string | number | boolean>;

export async function logEvent(name: string, params: Params = {}): Promise<void> {
  if (!ENABLED) return;
  try {
    const clientId = await getClientId();
    const body = {
      client_id: clientId,
      events: [
        {
          name,
          params: {
            session_id: SESSION_ID,
            engagement_time_msec: 100,
            platform: Platform.OS,
            ...params,
          },
        },
      ],
    };
    await fetch(
      `https://www.google-analytics.com/mp/collect?measurement_id=${MEASUREMENT_ID}&api_secret=${API_SECRET}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
    );
  } catch {
    /* best-effort */
  }
}

/** Convenience: a GA4 screen_view. */
export function logScreenView(screenName: string): void {
  void logEvent('screen_view', { screen_name: screenName });
}
