/**
 * Canonical category taxonomy for activities. Each activity can have
 * multiple categories (an evening at a brewery = "music" + "nightlife").
 *
 * Categories are derived at API-response time from raw source categories
 * + title + description + venue name via simple keyword matching. Source
 * categories vary wildly (Ticketmaster genres, EventOn taxonomies, iCal
 * CATEGORIES, etc.), so we map them to a unified set the UI can filter on.
 */

export const CATEGORIES = {
  music:     { label: 'Music',       emoji: '🎵' },
  theater:   { label: 'Theater',     emoji: '🎭' },
  family:    { label: 'Family',      emoji: '👨‍👩‍👧' },
  food:      { label: 'Food & Drink', emoji: '🍽' },
  markets:   { label: 'Markets',     emoji: '🛍' },
  sports:    { label: 'Sports',      emoji: '⚽' },
  education: { label: 'Learning',    emoji: '📚' },
  outdoor:   { label: 'Outdoor',     emoji: '🌲' },
  arts:      { label: 'Arts',        emoji: '🎨' },
  community: { label: 'Community',   emoji: '🏛' },
  nightlife: { label: 'Nightlife',   emoji: '🍻' },
  festivals: { label: 'Festivals',   emoji: '🎪' },
  wellness:  { label: 'Wellness',    emoji: '🧘' },
  camps:     { label: 'Camps',       emoji: '🏕' },
  vbs:       { label: 'VBS',         emoji: '⛪' },
  other:     { label: 'Other',       emoji: '✨' },
} as const;

export type CategoryKey = keyof typeof CATEGORIES;

// Order matters — more specific patterns first so an event like
// "Brewery Karaoke" lands in both music + nightlife but not just nightlife.
const RULES: { key: CategoryKey; pattern: RegExp }[] = [
  { key: 'music',     pattern: /\b(music|concert|band|orchestra|symphony|opera|dj |karaoke|open mic|jam session|sing[- ]along|recital|live music|fest.*music)\b/i },
  { key: 'theater',   pattern: /\b(theater|theatre|play|musical|drama|cabaret|stand[- ]?up comedy|comedy show|improv|spoken word)\b/i },
  { key: 'family',    pattern: /\b(famil(y|ies)|kids?|children|baby|babies|toddler|teen|youth|all ages|story[- ]?time)\b/i },
  { key: 'food',      pattern: /\b(food truck|brunch|dinner|lunch|tasting|wine|brewery|brewing|cider|distill|cocktail|chef|cooking class|barbecue|bbq|pizza)\b/i },
  { key: 'markets',   pattern: /\b(market|farmers|vendor|pop[- ]?up|swap meet|flea|craft fair|expo)\b/i },
  { key: 'sports',    pattern: /\b(sports?|athletics?|game|match|tournament|league|clinic|skills?|run\b|race|cycling|hike|hiking|baseball|softball|soccer|football|basketball|volleyball|tennis|pickleball|golf|hockey|swim(ming)?|skat(e|ing)|ski(ing)?|snowboard|climb(ing)?|bowling|martial\s*arts|karate|judo|taekwondo|jiu[- ]?jitsu|workout|fitness|gym)\b/i },
  { key: 'education', pattern: /\b(class|workshop|seminar|lecture|talk|symposium|reading|book club|learn|tutorial|how[- ]to)\b/i },
  { key: 'outdoor',   pattern: /\b(outdoor|park|nature|trail|garden|wildflower|cave|caverns|mountain|river|lake|orchard|farm|skyline drive)\b/i },
  { key: 'arts',      pattern: /\b(art|gallery|exhibit(ion)?|paint|drawing|sculpture|craft|maker|pottery|ceramic|photography|film|movie)\b/i },
  { key: 'community', pattern: /\b(community|civic|town hall|volunteer|fundraiser|charity|neighborhood|meeting|forum)\b/i },
  { key: 'nightlife', pattern: /\b(bar\b|pub|brewery|tavern|cocktail|happy hour|trivia|nightlife|21\+|after dark)\b/i },
  { key: 'festivals', pattern: /\b(festival|fest\b|carnival|jubilee|celebration|fair\b)\b/i },
  { key: 'wellness',  pattern: /\b(yoga|meditation|mindfulness|wellness|breathwork|tai chi|qigong|sound bath)\b/i },
  { key: 'camps',     pattern: /\b(camps?|day[- ]?camp|summer[- ]?camp|overnight[- ]?camp|sleep[- ]?away|camping)\b/i },
  { key: 'vbs',       pattern: /\b(vbs|vacation bible school|bible school|bible camp|christian (day[- ]?)?camp)\b/i },
];

export interface CategorizeInput {
  rawCategories?: string[] | null;
  title?: string | null;
  description?: string | null;
  venueName?: string | null;
}

/**
 * Returns a deduplicated list of canonical category keys for an activity.
 * Always returns at least one entry (`'other'` if nothing matched).
 */
export function categorize(input: CategorizeInput): CategoryKey[] {
  const haystack = [
    ...(input.rawCategories ?? []),
    input.title ?? '',
    input.description ?? '',
    input.venueName ?? '',
  ]
    .filter(Boolean)
    .join(' • ');
  const found = new Set<CategoryKey>();
  for (const { key, pattern } of RULES) {
    if (pattern.test(haystack)) found.add(key);
  }
  // VBS (Vacation Bible School / Christian day camp) is a specialization of
  // camps — anything tagged VBS also surfaces under the broader camps filter.
  if (found.has('vbs')) found.add('camps');
  if (found.size === 0) found.add('other');
  return [...found];
}

export const ALL_CATEGORY_KEYS = Object.keys(CATEGORIES) as CategoryKey[];
