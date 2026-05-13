// One-shot backfill: set is_virtual=true on existing rows whose stored
// raw JSON-LD payload indicates a virtual event. Run via:
//   pnpm --filter @proactivity/db exec tsx --env-file=../../.env src/backfill-is-virtual.ts
//
// Idempotent — safe to re-run.

import { sql } from './client.js';

const result = (await sql`
  UPDATE activities
  SET is_virtual = true
  WHERE is_virtual = false
    AND (
      (raw->>'eventAttendanceMode') ILIKE '%OnlineEventAttendanceMode%'
      OR (raw->>'eventAttendanceMode') ILIKE '%MixedEventAttendanceMode%'
      OR (raw#>>'{location,@type}') = 'VirtualLocation'
    )
  RETURNING id, title
`) as unknown as { id: string; title: string }[];

console.log(`Marked ${result.length} activities as virtual:`);
for (const r of result) console.log(`  - ${r.title}`);

await sql.end();
