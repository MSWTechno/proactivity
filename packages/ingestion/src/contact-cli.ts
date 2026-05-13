// Env is loaded via `tsx --env-file=../../.env` (see package.json scripts).
import { db, contactSubmissions, sql as pgSql } from '@proactivity/db';
import { eq, desc } from 'drizzle-orm';

const HELP = `
Usage:
  pnpm contact:list [new|replied|added|rejected|all]   (default: new)
  pnpm contact:resolve <id> <status> [note]            (status: replied|added|rejected)
`.trim();

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  try {
    switch (cmd) {
      case 'list':
        await cmdList(args);
        break;
      case 'resolve':
        await cmdResolve(args);
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
  const filter = (args[0] ?? 'new').toLowerCase();
  const valid = new Set(['new', 'replied', 'added', 'rejected', 'all']);
  if (!valid.has(filter)) {
    console.error(`unknown filter "${filter}". Use: new|replied|added|rejected|all`);
    process.exitCode = 1;
    return;
  }
  const where = filter === 'all' ? undefined : eq(contactSubmissions.status, filter);
  const rows = await db
    .select()
    .from(contactSubmissions)
    .where(where)
    .orderBy(desc(contactSubmissions.createdAt))
    .limit(100);

  if (rows.length === 0) {
    console.log(`No submissions with status="${filter}".`);
    return;
  }

  for (const s of rows) {
    const icon = s.status === 'new' ? '○' : s.status === 'added' ? '●' : s.status === 'rejected' ? '×' : '↺';
    console.log(`${icon} ${s.id}  [${s.status}]  ${s.createdAt.toISOString()}`);
    console.log(`   from: ${s.name ?? '?'} <${s.email}>${s.organization ? `  ·  ${s.organization}` : ''}`);
    if (s.eventUrl) console.log(`   url:  ${s.eventUrl}`);
    console.log(`   msg:  "${s.message.replace(/\s+/g, ' ').slice(0, 280)}"`);
    if (s.notes) console.log(`   note: ${s.notes}`);
    console.log('');
  }
}

async function cmdResolve(args: string[]) {
  const [id, status, ...noteParts] = args;
  if (!id || !status) {
    console.error('resolve: expected <id> <status> [note]');
    process.exitCode = 1;
    return;
  }
  const valid = new Set(['replied', 'added', 'rejected']);
  if (!valid.has(status)) {
    console.error(`status must be one of: ${[...valid].join(', ')}`);
    process.exitCode = 1;
    return;
  }
  const note = noteParts.length > 0 ? noteParts.join(' ') : null;

  const result = await db
    .update(contactSubmissions)
    .set({ status, notes: note, resolvedAt: new Date() })
    .where(eq(contactSubmissions.id, id))
    .returning({ id: contactSubmissions.id, email: contactSubmissions.email });
  if (result.length === 0) {
    console.error(`no submission with id "${id}"`);
    process.exitCode = 1;
    return;
  }
  console.log(`${status}: ${result[0]!.email} (${result[0]!.id})`);
}

await main();
