/**
 * Organizer dashboard — mobile port of OrganizerDashboard.tsx (web).
 *
 * Scope (v1):
 *  - View claims (approved / pending / rejected)
 *  - Create a new org (auto-approved)
 *  - Claim an existing org (admin-moderated)
 *  - Per-approved-org event list
 *  - Submit a new event draft (no recurrence yet — deferred to phase 2)
 *  - View pending and rejected drafts
 *  - Submit URLs for scraping + view the queue
 *
 * Out of scope (v1, deferred):
 *  - Edit / copy an existing event (requires the full draft editor port)
 *  - Recurrence on drafts (with preview component)
 *  - Plus subscription (would need IAP on mobile, not Stripe)
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, FlatList, Linking, Platform, Pressable, ScrollView,
  StyleSheet, Text, TextInput, View,
} from 'react-native';
import { authFetch, type MeUser } from '../lib/auth';

interface Theme {
  bg: string; elev: string; sunken: string;
  fg: string; muted: string; subtle: string;
  border: string; accent: string;
  success: string; successSoft: string;
  danger: string; dangerSoft: string;
}

interface Claim {
  id: string;
  organizerKey: string;
  organizerName: string | null;
  organizerUrl: string | null;
  userCreated: boolean;
  status: 'pending' | 'approved' | 'rejected';
  note: string | null;
  moderatorNote: string | null;
  eventCount: number;
  upcomingCount: number;
  clicks30d: number;
}

interface OrgEvent {
  id: string;
  title: string;
  startAt: string;
  venueName: string | null;
  city: string | null;
  organizerKey: string;
  availability: string;
}

interface DraftSummary {
  id: string;
  organizerKey: string;
  activityId: string | null;
  title: string | null;
  startAt: string | null;
  status: 'pending' | 'approved' | 'rejected';
  moderatorNote: string | null;
  recurrenceFreq: string | null;
  recurrenceCount: number | null;
}

interface UrlSubmission {
  id: string;
  url: string;
  organizerKey: string | null;
  note: string | null;
  status: 'pending' | 'imported' | 'rejected' | 'failed';
  moderatorNote: string | null;
  importedCount: number | null;
}

interface OrganizationSearchResult {
  key: string;
  name: string | null;
  eventCount: number;
}

export function OrganizerScreen({
  me, t, onClose,
}: {
  me: MeUser;
  t: Theme;
  onClose: () => void;
}) {
  const [claims, setClaims] = useState<Claim[]>([]);
  const [events, setEvents] = useState<OrgEvent[]>([]);
  const [drafts, setDrafts] = useState<DraftSummary[]>([]);
  const [urlSubs, setUrlSubs] = useState<UrlSubmission[]>([]);
  const [loading, setLoading] = useState(true);

  const [createOpen, setCreateOpen] = useState(false);
  const [claimOpen, setClaimOpen] = useState(false);
  const [draftFor, setDraftFor] = useState<string | null>(null); // organizerKey
  const [urlFormOpen, setUrlFormOpen] = useState(false);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [claimRes, eventRes, urlRes] = await Promise.all([
        authFetch('/api/organizer/claim').then((r) => r.json()).catch(() => ({})),
        authFetch('/api/organizer/events').then((r) => r.json()).catch(() => ({})),
        authFetch('/api/organizer/url-submissions').then((r) => r.json()).catch(() => ({})),
      ]);
      setClaims(claimRes.claims ?? []);
      setEvents(eventRes.events ?? []);
      setDrafts(eventRes.drafts ?? []);
      setUrlSubs(urlRes.submissions ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  const approvedClaims = useMemo(() => claims.filter((c) => c.status === 'approved'), [claims]);
  const pendingClaims = useMemo(() => claims.filter((c) => c.status === 'pending'), [claims]);
  const rejectedClaims = useMemo(() => claims.filter((c) => c.status === 'rejected'), [claims]);
  const pendingDrafts = useMemo(() => drafts.filter((d) => d.status === 'pending'), [drafts]);
  const rejectedDrafts = useMemo(() => drafts.filter((d) => d.status === 'rejected'), [drafts]);

  const eventsByOrg = useMemo(() => {
    const m = new Map<string, OrgEvent[]>();
    for (const e of events) {
      const list = m.get(e.organizerKey) ?? [];
      list.push(e);
      m.set(e.organizerKey, list);
    }
    return m;
  }, [events]);

  return (
    <View style={[styles.overlay, { backgroundColor: t.bg }]}>
      <View style={styles.header}>
        <Pressable onPress={onClose} hitSlop={10}>
          <Text style={{ color: t.accent, fontSize: 15 }}>← Back</Text>
        </Pressable>
        <Text style={[styles.title, { color: t.fg }]}>Organizer</Text>
        <View style={{ width: 60 }} />
      </View>
      <Text style={[styles.subtitle, { color: t.muted }]}>
        Signed in as {me.email}
      </Text>

      <ScrollView contentContainerStyle={{ paddingBottom: 60 }} showsVerticalScrollIndicator={false}>
        {loading && (
          <ActivityIndicator color={t.accent} style={{ marginTop: 24 }} />
        )}

        {/* Organizations section */}
        <Section title="Your organizers" count={claims.length} t={t}>
          <View style={styles.actionRow}>
            <Pressable
              onPress={() => { setCreateOpen((v) => !v); setClaimOpen(false); }}
              style={[styles.primaryBtn, { backgroundColor: t.accent }]}
            >
              <Text style={styles.primaryBtnText}>{createOpen ? 'Cancel' : '+ Create new'}</Text>
            </Pressable>
            <Pressable
              onPress={() => { setClaimOpen((v) => !v); setCreateOpen(false); }}
              style={[styles.secondaryBtn, { borderColor: t.border, backgroundColor: t.elev }]}
            >
              <Text style={{ color: t.fg, fontSize: 13 }}>{claimOpen ? 'Cancel' : 'Claim existing'}</Text>
            </Pressable>
          </View>

          {createOpen && (
            <CreateOrgForm t={t} onDone={() => { setCreateOpen(false); loadAll(); }} />
          )}
          {claimOpen && (
            <ClaimOrgForm t={t} onDone={() => { setClaimOpen(false); loadAll(); }} />
          )}

          {[...approvedClaims, ...pendingClaims, ...rejectedClaims].map((c) => (
            <ClaimCard key={c.id} c={c} t={t} />
          ))}

          {!loading && claims.length === 0 && !createOpen && !claimOpen && (
            <Text style={[styles.empty, { color: t.muted }]}>
              No organizations yet. Create a new one or claim an existing org.
            </Text>
          )}
        </Section>

        {/* Events section */}
        {approvedClaims.length > 0 && (
          <Section title="Your events" count={events.length} t={t}>
            {pendingDrafts.length > 0 && (
              <View style={[styles.banner, { backgroundColor: t.accent + '15' }]}>
                <Text style={{ color: t.accent, fontSize: 12 }}>
                  {pendingDrafts.length} pending change{pendingDrafts.length === 1 ? '' : 's'} awaiting admin review:
                </Text>
                {pendingDrafts.map((d) => (
                  <Text key={d.id} style={{ color: t.fg, fontSize: 12, marginTop: 2 }}>
                    • {d.title ?? '(new event)'}
                    {d.recurrenceFreq && d.recurrenceCount
                      ? ` · repeats ${d.recurrenceFreq} × ${d.recurrenceCount}`
                      : ''}
                  </Text>
                ))}
              </View>
            )}

            {approvedClaims.map((c) => {
              const orgEvents = eventsByOrg.get(c.organizerKey) ?? [];
              return (
                <View key={c.organizerKey} style={[styles.orgBlock, { borderColor: t.border }]}>
                  <View style={styles.orgBlockHead}>
                    <Text style={{ color: t.fg, fontSize: 14, fontWeight: '600', flex: 1 }} numberOfLines={1}>
                      {c.organizerName ?? c.organizerKey}
                    </Text>
                    <Pressable
                      onPress={() => setDraftFor(c.organizerKey)}
                      style={[styles.smallBtn, { backgroundColor: t.accent }]}
                    >
                      <Text style={styles.primaryBtnText}>+ Add event</Text>
                    </Pressable>
                  </View>
                  {orgEvents.length === 0 ? (
                    <Text style={[styles.empty, { color: t.subtle, fontSize: 12 }]}>No events yet.</Text>
                  ) : (
                    orgEvents.slice(0, 12).map((e) => (
                      <View key={e.id} style={[styles.eventRow, { borderTopColor: t.border }]}>
                        <Text style={{ color: t.fg, fontSize: 13 }} numberOfLines={1}>{e.title}</Text>
                        <Text style={{ color: t.muted, fontSize: 11 }} numberOfLines={1}>
                          {new Date(e.startAt).toLocaleString(undefined, {
                            month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
                          })}
                          {e.venueName ? ` · ${e.venueName}` : ''}
                        </Text>
                      </View>
                    ))
                  )}
                </View>
              );
            })}

            {rejectedDrafts.length > 0 && (
              <View style={{ marginTop: 12 }}>
                <Text style={{ color: t.muted, fontSize: 12, marginBottom: 4 }}>
                  Recent rejections ({rejectedDrafts.length})
                </Text>
                {rejectedDrafts.slice(0, 5).map((d) => (
                  <View key={d.id} style={{ paddingVertical: 4, paddingLeft: 8, borderLeftWidth: 2, borderLeftColor: t.danger, marginBottom: 4 }}>
                    <Text style={{ color: t.fg, fontSize: 12 }}>{d.title ?? '(new event)'}</Text>
                    {d.moderatorNote && (
                      <Text style={{ color: t.muted, fontSize: 11 }}>Note: {d.moderatorNote}</Text>
                    )}
                  </View>
                ))}
              </View>
            )}
          </Section>
        )}

        {/* URL submissions */}
        {approvedClaims.length > 0 && (
          <Section title="URLs to scrape" count={urlSubs.length} t={t}>
            <Pressable
              onPress={() => setUrlFormOpen((v) => !v)}
              style={[styles.primaryBtn, { backgroundColor: t.accent, alignSelf: 'flex-start' }]}
            >
              <Text style={styles.primaryBtnText}>{urlFormOpen ? 'Cancel' : '+ Submit a URL'}</Text>
            </Pressable>
            <Text style={[styles.empty, { color: t.muted, marginTop: 8, fontSize: 12, textAlign: 'left' }]}>
              Paste a page that lists your events. Admin will pull events from it and let you know how it went.
            </Text>

            {urlFormOpen && (
              <UrlSubmissionForm
                t={t}
                approvedClaims={approvedClaims}
                onDone={() => { setUrlFormOpen(false); loadAll(); }}
              />
            )}

            {urlSubs.map((s) => (
              <UrlSubmissionCard key={s.id} s={s} claims={claims} t={t} />
            ))}
            {!loading && urlSubs.length === 0 && !urlFormOpen && (
              <Text style={[styles.empty, { color: t.subtle }]}>No URL submissions yet.</Text>
            )}
          </Section>
        )}

        <Pressable
          onPress={() => Linking.openURL('https://proactivity.app/pricing').catch(() => {})}
          style={{ marginTop: 24, alignItems: 'center' }}
        >
          <Text style={{ color: t.accent, fontSize: 12 }}>
            Manage Plus subscription on the web →
          </Text>
        </Pressable>
      </ScrollView>

      {draftFor && (
        <DraftForm
          t={t}
          organizerKey={draftFor}
          onClose={() => setDraftFor(null)}
          onDone={() => { setDraftFor(null); loadAll(); }}
        />
      )}
    </View>
  );
}

function Section({
  title, count, t, children,
}: {
  title: string;
  count: number;
  t: Theme;
  children: React.ReactNode;
}) {
  return (
    <View style={{ marginTop: 18 }}>
      <Text style={[styles.sectionTitle, { color: t.fg }]}>
        {title} <Text style={{ color: t.subtle, fontWeight: '400' }}>{count}</Text>
      </Text>
      {children}
    </View>
  );
}

function ClaimCard({ c, t }: { c: Claim; t: Theme }) {
  const statusColor = c.status === 'approved' ? t.success : c.status === 'pending' ? t.muted : t.danger;
  return (
    <View style={[styles.card, { backgroundColor: t.elev, borderColor: t.border }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <Text style={{ color: t.fg, fontSize: 15, fontWeight: '600', flexShrink: 1 }} numberOfLines={1}>
          {c.organizerName ?? c.organizerKey}
        </Text>
        {c.userCreated && (
          <View style={[styles.tag, { backgroundColor: t.sunken }]}>
            <Text style={{ color: t.muted, fontSize: 10 }}>user-created</Text>
          </View>
        )}
        <View style={[styles.tag, { backgroundColor: statusColor + '22' }]}>
          <Text style={{ color: statusColor, fontSize: 11, textTransform: 'capitalize' }}>{c.status}</Text>
        </View>
      </View>
      {c.organizerUrl && (
        <Text style={{ color: t.muted, fontSize: 11, marginTop: 2 }} numberOfLines={1}>{c.organizerUrl}</Text>
      )}
      {c.status === 'approved' && (
        <View style={{ flexDirection: 'row', gap: 16, marginTop: 6 }}>
          <Stat label="Events" value={c.eventCount} t={t} />
          <Stat label="Upcoming" value={c.upcomingCount} t={t} />
          <Stat label="Clicks 30d" value={c.clicks30d} t={t} />
        </View>
      )}
      {c.moderatorNote && (
        <Text style={{ color: t.muted, fontSize: 12, marginTop: 6 }}>
          Moderator: {c.moderatorNote}
        </Text>
      )}
    </View>
  );
}

function Stat({ label, value, t }: { label: string; value: number; t: Theme }) {
  return (
    <View>
      <Text style={{ color: t.subtle, fontSize: 10, textTransform: 'uppercase' }}>{label}</Text>
      <Text style={{ color: t.fg, fontSize: 14, fontWeight: '600' }}>{value}</Text>
    </View>
  );
}

function CreateOrgForm({ t, onDone }: { t: Theme; onDone: () => void }) {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!name.trim()) { setError('Name is required.'); return; }
    setSubmitting(true);
    setError(null);
    try {
      const res = await authFetch('/api/organizer/create-org', {
        method: 'POST',
        body: JSON.stringify({ name: name.trim(), url: url.trim() || undefined }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={[styles.formBlock, { backgroundColor: t.elev, borderColor: t.border }]}>
      <Text style={{ color: t.muted, fontSize: 12, marginBottom: 8 }}>
        Create a new organization. You can submit events for it immediately (admin still reviews each event).
      </Text>
      <TextInput
        value={name}
        onChangeText={setName}
        placeholder="Organization name *"
        placeholderTextColor={t.subtle}
        maxLength={200}
        style={[styles.input, { color: t.fg, borderColor: t.border, backgroundColor: t.bg }]}
      />
      <TextInput
        value={url}
        onChangeText={setUrl}
        placeholder="Website URL (optional)"
        placeholderTextColor={t.subtle}
        keyboardType="url"
        autoCapitalize="none"
        style={[styles.input, { color: t.fg, borderColor: t.border, backgroundColor: t.bg }]}
      />
      {error && <Text style={{ color: t.danger, fontSize: 12, marginBottom: 6 }}>{error}</Text>}
      <Pressable
        onPress={submit}
        disabled={submitting}
        style={[styles.primaryBtn, { backgroundColor: t.accent, opacity: submitting ? 0.55 : 1 }]}
      >
        <Text style={styles.primaryBtnText}>{submitting ? 'Creating…' : 'Create organization'}</Text>
      </Pressable>
    </View>
  );
}

function ClaimOrgForm({ t, onDone }: { t: Theme; onDone: () => void }) {
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [orgs, setOrgs] = useState<OrganizationSearchResult[]>([]);
  const [selected, setSelected] = useState<OrganizationSearchResult | null>(null);
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(search.trim()), 250);
    return () => clearTimeout(id);
  }, [search]);

  useEffect(() => {
    authFetch(`/api/organizer/organizations${debounced ? `?search=${encodeURIComponent(debounced)}` : ''}`)
      .then((r) => r.json() as Promise<{ organizations: OrganizationSearchResult[] }>)
      .then((d) => setOrgs(d.organizations ?? []))
      .catch(() => setOrgs([]));
  }, [debounced]);

  const submit = async () => {
    if (!selected) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await authFetch('/api/organizer/claim', {
        method: 'POST',
        body: JSON.stringify({ organizerKey: selected.key, note: note.trim() || undefined }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={[styles.formBlock, { backgroundColor: t.elev, borderColor: t.border }]}>
      <TextInput
        value={search}
        onChangeText={setSearch}
        placeholder="Search organizers…"
        placeholderTextColor={t.subtle}
        autoCapitalize="none"
        style={[styles.input, { color: t.fg, borderColor: t.border, backgroundColor: t.bg }]}
      />
      <View style={{ maxHeight: 220 }}>
        <FlatList
          data={orgs}
          keyExtractor={(o) => o.key}
          renderItem={({ item }) => (
            <Pressable
              onPress={() => setSelected(item)}
              style={[
                styles.orgRow,
                { borderColor: t.border },
                selected?.key === item.key && { backgroundColor: t.accent + '20', borderColor: t.accent },
              ]}
            >
              <Text style={{ color: t.fg, fontSize: 13, fontWeight: '500' }} numberOfLines={1}>
                {item.name ?? item.key}
              </Text>
              <Text style={{ color: t.muted, fontSize: 11 }}>{item.eventCount} events</Text>
            </Pressable>
          )}
          ListEmptyComponent={
            <Text style={{ color: t.subtle, fontSize: 12, padding: 8 }}>No matches.</Text>
          }
        />
      </View>
      {selected && (
        <>
          <TextInput
            value={note}
            onChangeText={setNote}
            placeholder="Why are you the organizer here? (helpful for admin review)"
            placeholderTextColor={t.subtle}
            multiline
            maxLength={1000}
            style={[styles.textarea, { color: t.fg, borderColor: t.border, backgroundColor: t.bg }]}
          />
          {error && <Text style={{ color: t.danger, fontSize: 12, marginBottom: 6 }}>{error}</Text>}
          <Pressable
            onPress={submit}
            disabled={submitting}
            style={[styles.primaryBtn, { backgroundColor: t.accent, opacity: submitting ? 0.55 : 1 }]}
          >
            <Text style={styles.primaryBtnText}>
              {submitting ? 'Submitting…' : `Submit claim for ${selected.name ?? selected.key}`}
            </Text>
          </Pressable>
        </>
      )}
    </View>
  );
}

function DraftForm({
  t, organizerKey, onClose, onDone,
}: {
  t: Theme;
  organizerKey: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [startAt, setStartAt] = useState('');
  const [endAt, setEndAt] = useState('');
  const [venue, setVenue] = useState('');
  const [city, setCity] = useState('');
  const [region, setRegion] = useState('');
  const [url, setUrl] = useState('');
  const [costMin, setCostMin] = useState('');
  const [costMax, setCostMax] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    if (!title.trim()) { setError('Title is required.'); return; }
    if (!startAt.trim()) { setError('Start date/time is required (e.g., 2026-06-15T18:00).'); return; }
    setSubmitting(true);
    try {
      const res = await authFetch('/api/organizer/events', {
        method: 'POST',
        body: JSON.stringify({
          organizerKey,
          title: title.trim(),
          description: description.trim() || undefined,
          startAt: startAt.trim(),
          endAt: endAt.trim() || undefined,
          venueName: venue.trim() || undefined,
          city: city.trim() || undefined,
          region: region.trim() || undefined,
          url: url.trim() || undefined,
          costMin: costMin.trim() || undefined,
          costMax: costMax.trim() || undefined,
        }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={[styles.overlay, { backgroundColor: t.bg }]}>
      <View style={styles.header}>
        <Pressable onPress={onClose} hitSlop={10}>
          <Text style={{ color: t.accent, fontSize: 15 }}>← Cancel</Text>
        </Pressable>
        <Text style={[styles.title, { color: t.fg }]}>New event</Text>
        <View style={{ width: 60 }} />
      </View>
      <Text style={[styles.subtitle, { color: t.muted }]}>
        Admin reviews each submission before it goes live.
      </Text>
      <ScrollView contentContainerStyle={{ paddingBottom: 60 }}>
        <FieldLabel t={t}>Title *</FieldLabel>
        <TextInput value={title} onChangeText={setTitle} style={[styles.input, { color: t.fg, borderColor: t.border, backgroundColor: t.elev }]} />

        <FieldLabel t={t}>Start (YYYY-MM-DDTHH:mm) *</FieldLabel>
        <TextInput value={startAt} onChangeText={setStartAt} placeholder="2026-06-15T18:00" placeholderTextColor={t.subtle} autoCapitalize="none" style={[styles.input, { color: t.fg, borderColor: t.border, backgroundColor: t.elev }]} />

        <FieldLabel t={t}>End (optional)</FieldLabel>
        <TextInput value={endAt} onChangeText={setEndAt} placeholder="2026-06-15T20:00" placeholderTextColor={t.subtle} autoCapitalize="none" style={[styles.input, { color: t.fg, borderColor: t.border, backgroundColor: t.elev }]} />

        <FieldLabel t={t}>Description</FieldLabel>
        <TextInput value={description} onChangeText={setDescription} multiline style={[styles.textarea, { color: t.fg, borderColor: t.border, backgroundColor: t.elev }]} />

        <FieldLabel t={t}>Event URL</FieldLabel>
        <TextInput value={url} onChangeText={setUrl} keyboardType="url" autoCapitalize="none" style={[styles.input, { color: t.fg, borderColor: t.border, backgroundColor: t.elev }]} />

        <FieldLabel t={t}>Venue</FieldLabel>
        <TextInput value={venue} onChangeText={setVenue} style={[styles.input, { color: t.fg, borderColor: t.border, backgroundColor: t.elev }]} />

        <FieldLabel t={t}>City</FieldLabel>
        <TextInput value={city} onChangeText={setCity} style={[styles.input, { color: t.fg, borderColor: t.border, backgroundColor: t.elev }]} />

        <FieldLabel t={t}>State / Region</FieldLabel>
        <TextInput value={region} onChangeText={setRegion} style={[styles.input, { color: t.fg, borderColor: t.border, backgroundColor: t.elev }]} />

        <View style={{ flexDirection: 'row', gap: 8 }}>
          <View style={{ flex: 1 }}>
            <FieldLabel t={t}>Cost min ($)</FieldLabel>
            <TextInput value={costMin} onChangeText={setCostMin} inputMode="decimal" style={[styles.input, { color: t.fg, borderColor: t.border, backgroundColor: t.elev }]} />
          </View>
          <View style={{ flex: 1 }}>
            <FieldLabel t={t}>Cost max ($)</FieldLabel>
            <TextInput value={costMax} onChangeText={setCostMax} inputMode="decimal" style={[styles.input, { color: t.fg, borderColor: t.border, backgroundColor: t.elev }]} />
          </View>
        </View>

        {error && <Text style={{ color: t.danger, fontSize: 12, marginVertical: 8 }}>{error}</Text>}
        <Pressable
          onPress={submit}
          disabled={submitting}
          style={[styles.primaryBtn, { backgroundColor: t.accent, opacity: submitting ? 0.55 : 1, marginTop: 12 }]}
        >
          <Text style={styles.primaryBtnText}>{submitting ? 'Submitting…' : 'Submit for review'}</Text>
        </Pressable>
        <Text style={{ color: t.subtle, fontSize: 11, marginTop: 12, textAlign: 'center' }}>
          Recurring events (weekly/biweekly/monthly) are available on the web for now.
        </Text>
      </ScrollView>
    </View>
  );
}

function FieldLabel({ t, children }: { t: Theme; children: React.ReactNode }) {
  return <Text style={{ color: t.subtle, fontSize: 11, textTransform: 'uppercase', marginTop: 10, marginBottom: 4 }}>{children}</Text>;
}

function UrlSubmissionForm({
  t, approvedClaims, onDone,
}: {
  t: Theme;
  approvedClaims: Claim[];
  onDone: () => void;
}) {
  const [url, setUrl] = useState('');
  const [organizerKey, setOrganizerKey] = useState(approvedClaims[0]?.organizerKey ?? '');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!url.trim()) { setError('URL is required.'); return; }
    setSubmitting(true);
    setError(null);
    try {
      const res = await authFetch('/api/organizer/url-submissions', {
        method: 'POST',
        body: JSON.stringify({
          url: url.trim(),
          organizerKey: organizerKey || undefined,
          note: note.trim() || undefined,
        }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={[styles.formBlock, { backgroundColor: t.elev, borderColor: t.border }]}>
      <TextInput
        value={url}
        onChangeText={setUrl}
        placeholder="https://example.com/events *"
        placeholderTextColor={t.subtle}
        keyboardType="url"
        autoCapitalize="none"
        style={[styles.input, { color: t.fg, borderColor: t.border, backgroundColor: t.bg }]}
      />
      {approvedClaims.length > 0 && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
          {[{ key: '', name: '(no specific organizer)' } as { key: string; name: string }, ...approvedClaims.map((c) => ({ key: c.organizerKey, name: c.organizerName ?? c.organizerKey }))].map((opt) => {
            const active = organizerKey === opt.key;
            return (
              <Pressable
                key={opt.key || '__none__'}
                onPress={() => setOrganizerKey(opt.key)}
                style={[
                  styles.tag,
                  { borderWidth: 1, borderColor: t.border, backgroundColor: t.bg },
                  active && { backgroundColor: t.accent, borderColor: t.accent },
                ]}
              >
                <Text style={{ color: active ? '#fff' : t.fg, fontSize: 11 }}>{opt.name}</Text>
              </Pressable>
            );
          })}
        </View>
      )}
      <TextInput
        value={note}
        onChangeText={setNote}
        placeholder="Anything helpful to know? (optional)"
        placeholderTextColor={t.subtle}
        multiline
        style={[styles.textarea, { color: t.fg, borderColor: t.border, backgroundColor: t.bg }]}
      />
      {error && <Text style={{ color: t.danger, fontSize: 12, marginBottom: 6 }}>{error}</Text>}
      <Pressable
        onPress={submit}
        disabled={submitting}
        style={[styles.primaryBtn, { backgroundColor: t.accent, opacity: submitting ? 0.55 : 1 }]}
      >
        <Text style={styles.primaryBtnText}>{submitting ? 'Submitting…' : 'Submit URL'}</Text>
      </Pressable>
    </View>
  );
}

function UrlSubmissionCard({
  s, claims, t,
}: {
  s: UrlSubmission;
  claims: Claim[];
  t: Theme;
}) {
  const orgName = s.organizerKey ? (claims.find((c) => c.organizerKey === s.organizerKey)?.organizerName ?? s.organizerKey) : null;
  const statusColor = s.status === 'imported' ? t.success : s.status === 'pending' ? t.muted : t.danger;
  return (
    <View style={[styles.card, { backgroundColor: t.elev, borderColor: t.border }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <View style={[styles.tag, { backgroundColor: statusColor + '22' }]}>
          <Text style={{ color: statusColor, fontSize: 11, textTransform: 'capitalize' }}>{s.status}</Text>
        </View>
        {orgName && <Text style={{ color: t.muted, fontSize: 11 }}>{orgName}</Text>}
        {s.importedCount != null && (
          <Text style={{ color: t.muted, fontSize: 11 }}>· {s.importedCount} imported</Text>
        )}
      </View>
      <Pressable onPress={() => Linking.openURL(s.url).catch(() => {})}>
        <Text style={{ color: t.accent, fontSize: 12, marginTop: 4 }} numberOfLines={1}>{s.url}</Text>
      </Pressable>
      {s.note && <Text style={{ color: t.muted, fontSize: 11, marginTop: 2 }}>{s.note}</Text>}
      {s.moderatorNote && <Text style={{ color: t.accent, fontSize: 11, marginTop: 2 }}>Note: {s.moderatorNote}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    paddingTop: Platform.OS === 'ios' ? 60 : 36,
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 18, fontWeight: '700' },
  subtitle: { fontSize: 12, marginTop: 2, marginBottom: 4 },
  sectionTitle: { fontSize: 13, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 },
  actionRow: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  primaryBtn: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 8, alignItems: 'center' },
  primaryBtnText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  secondaryBtn: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 8, borderWidth: 1, alignItems: 'center' },
  smallBtn: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 6 },
  card: { padding: 10, borderRadius: 10, borderWidth: 1, marginBottom: 8 },
  tag: { paddingVertical: 2, paddingHorizontal: 8, borderRadius: 999 },
  empty: { fontSize: 12, marginVertical: 8, textAlign: 'center' },
  formBlock: { borderRadius: 10, borderWidth: 1, padding: 12, marginBottom: 10 },
  input: { borderWidth: 1, borderRadius: 8, padding: 10, fontSize: 14, marginBottom: 8 },
  textarea: { borderWidth: 1, borderRadius: 8, padding: 10, fontSize: 14, marginBottom: 8, minHeight: 70, textAlignVertical: 'top' },
  banner: { padding: 10, borderRadius: 8, marginBottom: 10 },
  orgBlock: { borderTopWidth: 1, paddingVertical: 10, marginBottom: 4 },
  orgBlockHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  orgRow: { padding: 10, borderTopWidth: 1, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  eventRow: { paddingVertical: 8, borderTopWidth: 1 },
});
