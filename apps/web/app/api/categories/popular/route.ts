import { NextResponse } from 'next/server';
import { sql } from '@proactivity/db';
import { ALL_CATEGORY_KEYS, type CategoryKey } from '@/lib/categories';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/categories/popular
 * Returns category keys ordered by aggregate click count (most-clicked first).
 * Categories that have never been clicked appear after the popular ones,
 * in their canonical order.
 */
export async function GET() {
  const rows = (await sql`
    SELECT key, count FROM category_clicks ORDER BY count DESC, key ASC
  `) as unknown as { key: string; count: number }[];

  const popular = rows
    .map((r) => r.key)
    .filter((k): k is CategoryKey => (ALL_CATEGORY_KEYS as readonly string[]).includes(k));
  const popularSet = new Set<CategoryKey>(popular);
  const rest = ALL_CATEGORY_KEYS.filter((k) => !popularSet.has(k));

  return NextResponse.json(
    { ordered: [...popular, ...rest] satisfies CategoryKey[] },
    { headers: { 'cache-control': 'public, max-age=30' } },
  );
}
