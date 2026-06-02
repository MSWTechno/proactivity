/**
 * Location presets for the mobile location picker — the app counterpart to
 * the website's picker. Mirrors `apps/web/lib/locations.ts`; keep the two in
 * sync (id/label/lat/lng). Like the categories map, this is intentionally
 * duplicated rather than shared via a package — if you add a preset on the
 * web, add it here too.
 */

export interface LocationPreset {
  id: string;
  label: string;
  lat: number;
  lng: number;
}

export const LOCATION_PRESETS: LocationPreset[] = [
  { id: 'harrisonburg', label: 'Harrisonburg, VA', lat: 38.4496, lng: -78.8689 },
  { id: 'lake-anna', label: 'Lake Anna, VA', lat: 37.989, lng: -77.886 },
  { id: 'cape-charles', label: 'Cape Charles, VA', lat: 37.2682, lng: -76.0152 },
  { id: 'yosemite', label: 'Yosemite, CA', lat: 37.8651, lng: -119.5383 },
];
