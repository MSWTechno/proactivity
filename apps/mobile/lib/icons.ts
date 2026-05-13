// Generated placeholder icon for activities without images.
// Pairs a title-hashed background color with a title-keyword-matched emoji
// (falling back to category emoji, then a default star).

import { CATEGORIES, type CategoryKey } from './categories';

// Limited palette tuned to read well on both light and dark backgrounds.
const PLACEHOLDER_COLORS = [
  '#8b5cf6', // violet
  '#3b82f6', // blue
  '#10b981', // emerald
  '#f59e0b', // amber
  '#ec4899', // pink
  '#06b6d4', // cyan
  '#ef4444', // red
  '#84cc16', // lime
  '#f97316', // orange
  '#a855f7', // purple
  '#14b8a6', // teal
  '#eab308', // yellow
] as const;

// Title-keyword rules. Order matters — earlier rules win. More specific
// patterns should appear before more generic ones.
const TITLE_EMOJI_RULES: { pattern: RegExp; emoji: string }[] = [
  { pattern: /\bkaraoke\b/i,                  emoji: '🎤' },
  { pattern: /\btrivia\b/i,                   emoji: '🧠' },
  { pattern: /\bbingo\b/i,                    emoji: '🎱' },
  { pattern: /\bmahjong\b/i,                  emoji: '🀄' },
  { pattern: /\bchess\b/i,                    emoji: '♟️' },
  { pattern: /\bcard\s*game|board\s*game\b/i, emoji: '🎲' },
  { pattern: /\bhik(e|ing)\b/i,               emoji: '🥾' },
  { pattern: /\brun(ning)?\b/i,               emoji: '🏃' },
  { pattern: /\b(?:bicycl(?:e|ing)?|cycl(?:e|ing)|bike|biking)\b/i, emoji: '🚴' },
  { pattern: /\byoga\b/i,                     emoji: '🧘' },
  { pattern: /\bdance|dancing\b/i,            emoji: '💃' },
  { pattern: /\bbrew(ery|ing)\b/i,            emoji: '🍺' },
  { pattern: /\bwine\b/i,                     emoji: '🍷' },
  { pattern: /\bcider\b/i,                    emoji: '🍎' },
  { pattern: /\bcoffee\b/i,                   emoji: '☕' },
  { pattern: /\bbrunch\b/i,                   emoji: '🥞' },
  { pattern: /\bbbq|barbecue\b/i,             emoji: '🍖' },
  { pattern: /\bdinner\b/i,                   emoji: '🍽' },
  { pattern: /\bfood\s*truck\b/i,             emoji: '🚚' },
  { pattern: /\bpizza\b/i,                    emoji: '🍕' },
  { pattern: /\bbaking|baker(y)?\b/i,         emoji: '🥖' },
  { pattern: /\bconcert|live\s*music\b/i,     emoji: '🎶' },
  { pattern: /\bopen\s*mic|jam\s*session\b/i, emoji: '🎙️' },
  { pattern: /\bmusic|band\b/i,               emoji: '🎵' },
  { pattern: /\btheater|theatre|play\b/i,     emoji: '🎭' },
  { pattern: /\bcomedy|stand[- ]?up\b/i,      emoji: '🎤' },
  { pattern: /\bmovie|film|cinema\b/i,        emoji: '🎬' },
  { pattern: /\bart\b|gallery|exhibit/i,      emoji: '🎨' },
  { pattern: /\bmuseum\b/i,                   emoji: '🏛' },
  { pattern: /\bbook|read(ing)?\b/i,          emoji: '📚' },
  { pattern: /\bstory\s*time\b/i,             emoji: '📖' },
  { pattern: /\bfarmer'?s?\s*market|market\b/i, emoji: '🛒' },
  { pattern: /\bcraft\s*fair\b/i,             emoji: '🧶' },
  { pattern: /\bgarden|orchard|flower/i,      emoji: '🌷' },
  { pattern: /\bnational\s*park|park\b/i,     emoji: '🌲' },
  { pattern: /\bcave|cavern/i,                emoji: '🕳' },
  { pattern: /\bfestival|fest\b/i,            emoji: '🎪' },
  { pattern: /\bfundraiser|charity\b/i,       emoji: '💝' },
  { pattern: /\bworkshop|class\b/i,           emoji: '🛠' },
  { pattern: /\btalk|lecture|seminar\b/i,     emoji: '🗣' },
  { pattern: /\bbaby|toddler|kids?\b/i,       emoji: '👶' },
  { pattern: /\bdog\b|puppy/i,                emoji: '🐶' },
  { pattern: /\bhalloween|spooky|horror/i,    emoji: '🎃' },
  { pattern: /\bchristmas|holiday|santa/i,    emoji: '🎄' },
  { pattern: /\bvalentine|love\b/i,           emoji: '💖' },
];

function hashString(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

export function colorForTitle(title: string): string {
  if (!title) return PLACEHOLDER_COLORS[0]!;
  return PLACEHOLDER_COLORS[hashString(title) % PLACEHOLDER_COLORS.length]!;
}

function emojiFromText(text: string | null | undefined): string | null {
  if (!text) return null;
  for (const rule of TITLE_EMOJI_RULES) {
    if (rule.pattern.test(text)) return rule.emoji;
  }
  return null;
}

export function emojiForTitle(title: string): string | null {
  return emojiFromText(title);
}

/**
 * Deterministic placeholder for an event without an image. Tries:
 *   1. Title keywords ("Karaoke" → 🎤)
 *   2. Venue keywords  ("Brewery" → 🍻)
 *   3. Organizer keywords
 *   4. First non-"other" category emoji
 *   5. Default star ✨
 * Color is hashed from the title so the same event always renders the
 * same color across sessions.
 */
export function placeholderFor(input: {
  title: string;
  venueName?: string | null;
  organizerName?: string | null;
  canonicalCategories?: CategoryKey[];
}): { emoji: string; color: string } {
  const titleEmoji = emojiFromText(input.title);
  const venueEmoji = emojiFromText(input.venueName);
  const organizerEmoji = emojiFromText(input.organizerName);
  const firstCat = input.canonicalCategories?.find((k) => k !== 'other') as CategoryKey | undefined;
  const categoryEmoji = firstCat ? CATEGORIES[firstCat].emoji : null;
  return {
    emoji: titleEmoji ?? venueEmoji ?? organizerEmoji ?? categoryEmoji ?? '✨',
    color: colorForTitle(input.title),
  };
}
