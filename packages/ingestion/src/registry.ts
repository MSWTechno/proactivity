import type { SourceAdapter } from './types.js';
import { ticketmasterAdapter } from './adapters/ticketmaster.js';
import { icalAdapter } from './adapters/ical.js';
import { eventonAdapter } from './adapters/eventon.js';
import { jsonLdEventAdapter } from './adapters/jsonld-event.js';
import { rssAdapter } from './adapters/rss.js';
import { sparkgoAdapter } from './adapters/sparkgo.js';

const adapters: ReadonlyMap<string, SourceAdapter> = new Map([
  [ticketmasterAdapter.key, ticketmasterAdapter],
  [icalAdapter.key, icalAdapter],
  [eventonAdapter.key, eventonAdapter],
  [jsonLdEventAdapter.key, jsonLdEventAdapter],
  [rssAdapter.key, rssAdapter],
  [sparkgoAdapter.key, sparkgoAdapter],
]);

/**
 * Adapter keys for sources whose rows are written straight to the DB —
 * the admin event form (`manual`) and organizer submissions (`organizer`) —
 * rather than fetched from a feed. They exist only to give those activities
 * a source_id to hang off, so there is nothing for the runner to ingest.
 *
 * Without this the nightly sweep picks them up like any other enabled source,
 * finds no adapter, and parks them at last_status='error' forever — real
 * failures then hide in the noise.
 */
const PASSIVE_ADAPTER_KEYS: ReadonlySet<string> = new Set(['manual', 'organizer']);

/** True for sources that hold hand-entered rows and have no feed to fetch. */
export function isPassiveAdapter(key: string): boolean {
  return PASSIVE_ADAPTER_KEYS.has(key);
}

export function getAdapter(key: string): SourceAdapter | undefined {
  return adapters.get(key);
}

export function listAdapters(): readonly SourceAdapter[] {
  return [...adapters.values()];
}
