// Mirrors apps/web/lib/categories.ts. Both should be extracted to a shared
// package eventually, but duplication is fine while the surface is small.

export const CATEGORIES = {
  music:     { label: 'Music',        emoji: '🎵' },
  theater:   { label: 'Theater',      emoji: '🎭' },
  family:    { label: 'Family',       emoji: '👨‍👩‍👧' },
  food:      { label: 'Food & Drink', emoji: '🍽' },
  markets:   { label: 'Markets',      emoji: '🛍' },
  sports:    { label: 'Sports',       emoji: '⚽' },
  education: { label: 'Learning',     emoji: '📚' },
  outdoor:   { label: 'Outdoor',      emoji: '🌲' },
  arts:      { label: 'Arts',         emoji: '🎨' },
  community: { label: 'Community',    emoji: '🏛' },
  nightlife: { label: 'Nightlife',    emoji: '🍻' },
  festivals: { label: 'Festivals',    emoji: '🎪' },
  wellness:  { label: 'Wellness',     emoji: '🧘' },
  other:     { label: 'Other',        emoji: '✨' },
} as const;

export type CategoryKey = keyof typeof CATEGORIES;
export const ALL_CATEGORY_KEYS = Object.keys(CATEGORIES) as CategoryKey[];
