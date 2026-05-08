// Env is loaded via `tsx --env-file=../../.env` (see package.json scripts).
import { sql } from '@proactivity/db';
import { runAllSources } from './runner.js';

await runAllSources();
await sql.end();
