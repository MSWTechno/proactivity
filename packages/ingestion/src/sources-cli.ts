// Env is loaded via `tsx --env-file=../../.env` (see package.json scripts).
import { db, sources, sql as pgSql } from '@proactivity/db';
import { eq } from 'drizzle-orm';
import { listAdapters, getAdapter } from './registry.js';

function helpText(): string {
  const adapterLines = listAdapters()
    .map((a) => `  ${a.key.padEnd(14)} ${a.configHelp}`)
    .join('\n');
  return `
Usage:
  pnpm sources:add <adapter_key> <name> <...adapter-specific-args>
  pnpm sources:list
  pnpm sources:disable <id>
  pnpm sources:set <id> <key=value> [<key=value>...]

Adapters:
${adapterLines}

Examples (Harrisonburg, VA):
  pnpm sources:add ticketmaster "Harrisonburg area" 38.4496 -78.8689 75
  pnpm sources:add ical "Visit Harrisonburg" https://visitharrisonburgva.com/events/?ical=1 38.4496 -78.8689
  pnpm sources:add ical "Downtown Harrisonburg" https://www.downtownharrisonburg.org/event-calendar?ical=1 38.4496 -78.8689
  pnpm sources:list
`.trim();
}

async function main() {
  const [cmd, ...args] = process.argv.slice(2);

  try {
    switch (cmd) {
      case 'add':
        await cmdAdd(args);
        break;
      case 'list':
        await cmdList();
        break;
      case 'disable':
        await cmdDisable(args);
        break;
      case 'set':
        await cmdSet(args);
        break;
      default:
        console.log(helpText());
        process.exitCode = cmd ? 1 : 0;
    }
  } finally {
    await pgSql.end();
  }
}

async function cmdAdd(args: string[]) {
  if (args.length < 2) {
    console.error('add: expected <adapter_key> <name> <...adapter-specific-args>');
    console.error(helpText());
    process.exitCode = 1;
    return;
  }
  const [adapterKey, name, ...adapterArgs] = args as [string, string, ...string[]];

  const adapter = getAdapter(adapterKey);
  if (!adapter) {
    console.error(
      `unknown adapter "${adapterKey}". registered: ${listAdapters().map((a) => a.key).join(', ')}`,
    );
    process.exitCode = 1;
    return;
  }

  const parsed = adapter.parseCliConfig(adapterArgs);
  if (!parsed.ok) {
    console.error(`${adapterKey}: ${parsed.error}`);
    console.error(`expected: pnpm sources:add ${adapterKey} <name> ${adapter.configHelp}`);
    process.exitCode = 1;
    return;
  }

  const [row] = await db
    .insert(sources)
    .values({
      adapterKey,
      name,
      enabled: true,
      config: parsed.config,
    })
    .returning({ id: sources.id });

  console.log(`Added source ${row!.id}`);
  console.log(`  ${adapterKey} · ${name}`);
  console.log(`  config: ${JSON.stringify(parsed.config)}`);
}

async function cmdList() {
  const rows = await db.select().from(sources).orderBy(sources.createdAt);
  if (rows.length === 0) {
    console.log('No sources. Add one with: pnpm sources:add <adapter> "name" ...');
    return;
  }
  for (const r of rows) {
    const status =
      r.lastRunAt != null
        ? `${r.lastStatus ?? '?'} @ ${r.lastRunAt.toISOString()}`
        : 'never run';
    console.log(
      [
        `${r.enabled ? '●' : '○'} ${r.id}`,
        `  ${r.adapterKey} · ${r.name}`,
        `  config: ${JSON.stringify(r.config)}`,
        `  ${status}`,
        r.lastError ? `  err: ${r.lastError}` : null,
      ]
        .filter(Boolean)
        .join('\n'),
    );
  }
}

async function cmdSet(args: string[]) {
  const [id, ...kvs] = args;
  if (!id || kvs.length === 0) {
    console.error('set: expected <id> <key=value> [<key=value>...]');
    process.exitCode = 1;
    return;
  }
  const updates: Record<string, unknown> = {};
  for (const kv of kvs) {
    const eq = kv.indexOf('=');
    if (eq < 1) {
      console.error(`bad arg "${kv}" — expected key=value`);
      process.exitCode = 1;
      return;
    }
    const k = kv.slice(0, eq);
    const raw = kv.slice(eq + 1);
    // Parse as JSON value (number/bool/null/object); fall back to literal string.
    try {
      updates[k] = JSON.parse(raw);
    } catch {
      updates[k] = raw;
    }
  }

  const [row] = await db.select().from(sources).where(eq(sources.id, id));
  if (!row) {
    console.error(`no source with id "${id}"`);
    process.exitCode = 1;
    return;
  }
  const newConfig = { ...(row.config as Record<string, unknown>), ...updates };
  await db
    .update(sources)
    .set({ config: newConfig, updatedAt: new Date() })
    .where(eq(sources.id, id));
  console.log(`Updated ${row.name} (${row.id})`);
  console.log(`  config: ${JSON.stringify(newConfig)}`);
}

async function cmdDisable(args: string[]) {
  const [id] = args;
  if (!id) {
    console.error('disable: expected <id>');
    process.exitCode = 1;
    return;
  }
  const result = await db
    .update(sources)
    .set({ enabled: false, updatedAt: new Date() })
    .where(eq(sources.id, id))
    .returning({ id: sources.id, name: sources.name });

  if (result.length === 0) {
    console.error(`no source with id "${id}"`);
    process.exitCode = 1;
    return;
  }
  console.log(`Disabled ${result[0]!.name} (${result[0]!.id})`);
}

await main();
