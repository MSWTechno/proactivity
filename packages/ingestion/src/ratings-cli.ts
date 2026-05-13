// Env is loaded via `tsx --env-file=../../.env` (see package.json scripts).
import { db, ratings, activities, sources, sql as pgSql } from '@proactivity/db';
import { and, eq, desc } from 'drizzle-orm';

const HELP = `
Usage:
  pnpm ratings:list [pending|approved|rejected|all]    (default: pending)
  pnpm ratings:approve <id> [note]
  pnpm ratings:reject <id> [note]

Examples:
  pnpm ratings:list
  pnpm ratings:approve a3f12b4c-... "looks legit"
  pnpm ratings:reject  a3f12b4c-... "spam"
`.trim();

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  try {
    switch (cmd) {
      case 'list':
        await cmdList(args);
        break;
      case 'approve':
        await cmdModerate(args, 'approved');
        break;
      case 'reject':
        await cmdModerate(args, 'rejected');
        break;
      default:
        console.log(HELP);
        process.exitCode = cmd ? 1 : 0;
    }
  } finally {
    await pgSql.end();
  }
}

async function cmdList(args: string[]) {
  const filterRaw = args[0]?.toLowerCase() ?? 'pending';
  const allowed = new Set(['pending', 'approved', 'rejected', 'all']);
  if (!allowed.has(filterRaw)) {
    console.error(`unknown filter "${filterRaw}". Use: pending|approved|rejected|all`);
    process.exitCode = 1;
    return;
  }
  const whereExpr = filterRaw === 'all' ? undefined : eq(ratings.status, filterRaw);

  const rows = await db
    .select({
      r: ratings,
      activityTitle: activities.title,
      activityStartAt: activities.startAt,
      sourceName: sources.name,
    })
    .from(ratings)
    .leftJoin(
      activities,
      and(
        eq(activities.sourceId, ratings.sourceId),
        // Match the recurring-base key
        // (activity.source_event_id starts with rating.target_key)
      ),
    )
    .leftJoin(sources, eq(sources.id, ratings.sourceId))
    .where(whereExpr)
    .orderBy(desc(ratings.createdAt))
    .limit(200);

  if (rows.length === 0) {
    console.log(`No ratings with status="${filterRaw}".`);
    return;
  }

  for (const row of rows) {
    const r = row.r;
    const stars = '★'.repeat(r.score) + '☆'.repeat(5 - r.score);
    const status = r.status === 'pending' ? '○' : r.status === 'approved' ? '●' : '×';
    console.log(
      [
        `${status} ${r.id}  ${stars}  ${r.status}`,
        `   source: ${row.sourceName ?? '?'}  target_key: ${r.targetKey}`,
        row.activityTitle ? `   re: ${row.activityTitle}` : null,
        r.submitterName || r.submitterEmail
          ? `   from: ${r.submitterName ?? ''}${r.submitterEmail ? ` <${r.submitterEmail}>` : ''}`
          : null,
        r.review ? `   "${r.review.replace(/\s+/g, ' ').slice(0, 200)}"` : null,
        `   submitted: ${r.createdAt.toISOString()}`,
      ]
        .filter(Boolean)
        .join('\n'),
    );
    console.log('');
  }
}

async function cmdModerate(args: string[], status: 'approved' | 'rejected') {
  const [id, ...noteParts] = args;
  if (!id) {
    console.error(`${status === 'approved' ? 'approve' : 'reject'}: expected <id> [note]`);
    process.exitCode = 1;
    return;
  }
  const note = noteParts.length > 0 ? noteParts.join(' ') : null;

  const result = await db
    .update(ratings)
    .set({ status, moderatedAt: new Date(), moderatorNote: note })
    .where(eq(ratings.id, id))
    .returning({ id: ratings.id, score: ratings.score, review: ratings.review });

  if (result.length === 0) {
    console.error(`no rating with id "${id}"`);
    process.exitCode = 1;
    return;
  }
  const r = result[0]!;
  console.log(`${status === 'approved' ? 'Approved' : 'Rejected'} ${r.id} (${r.score}★)`);
  if (r.review) console.log(`   "${r.review.slice(0, 200)}"`);
  if (note) console.log(`   note: ${note}`);
}

await main();
