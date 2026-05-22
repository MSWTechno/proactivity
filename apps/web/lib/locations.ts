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
  {
    id: 'harrisonburg',
    label: 'Harrisonburg, VA',
    lat: 38.4496,
    lng: -78.8689,
    // SEO-friendly slug used in URLs like /things-to-do/harrisonburg-va.
    // Distinct from `id` (kept short for the homepage picker and API).
    seoSlug: 'harrisonburg-va',
    seoCity: 'Harrisonburg',
    seoRegion: 'VA',
  },
  {
    id: 'lake-anna',
    label: 'Lake Anna, VA',
    lat: 37.989,
    lng: -77.886,
    seoSlug: 'lake-anna-va',
    seoCity: 'Lake Anna',
    seoRegion: 'VA',
  },
] as const;

export type LocationPresetId = (typeof LOCATION_PRESETS)[number]['id'];
export type LocationPreset = (typeof LOCATION_PRESETS)[number];

export function findPreset(id: string): LocationPreset | null {
  return LOCATION_PRESETS.find((p) => p.id === id) ?? null;
}

/** Look up by the SEO slug (e.g. "harrisonburg-va"). */
export function findPresetBySeoSlug(slug: string): LocationPreset | null {
  return LOCATION_PRESETS.find((p) => p.seoSlug === slug) ?? null;
}
