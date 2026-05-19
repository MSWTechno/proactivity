// Infer an age range for an activity from its title / description.
// Falls back to explicit ageMin/ageMax from the DB if the adapter set them.
// Mirrors apps/mobile/lib/age.ts.

export interface AgeRange {
  min: number | null;
  max: number | null;
  /** Short label for UI. */
  label: string;
}

export function inferAgeRange(input: {
  title?: string | null;
  description?: string | null;
  ageMin?: number | null;
  ageMax?: number | null;
}): AgeRange | null {
  // 1. Trust DB values if either is set.
  if (input.ageMin != null || input.ageMax != null) {
    return formatRange(input.ageMin, input.ageMax);
  }

  const text = `${input.title ?? ''} ${input.description ?? ''}`;

  // 2. Explicit "N+" patterns: "21+", "18+", "13+", "must be 21".
  const plus = text.match(/\b(\d{1,2})\s*\+/);
  if (plus) {
    const n = parseInt(plus[1]!, 10);
    if (n >= 5 && n <= 99) return { min: n, max: null, label: `${n}+` };
  }
  const mustBe = text.match(/\bmust be (?:at least )?(\d{1,2})\b/i);
  if (mustBe) {
    const n = parseInt(mustBe[1]!, 10);
    if (n >= 5 && n <= 99) return { min: n, max: null, label: `${n}+` };
  }

  // 3a. Grade ranges first: "grades 7-12", "grade 7th-12th".
  //     Approximate grade-to-age: age = grade + 5 (US K-12 convention).
  //     Catch before the generic-range rule so "grades 7-12" doesn't get
  //     misread as "ages 7-12".
  const gradeRange = text.match(/\bgrades?\s+(\d{1,2})(?:st|nd|rd|th)?\s*[-–]\s*(\d{1,2})(?:st|nd|rd|th)?\b/i);
  if (gradeRange) {
    const gLo = parseInt(gradeRange[1]!, 10);
    const gHi = parseInt(gradeRange[2]!, 10);
    if (gLo >= 0 && gHi <= 12 && gLo < gHi) {
      return { min: gLo + 5, max: gHi + 6, label: `Grades ${gLo}–${gHi}` };
    }
  }

  // 3b. Explicit age ranges. Require either an "ages" prefix OR a unit
  //     suffix ("years", "y.o.", "months") — otherwise bare "7-12" in a
  //     description could mean ounces, dollars, or anything else.
  const prefixed = text.match(/\bages?\s+(\d{1,2})\s*[-–]\s*(\d{1,2})\b/i);
  const suffixed = text.match(/\b(\d{1,2})\s*[-–]\s*(\d{1,2})\s+(?:yr|year|years|y\.o\.|months?)\b/i);
  const range = prefixed ?? suffixed;
  if (range) {
    const lo = parseInt(range[1]!, 10);
    const hi = parseInt(range[2]!, 10);
    if (lo < hi && hi <= 99 && lo >= 0) {
      return { min: lo, max: hi, label: `Ages ${lo}–${hi}` };
    }
  }

  // 4. Keyword rules — most specific first.
  const lower = text.toLowerCase();
  if (/\b(?:babies|baby|infant|newborn|0[- ]?12\s*months)\b/.test(lower)) return { min: 0, max: 1, label: 'Babies' };
  if (/\b(?:toddler|preschool|pre[- ]?k)\b/.test(lower)) return { min: 2, max: 4, label: 'Toddlers' };
  if (/\b(?:elementary|school[- ]aged?)\b/.test(lower)) return { min: 5, max: 11, label: 'Kids 5–11' };
  if (/\b(?:teens?|teenagers?|tweens?)\b/.test(lower)) return { min: 12, max: 19, label: 'Teens' };
  if (/\b(?:adults? only|21\s*and\s*(?:up|over)|adults?[- ]only)\b/.test(lower)) return { min: 21, max: null, label: '21+' };
  if (/\bkids?|children\b/.test(lower)) return { min: 0, max: 12, label: 'Kids' };
  if (/\b(?:all[- ]ages|family[- ]friendly|families)\b/.test(lower)) return { min: null, max: null, label: 'All ages' };
  if (/\b(?:adult|grown[- ]ups?)\b/.test(lower) && !/young adult/.test(lower)) return { min: 18, max: null, label: 'Adults' };

  return null;
}

function formatRange(min: number | null | undefined, max: number | null | undefined): AgeRange {
  const lo = min ?? null;
  const hi = max ?? null;
  let label: string;
  if (lo != null && hi != null) label = `Ages ${lo}–${hi}`;
  else if (lo != null) label = `${lo}+`;
  else if (hi != null) label = `Up to ${hi}`;
  else label = 'All ages';
  return { min: lo, max: hi, label };
}
