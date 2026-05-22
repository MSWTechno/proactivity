import type { SourceAdapter } from './types.js';
import { ticketmasterAdapter } from './adapters/ticketmaster.js';
import { icalAdapter } from './adapters/ical.js';
import { eventonAdapter } from './adapters/eventon.js';
import { jsonLdEventAdapter } from './adapters/jsonld-event.js';
import { rssAdapter } from './adapters/rss.js';

const adapters: ReadonlyMap<string, SourceAdapter> = new Map([
  [ticketmasterAdapter.key, ticketmasterAdapter],
  [icalAdapter.key, icalAdapter],
  [eventonAdapter.key, eventonAdapter],
  [jsonLdEventAdapter.key, jsonLdEventAdapter],
  [rssAdapter.key, rssAdapter],
]);

export function getAdapter(key: string): SourceAdapter | undefined {
  return adapters.get(key);
}

export function listAdapters(): readonly SourceAdapter[] {
  return [...adapters.values()];
}
