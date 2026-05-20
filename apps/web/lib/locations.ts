/**
 * Shared location presets — used by:
 *  - the homepage location picker (apps/web/app/page.tsx)
 *  - the public events API (apps/web/app/api/public/events/route.ts)
 *    so partners can pass ?location=lake-anna instead of raw lat/lng
 *
 * Keep this list small and curated. Each preset is a destination users
 * actually want to browse around — not just "any city we have data for".
 */

export const LOCATION_PRESETS = [
  { id: 'harrisonburg', label: 'Harrisonburg, VA', lat: 38.4496, lng: -78.8689 },
  { id: 'lake-anna',    label: 'Lake Anna, VA',    lat: 37.989,  lng: -77.886  },
] as const;

export type LocationPresetId = (typeof LOCATION_PRESETS)[number]['id'];

export function findPreset(id: string): typeof LOCATION_PRESETS[number] | null {
  return LOCATION_PRESETS.find((p) => p.id === id) ?? null;
}
