import { StatusBar } from 'expo-status-bar';
import * as Location from 'expo-location';
import * as Updates from 'expo-updates';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Constants from 'expo-constants';
import {
  authFetch,
  clearSession,
  exchangeMagicLink,
  loadStoredSession,
  requestMagicLink,
  tokenFromDeepLink,
  type MeUser,
} from './lib/auth';
import { OrganizerScreen } from './screens/Organizer';
import { AdSlot } from './AdSlot';

const AD_EVERY_N_CARDS = 6;
import {
  ActivityIndicator,
  AppState,
  Image,
  Linking,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  SectionList,
  StyleSheet,
  Text,
  TextInput,
  useColorScheme,
  View,
} from 'react-native';
import { ALL_CATEGORY_KEYS, CATEGORIES, type CategoryKey } from './lib/categories';
import { placeholderFor } from './lib/icons';
import { LOCATION_PRESETS } from './lib/locations';

const API_BASE = (Constants.expoConfig?.extra as { apiBaseUrl?: string } | undefined)?.apiBaseUrl
  ?? 'https://proactivity.app';


/**
 * Returns a timezone safe to pass to toLocaleString({ timeZone }). Scraped
 * events store junk like "-5:00" or "Z" that throw a RangeError and would
 * crash the render; validate once and fall back to the app's home zone.
 */
function safeTimeZone(tz: string | null | undefined): string {
  const candidate = tz && tz.trim() ? tz.trim() : 'America/New_York';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: candidate });
    return candidate;
  } catch {
    return 'America/New_York';
  }
}

interface Activity {
  id: string;
  title: string;
  description: string | null;
  startAt: string;
  endAt: string | null;
  timezone: string | null;
  venueName: string | null;
  city: string | null;
  lat: number | null;
  lng: number | null;
  ageRange: { min: number | null; max: number | null; label: string } | null;
  costMinCents: number | null;
  costMaxCents: number | null;
  currency: string | null;
  availability: string;
  url: string | null;
  imageUrl: string | null;
  canonicalCategories: CategoryKey[];
  distanceMeters: number | null;
  ratingAverage: number | null;
  ratingCount: number;
  organizer: {
    name: string | null;
    url: string | null;
    key: string;
    ratingAverage: number | null;
    ratingCount: number;
  } | null;
}

type GeoState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ok'; lat: number; lng: number }
  | { kind: 'denied' }
  | { kind: 'error'; message: string };

export default function App() {
  const colorScheme = useColorScheme();
  const t = colorScheme === 'dark' ? dark : light;

  const [geo, setGeo] = useState<GeoState>({ kind: 'idle' });
  const [placeName, setPlaceName] = useState<string | null>(null);
  const [locPickerOpen, setLocPickerOpen] = useState(false);
  // null = follow device GPS; otherwise the id of a manually-picked preset.
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null);
  const [items, setItems] = useState<Activity[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  // Infinite scroll: page = highest page loaded; hasMore from the API.
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [activeCategories, setActiveCategories] = useState<Set<CategoryKey>>(new Set());
  const [daysAhead, setDaysAhead] = useState(14);
  const [sort, setSort] = useState<'time' | 'distance' | 'cost'>('time');
  // Radius captured in miles for the UI; converted to km when calling
  // the API (server-side filtering stays metric).
  const [radiusMi, setRadiusMi] = useState<5 | 15 | 30 | 60>(15);
  const [freeOnly, setFreeOnly] = useState(false);
  const [includeUnavailable, setIncludeUnavailable] = useState(false);
  const [orderedCategories, setOrderedCategories] = useState<CategoryKey[]>([...ALL_CATEGORY_KEYS]);
  const [ratingTarget, setRatingTarget] = useState<Activity | null>(null);
  const [detailActivity, setDetailActivity] = useState<Activity | null>(null);
  const [showSubmitForm, setShowSubmitForm] = useState(false);
  const [me, setMe] = useState<MeUser | null>(null);
  const [signInOpen, setSignInOpen] = useState(false);
  const [signInError, setSignInError] = useState<string | null>(null);
  const [organizerOpen, setOrganizerOpen] = useState(false);
  const [noAds, setNoAds] = useState(false);

  // Initialize AdMob once on mount. The lib gracefully handles re-init.
  // In Expo Go the native module is unavailable — the call may throw but
  // is caught here so the app continues to function (just without ads).
  useEffect(() => {
    (async () => {
      try {
        const mod = await import('react-native-google-mobile-ads');
        await mod.default().initialize();
      } catch {
        /* SDK unavailable (Expo Go or first-run before prebuild) */
      }
    })();
  }, []);

  // Check for an OTA update on cold start and on each foreground resume.
  // Silent: if one is available we fetch + reload immediately so the user
  // lands on the new bundle. Skipped in dev/Expo Go where Updates.isEnabled
  // is false. A single in-flight guard prevents overlapping checks if the
  // user backgrounds/foregrounds rapidly.
  useEffect(() => {
    if (__DEV__ || !Updates.isEnabled) return;
    let checking = false;
    const check = async () => {
      if (checking) return;
      checking = true;
      try {
        const u = await Updates.checkForUpdateAsync();
        if (u.isAvailable) {
          await Updates.fetchUpdateAsync();
          await Updates.reloadAsync();
        }
      } catch {
        /* offline or update server unreachable — continue with current bundle */
      } finally {
        checking = false;
      }
    };
    check();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') check();
    });
    return () => sub.remove();
  }, []);

  // When signed in, fetch /api/auth/me to learn whether the user has the
  // noAds (Plus) subscription. Refreshes on sign-in/out transitions.
  useEffect(() => {
    if (!me) { setNoAds(false); return; }
    authFetch('/api/auth/me')
      .then((r) => (r.ok ? r.json() : { subscription: null }))
      .then((d: { subscription?: { noAds: boolean } | null }) => {
        setNoAds(d.subscription?.noAds === true);
      })
      .catch(() => { /* keep default */ });
  }, [me]);

  // Load any persisted session at mount.
  useEffect(() => {
    loadStoredSession().then((s) => { if (s) setMe(s.user); });
  }, []);

  // Handle incoming deep links — proactivity://auth/verify?token=...
  // Both initial-launch URL (cold start) and subsequent foreground URLs.
  useEffect(() => {
    const tryExchange = async (url: string | null) => {
      if (!url) return;
      const token = tokenFromDeepLink(url);
      if (!token) return;
      try {
        const session = await exchangeMagicLink(token);
        setMe(session.user);
        setSignInOpen(false);
        setSignInError(null);
      } catch (e) {
        setSignInError(e instanceof Error ? e.message : 'Sign-in failed');
        setSignInOpen(true);
      }
    };
    Linking.getInitialURL().then(tryExchange);
    const sub = Linking.addEventListener('url', (ev) => { tryExchange(ev.url); });
    return () => sub.remove();
  }, []);

  const signOut = useCallback(async () => {
    await clearSession();
    setMe(null);
  }, []);

  // Fetch site-wide popularity order once on mount.
  useEffect(() => {
    fetch(`${API_BASE}/api/categories/popular`)
      .then((r) => (r.ok ? r.json() : { ordered: [] }))
      .then((d: { ordered?: CategoryKey[] }) => {
        if (d.ordered && d.ordered.length > 0) {
          // Filter unknowns — guards against web/mobile category drift
          // that would otherwise crash the render (CATEGORIES[k].emoji).
          const safe = d.ordered.filter((k) => ALL_CATEGORY_KEYS.includes(k));
          if (safe.length > 0) setOrderedCategories(safe);
        }
      })
      .catch(() => {
        /* keep default order */
      });
  }, []);

  // Detect the device's GPS location. Clears any manual preset so we follow
  // the device again. Also used by the location picker's "Use my location".
  const detectDeviceLocation = useCallback(async () => {
    setSelectedPresetId(null);
    setPlaceName(null);
    setGeo({ kind: 'loading' });
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setGeo({ kind: 'denied' });
        return;
      }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low });
      setGeo({ kind: 'ok', lat: pos.coords.latitude, lng: pos.coords.longitude });
    } catch (e) {
      setGeo({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  }, []);

  // Manually browse around a preset location instead of the device's GPS.
  const selectPreset = useCallback((id: string) => {
    const p = LOCATION_PRESETS.find((x) => x.id === id);
    if (!p) return;
    setSelectedPresetId(id);
    setPlaceName(p.label);
    setGeo({ kind: 'ok', lat: p.lat, lng: p.lng });
  }, []);

  // Geolocation on mount.
  useEffect(() => {
    detectDeviceLocation();
  }, [detectDeviceLocation]);

  // Debounce search.
  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => clearTimeout(id);
  }, [search]);

  // Reverse-geocode once location is known. Skipped when a preset is picked —
  // the preset's own label is already shown.
  useEffect(() => {
    if (geo.kind !== 'ok' || selectedPresetId !== null) return;
    let cancelled = false;
    fetch(`${API_BASE}/api/geocode/reverse?lat=${geo.lat}&lng=${geo.lng}`)
      .then((r) => (r.ok ? r.json() : { name: '' }))
      .then((d: { name?: string }) => {
        if (!cancelled && d.name) setPlaceName(d.name);
      })
      .catch(() => {
        /* silent — fall back to coords */
      });
    return () => {
      cancelled = true;
    };
  }, [geo, selectedPresetId]);

  const effectiveSort = sort === 'distance' && geo.kind !== 'ok' ? 'time' : sort;

  const queryString = useMemo(() => {
    const p = new URLSearchParams();
    if (geo.kind === 'ok') {
      p.set('lat', String(geo.lat));
      p.set('lng', String(geo.lng));
      p.set('radiusKm', String(Math.round(radiusMi * 1.60934)));
    }
    p.set('sort', effectiveSort);
    // daysAhead=0 means "all upcoming"; send the sentinel the API expects.
    p.set('daysAhead', daysAhead === 0 ? 'all' : String(daysAhead));
    if (freeOnly) p.set('freeOnly', '1');
    if (includeUnavailable) p.set('includeUnavailable', '1');
    if (debouncedSearch) p.set('search', debouncedSearch);
    if (activeCategories.size > 0) p.set('category', [...activeCategories].join(','));
    return p.toString();
  }, [geo, radiusMi, effectiveSort, daysAhead, freeOnly, includeUnavailable, debouncedSearch, activeCategories]);

  const fetchActivities = useCallback(async () => {
    setError(null);
    setPage(0);
    try {
      const res = await fetch(`${API_BASE}/api/activities?${queryString}&page=0`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { items: Activity[]; hasMore?: boolean };
      setItems(data.items);
      setHasMore(Boolean(data.hasMore));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [queryString]);

  // Infinite scroll: fetch + append the next page when the list nears its end.
  const loadMore = useCallback(async () => {
    if (loading || loadingMore || refreshing || !hasMore) return;
    const next = page + 1;
    setLoadingMore(true);
    try {
      const res = await fetch(`${API_BASE}/api/activities?${queryString}&page=${next}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { items: Activity[]; hasMore?: boolean };
      setItems((prev) => (prev ? [...prev, ...data.items] : data.items));
      setHasMore(Boolean(data.hasMore));
      setPage(next);
    } catch {
      /* leave the list as-is; retry on the next end-reached */
    } finally {
      setLoadingMore(false);
    }
  }, [queryString, page, hasMore, loading, loadingMore, refreshing]);

  useEffect(() => {
    if (geo.kind === 'idle' || geo.kind === 'loading') return;
    setLoading(true);
    fetchActivities().finally(() => setLoading(false));
  }, [fetchActivities, geo.kind]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchActivities();
    setRefreshing(false);
  }, [fetchActivities]);

  const groupedSections = useMemo(() => {
    const sections = groupByDay(items ?? []);
    if (noAds) return sections as { title: string; data: (Activity | { __ad: true; key: string })[] }[];
    // Interleave in-feed ad markers every AD_EVERY_N_CARDS across day boundaries.
    let counter = 0;
    return sections.map(({ title, data }) => {
      const out: (Activity | { __ad: true; key: string })[] = [];
      for (const a of data) {
        out.push(a);
        counter++;
        if (counter % AD_EVERY_N_CARDS === 0) {
          out.push({ __ad: true, key: `ad-${counter}` });
        }
      }
      return { title, data: out };
    });
  }, [items, noAds]);

  const toggleCategory = useCallback((key: CategoryKey) => {
    setActiveCategories((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
        // Camps & VBS are scheduled weeks/months out (summer), so the default
        // 7-day window would hide them — switch to "all upcoming" (daysAhead=0)
        // when either is selected.
        if (key === 'vbs' || key === 'camps') setDaysAhead(0);
        // Fire-and-forget: server aggregates clicks for sort ordering.
        fetch(`${API_BASE}/api/categories/click`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key }),
        }).catch(() => {
          /* ignore */
        });
      }
      return next;
    });
  }, []);

  return (
    <View style={[styles.root, { backgroundColor: t.bg }]}>
      <StatusBar style="auto" />
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <View style={{ flex: 1 }}>
            <View style={styles.wordmarkRow}>
              <Logo size={22} color={t.accent} />
              <Text style={[styles.wordmark, { color: t.fg }]}>proactivity</Text>
            </View>
            <Text style={[styles.tagline, { color: t.muted }]}>Things to do near you, this week.</Text>
          </View>
          <View style={{ alignItems: 'flex-end', gap: 6 }}>
            <Pressable
              onPress={() => setShowSubmitForm(true)}
              style={[styles.headerCta, { backgroundColor: t.accent + '22' }]}
            >
              <Text style={{ color: t.accent, fontSize: 12, fontWeight: '500' }}>Submit event</Text>
            </Pressable>
            {me ? (
              <>
                <Pressable onPress={() => setOrganizerOpen(true)} hitSlop={6}>
                  <Text style={{ color: t.accent, fontSize: 12, fontWeight: '500' }}>Organizer</Text>
                </Pressable>
                <Pressable onPress={signOut} hitSlop={6}>
                  <Text style={{ color: t.muted, fontSize: 11 }} numberOfLines={1}>
                    {me.name || me.email.split('@')[0]} · sign out
                  </Text>
                </Pressable>
              </>
            ) : (
              <Pressable onPress={() => { setSignInError(null); setSignInOpen(true); }} hitSlop={6}>
                <Text style={{ color: t.accent, fontSize: 12, fontWeight: '500' }}>Sign in</Text>
              </Pressable>
            )}
          </View>
        </View>
        <GeoBar geo={geo} placeName={placeName} t={t} onPress={() => setLocPickerOpen(true)} />
      </View>

      <TextInput
        style={[styles.search, { backgroundColor: t.elev, color: t.fg, borderColor: t.border }]}
        placeholder="Search events..."
        placeholderTextColor={t.subtle}
        value={search}
        onChangeText={setSearch}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
      />

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.catScroll}
        contentContainerStyle={styles.catRow}
      >
        {[
          { value: 'time' as const, label: 'Soonest' },
          { value: 'distance' as const, label: 'Distance', disabled: geo.kind !== 'ok' },
          { value: 'cost' as const, label: 'Cheapest' },
        ].map((s) => {
          const active = effectiveSort === s.value;
          return (
            <Pressable
              key={s.value}
              onPress={() => !s.disabled && setSort(s.value)}
              disabled={s.disabled}
              style={[
                styles.rangeChip,
                { borderColor: t.border, backgroundColor: t.elev },
                active && { backgroundColor: t.accent, borderColor: t.accent },
                s.disabled && { opacity: 0.4 },
              ]}
            >
              <Text style={[
                styles.rangeChipText,
                { color: t.fg },
                active && { color: '#fff' },
              ]}>{s.label}</Text>
            </Pressable>
          );
        })}
        {geo.kind === 'ok' && ([5, 15, 30, 60] as const).map((mi) => (
          <Pressable
            key={`r${mi}`}
            onPress={() => setRadiusMi(mi)}
            style={[
              styles.rangeChip,
              { borderColor: t.border, backgroundColor: t.elev },
              radiusMi === mi && { backgroundColor: t.accent, borderColor: t.accent },
            ]}
          >
            <Text style={[
              styles.rangeChipText,
              { color: t.fg },
              radiusMi === mi && { color: '#fff' },
            ]}>{mi} mi</Text>
          </Pressable>
        ))}
        <Pressable
          onPress={() => setFreeOnly((v) => !v)}
          style={[
            styles.rangeChip,
            { borderColor: t.border, backgroundColor: t.elev },
            freeOnly && { backgroundColor: t.accent, borderColor: t.accent },
          ]}
        >
          <Text style={[styles.rangeChipText, { color: t.fg }, freeOnly && { color: '#fff' }]}>Free only</Text>
        </Pressable>
        <Pressable
          onPress={() => setIncludeUnavailable((v) => !v)}
          style={[
            styles.rangeChip,
            { borderColor: t.border, backgroundColor: t.elev },
            includeUnavailable && { backgroundColor: t.accent, borderColor: t.accent },
          ]}
        >
          <Text style={[styles.rangeChipText, { color: t.fg }, includeUnavailable && { color: '#fff' }]}>
            Include sold-out
          </Text>
        </Pressable>
      </ScrollView>

      <View style={styles.rangeRow}>
        {[1, 7, 14, 30, 0].map((d) => (
          <Pressable
            key={d}
            onPress={() => setDaysAhead(d)}
            style={[
              styles.rangeChip,
              { borderColor: t.border, backgroundColor: t.elev },
              daysAhead === d && { backgroundColor: t.accent, borderColor: t.accent },
            ]}
          >
            <Text style={[
              styles.rangeChipText,
              { color: t.fg },
              daysAhead === d && { color: '#fff' },
            ]}>
              {d === 0 ? 'All' : d === 1 ? 'Today' : d === 7 ? '7 days' : d === 14 ? '2 weeks' : '1 month'}
            </Text>
          </Pressable>
        ))}
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.catScroll}
        contentContainerStyle={styles.catRow}
      >
        {orderedCategories.map((key) => {
          const c = CATEGORIES[key];
          const active = activeCategories.has(key);
          return (
            <Pressable
              key={key}
              onPress={() => toggleCategory(key)}
              style={[
                styles.chip,
                { borderColor: t.border, backgroundColor: t.elev },
                active && { backgroundColor: t.accent, borderColor: t.accent },
              ]}
            >
              <Text style={[
                styles.chipText,
                { color: t.fg },
                active && { color: '#fff' },
              ]}>
                {c.emoji} {c.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {error && (
        <View style={[styles.errorBox, { backgroundColor: t.dangerSoft }]}>
          <Text style={{ color: t.danger }}>Failed to load: {error}</Text>
        </View>
      )}

      {loading && items === null ? (
        <ActivityIndicator style={{ marginTop: 32 }} color={t.accent} size="large" />
      ) : items && items.length === 0 ? (
        <View style={styles.empty}>
          <Text style={[styles.emptyTitle, { color: t.fg }]}>Nothing matches</Text>
          <Text style={[styles.emptyBody, { color: t.muted }]}>Try clearing filters or widening the date range.</Text>
        </View>
      ) : (
        <SectionList
          sections={groupedSections}
          keyExtractor={(item) => ('__ad' in item ? item.key : item.id)}
          renderItem={({ item }) => {
            if ('__ad' in item) return <AdSlot kind="infeed" hidden={noAds} />;
            return (
              <ActivityRow
                activity={item}
                t={t}
                onRate={() => setRatingTarget(item)}
                onPress={() => setDetailActivity(item)}
              />
            );
          }}
          ListHeaderComponent={() => <AdSlot kind="banner" hidden={noAds} />}
          renderSectionHeader={({ section: { title } }) => (
            <Text style={[styles.dayHeading, { color: t.fg, backgroundColor: t.bg }]}>{title}</Text>
          )}
          stickySectionHeadersEnabled={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.accent} />}
          style={styles.list}
          contentContainerStyle={{ paddingBottom: 60 }}
          ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
          SectionSeparatorComponent={() => <View style={{ height: 6 }} />}
          onEndReached={loadMore}
          onEndReachedThreshold={0.6}
          ListFooterComponent={() => (
            <View>
              {loadingMore && (
                <Text style={{ color: t.muted, fontSize: 12, textAlign: 'center', paddingVertical: 12 }}>
                  Loading more…
                </Text>
              )}
              <Text style={[styles.disclaimer, { color: t.subtle }]}>
                Events listed here are organized and run by third parties. Proactivity aggregates publicly available listings but is not responsible for event content, accuracy, conduct, or anything that happens at or as a result of attending. Verify details with the event organizer and use your own judgment.
              </Text>
              <Pressable
                onPress={() => Linking.openURL('https://proactivity.app/privacy').catch(() => {})}
                style={{ paddingVertical: 8, alignItems: 'center' }}
              >
                <Text style={{ color: t.muted, fontSize: 11 }}>Privacy policy</Text>
              </Pressable>
            </View>
          )}
        />
      )}

      {detailActivity && (
        <EventDetailOverlay
          activity={detailActivity}
          t={t}
          onClose={() => setDetailActivity(null)}
          onRate={() => { setRatingTarget(detailActivity); setDetailActivity(null); }}
        />
      )}

      {ratingTarget && (
        <RatingOverlay activity={ratingTarget} t={t} onClose={() => setRatingTarget(null)} />
      )}

      {showSubmitForm && (
        <SubmitEventOverlay t={t} onClose={() => setShowSubmitForm(false)} />
      )}

      {signInOpen && (
        <SignInOverlay
          t={t}
          initialError={signInError}
          onClose={() => { setSignInOpen(false); setSignInError(null); }}
        />
      )}

      {organizerOpen && me && (
        <OrganizerScreen
          me={me}
          t={t}
          onClose={() => setOrganizerOpen(false)}
        />
      )}

      {locPickerOpen && (
        <LocationPicker
          t={t}
          selectedPresetId={selectedPresetId}
          onUseDevice={detectDeviceLocation}
          onSelectPreset={selectPreset}
          onClose={() => setLocPickerOpen(false)}
        />
      )}

    </View>
  );
}

function GeoBar({
  geo, placeName, t, onPress,
}: {
  geo: GeoState;
  placeName: string | null;
  t: Theme;
  onPress: () => void;
}) {
  let label: string;
  if (geo.kind === 'ok') {
    label = `📍 near ${placeName ?? `${geo.lat.toFixed(2)}, ${geo.lng.toFixed(2)}`}`;
  } else if (geo.kind === 'loading') {
    label = '📍 Detecting location…';
  } else {
    // denied / error / idle — invite the user to pick a place instead.
    label = '📍 Choose a location';
  }
  return (
    <Pressable onPress={onPress} hitSlop={6} style={styles.geoRow}>
      <Text style={[styles.geo, { color: t.muted, flexShrink: 1 }]} numberOfLines={1}>{label}</Text>
      <Text style={[styles.geo, { color: t.accent }]}>  Change ▾</Text>
    </Pressable>
  );
}

function LocationPicker({
  t, selectedPresetId, onUseDevice, onSelectPreset, onClose,
}: {
  t: Theme;
  selectedPresetId: string | null;
  onUseDevice: () => void;
  onSelectPreset: (id: string) => void;
  onClose: () => void;
}) {
  const Row = ({
    label, active, onPress,
  }: {
    label: string;
    active: boolean;
    onPress: () => void;
  }) => (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.locRow, { borderColor: t.border }, pressed && { opacity: 0.6 }]}
    >
      <Text style={[styles.locRowLabel, { color: t.fg }]}>{label}</Text>
      {active && <Text style={{ color: t.accent, fontSize: 16 }}>✓</Text>}
    </Pressable>
  );

  return (
    <Modal transparent animationType="fade" visible onRequestClose={onClose}>
      <Pressable style={styles.locBackdrop} onPress={onClose}>
        <Pressable
          style={[styles.locSheet, { backgroundColor: t.elev, borderColor: t.border }]}
          onPress={() => {}}
        >
          <Text style={[styles.locTitle, { color: t.fg }]}>Location</Text>
          <Row
            label="📍 Use my current location"
            active={selectedPresetId === null}
            onPress={() => { onUseDevice(); onClose(); }}
          />
          {LOCATION_PRESETS.map((p) => (
            <Row
              key={p.id}
              label={p.label}
              active={selectedPresetId === p.id}
              onPress={() => { onSelectPreset(p.id); onClose(); }}
            />
          ))}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function ActivityRow({
  activity, t, onRate, onPress,
}: {
  activity: Activity;
  t: Theme;
  onRate: () => void;
  onPress: () => void;
}) {
  const [imgFailed, setImgFailed] = useState(false);
  // Show times in the event's own timezone, not the viewer's device tz.
  const tz = safeTimeZone(activity.timezone);
  const start = new Date(activity.startAt);
  const when = start.toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: tz,
  });
  // Append end time when same-day so open-gym style slots read e.g.
  // "Thu, May 21, 8:00 AM – 8:00 PM" instead of just the start.
  const end = activity.endAt ? new Date(activity.endAt) : null;
  const sameDayEnd = end && !isNaN(end.getTime()) && end.toDateString() === start.toDateString();
  const whenWithEnd = sameDayEnd
    ? `${when} – ${end!.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', timeZone: tz })}`
    : when;
  const place = [activity.venueName, activity.city].filter(Boolean).join(' · ');
  const distance = activity.distanceMeters != null
    ? (activity.distanceMeters * 0.000621371 < 0.5 ? '< 1 mi' : `${(activity.distanceMeters * 0.000621371).toFixed(1)} mi`)
    : null;
  const price = formatPrice(activity.costMinCents, activity.costMaxCents, activity.currency);
  const isAvailable = ['onsale', 'free', 'dropin'].includes(activity.availability);
  const showImage = activity.imageUrl && !imgFailed;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        { backgroundColor: t.elev, borderColor: t.border },
        pressed && { opacity: 0.7 },
      ]}
    >
      {showImage ? (
        <Image
          source={{ uri: activity.imageUrl! }}
          style={styles.cardImg}
          onError={() => setImgFailed(true)}
        />
      ) : (
        (() => {
          const ph = placeholderFor({
            title: activity.title,
            venueName: activity.venueName,
            organizerName: activity.organizer?.name,
            canonicalCategories: activity.canonicalCategories,
          });
          return (
            <View style={[styles.cardImg, styles.cardImgPlaceholder, { backgroundColor: ph.color }]}>
              <Text style={styles.cardImgEmoji}>{ph.emoji}</Text>
            </View>
          );
        })()
      )}
      <View style={styles.cardBody}>
        <Text numberOfLines={2} style={[styles.cardTitle, { color: t.fg }]}>{activity.title}</Text>
        <Text style={[styles.cardMeta, { color: t.muted }]} numberOfLines={1}>
          {whenWithEnd}
        </Text>
        {(place || distance) && (
          <Text style={[styles.cardMeta, { color: t.fg, marginTop: 2 }]} numberOfLines={1}>
            {place ? `📍 ${place}` : ''}
            {place && distance ? ' · ' : ''}
            {distance ?? ''}
          </Text>
        )}
        {activity.organizer?.name && (
          <Text style={[styles.cardMeta, { color: t.muted, marginTop: 2 }]} numberOfLines={1}>
            by <Text style={{ color: t.fg, fontWeight: '600' }}>{activity.organizer.name}</Text>
          </Text>
        )}
        <View style={styles.cardBottom}>
          <View style={styles.cardBadges}>
            <View style={[styles.badge, { backgroundColor: isAvailable ? t.successSoft : t.dangerSoft }]}>
              <Text style={{ color: isAvailable ? t.success : t.danger, fontSize: 11 }}>
                {availabilityLabel(activity.availability)}
              </Text>
            </View>
            {activity.ageRange && (
              <View style={[styles.badge, { backgroundColor: t.accent + '22' }]}>
                <Text style={{ color: t.accent, fontSize: 11 }}>{activity.ageRange.label}</Text>
              </View>
            )}
            {activity.ratingCount > 0 && activity.ratingAverage != null && (
              <Text style={{ color: '#f59e0b', fontSize: 12, fontWeight: '500' }}>
                ★ {activity.ratingAverage.toFixed(1)} <Text style={{ color: t.subtle }}>({activity.ratingCount})</Text>
              </Text>
            )}
            {activity.organizer && activity.organizer.ratingCount > 0 && activity.organizer.ratingAverage != null && (
              <Text style={{ color: t.accent, fontSize: 11 }}>
                org ★ {activity.organizer.ratingAverage.toFixed(1)} <Text style={{ color: t.subtle }}>({activity.organizer.ratingCount})</Text>
              </Text>
            )}
          </View>
          {price && <Text style={[styles.price, { color: t.fg }]}>{price}</Text>}
        </View>
        <Pressable
          onPress={(e) => {
            e.stopPropagation();
            onRate();
          }}
          hitSlop={6}
          style={styles.cardRateBtn}
        >
          <Text style={{ color: t.accent, fontSize: 12 }}>Rate ▸</Text>
        </Pressable>
      </View>
    </Pressable>
  );
}

function SignInOverlay({
  t, initialError, onClose,
}: {
  t: Theme;
  initialError: string | null;
  onClose: () => void;
}) {
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(initialError);

  const submit = async () => {
    setError(null);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError('Enter a valid email.');
      return;
    }
    setSubmitting(true);
    try {
      await requestMagicLink(email.trim());
      setSent(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={[styles.onboardOverlay, { backgroundColor: t.bg }]}>
      {sent ? (
        <>
          <Text style={[styles.onboardTitle, { color: t.fg }]}>Check your email</Text>
          <Text style={[styles.onboardSubtitle, { color: t.muted }]}>
            We sent a sign-in link to <Text style={{ color: t.fg, fontWeight: '500' }}>{email}</Text>.
            Tap "Open in app" in the email to finish signing in here. The link expires in 15 minutes.
          </Text>
          <Pressable onPress={onClose} style={[styles.onboardPrimary, { backgroundColor: t.accent }]}>
            <Text style={styles.onboardPrimaryText}>Close</Text>
          </Pressable>
        </>
      ) : (
        <>
          <Text style={[styles.onboardTitle, { color: t.fg }]}>Sign in</Text>
          <Text style={[styles.onboardSubtitle, { color: t.muted }]}>
            Enter your email and we'll send you a one-time sign-in link. No password.
          </Text>
          <TextInput
            value={email}
            onChangeText={setEmail}
            placeholder="you@example.com"
            placeholderTextColor={t.subtle}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="email"
            maxLength={200}
            style={[styles.search, { color: t.fg, borderColor: t.border, backgroundColor: t.elev }]}
          />
          {error && <Text style={{ color: t.danger, marginVertical: 8 }}>{error}</Text>}
          <Pressable
            onPress={submit}
            disabled={submitting || !email}
            style={[styles.onboardPrimary, { backgroundColor: t.accent, opacity: submitting || !email ? 0.55 : 1 }]}
          >
            <Text style={styles.onboardPrimaryText}>{submitting ? 'Sending…' : 'Send me a sign-in link'}</Text>
          </Pressable>
          <Pressable onPress={onClose} style={styles.onboardSkip}>
            <Text style={[styles.onboardSkipText, { color: t.muted }]}>Cancel</Text>
          </Pressable>
        </>
      )}
    </View>
  );
}

function SubmitEventOverlay({ t, onClose }: { t: Theme; onClose: () => void }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [organization, setOrganization] = useState('');
  const [eventUrl, setEventUrl] = useState('');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError('A valid email is required.');
      return;
    }
    if (message.trim().length < 10) {
      setError('Tell us a bit about the event (10+ characters).');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`${API_BASE}/api/contact`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim() || undefined,
          email: email.trim(),
          organization: organization.trim() || undefined,
          eventUrl: eventUrl.trim() || undefined,
          message: message.trim(),
        }),
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(d.error ?? `HTTP ${res.status}`);
      }
      setSubmitted(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={[styles.onboardOverlay, { backgroundColor: t.bg }]}>
      {submitted ? (
        <>
          <Text style={[styles.onboardTitle, { color: t.fg }]}>Thanks!</Text>
          <Text style={[styles.onboardSubtitle, { color: t.muted }]}>
            We got your message. We'll reach out at {email} after reviewing.
          </Text>
          <Pressable onPress={onClose} style={[styles.onboardPrimary, { backgroundColor: t.accent }]}>
            <Text style={styles.onboardPrimaryText}>Close</Text>
          </Pressable>
        </>
      ) : (
        <ScrollView contentContainerStyle={{ paddingBottom: 24 }} showsVerticalScrollIndicator={false}>
          <Text style={[styles.onboardTitle, { color: t.fg }]}>Submit your event</Text>
          <Text style={[styles.onboardSubtitle, { color: t.muted }]}>
            Run a venue or host meetups? Tell us and we'll add it to the calendar.
          </Text>
          <TextInput value={name} onChangeText={setName} placeholder="Your name" placeholderTextColor={t.subtle}
            style={[styles.search, { color: t.fg, borderColor: t.border, backgroundColor: t.elev, marginBottom: 8 }]} maxLength={120} />
          <TextInput value={email} onChangeText={setEmail} placeholder="Email (required)" placeholderTextColor={t.subtle}
            keyboardType="email-address" autoCapitalize="none"
            style={[styles.search, { color: t.fg, borderColor: t.border, backgroundColor: t.elev, marginBottom: 8 }]} maxLength={200} />
          <TextInput value={organization} onChangeText={setOrganization} placeholder="Organization or venue" placeholderTextColor={t.subtle}
            style={[styles.search, { color: t.fg, borderColor: t.border, backgroundColor: t.elev, marginBottom: 8 }]} maxLength={200} />
          <TextInput value={eventUrl} onChangeText={setEventUrl} placeholder="Event URL (optional)" placeholderTextColor={t.subtle}
            keyboardType="url" autoCapitalize="none"
            style={[styles.search, { color: t.fg, borderColor: t.border, backgroundColor: t.elev, marginBottom: 8 }]} maxLength={500} />
          <TextInput value={message} onChangeText={setMessage} placeholder="Tell us about your event (required)" placeholderTextColor={t.subtle}
            multiline numberOfLines={5} maxLength={4000}
            style={[styles.ratingTextarea, { color: t.fg, borderColor: t.border, backgroundColor: t.elev, minHeight: 110 }]} />
          {error && <Text style={{ color: t.danger, marginVertical: 8 }}>{error}</Text>}
          <Pressable
            onPress={submit}
            disabled={submitting}
            style={[styles.onboardPrimary, { backgroundColor: t.accent, opacity: submitting ? 0.55 : 1 }]}
          >
            <Text style={styles.onboardPrimaryText}>{submitting ? 'Sending…' : 'Send'}</Text>
          </Pressable>
          <Pressable onPress={onClose} style={styles.onboardSkip}>
            <Text style={[styles.onboardSkipText, { color: t.muted }]}>Cancel</Text>
          </Pressable>
        </ScrollView>
      )}
    </View>
  );
}

function EventDetailOverlay({
  activity, t, onClose, onRate,
}: {
  activity: Activity;
  t: Theme;
  onClose: () => void;
  onRate: () => void;
}) {
  const [imgFailed, setImgFailed] = useState(false);
  // Show times in the event's own timezone, not the viewer's device tz.
  const tz = safeTimeZone(activity.timezone);
  const start = new Date(activity.startAt);
  const end = activity.endAt ? new Date(activity.endAt) : null;
  const sameDayEnd = end && !isNaN(end.getTime()) && end.toDateString() === start.toDateString();
  const dateLabel = start.toLocaleString(undefined, {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZone: tz,
  });
  const endLabel = end && !isNaN(end.getTime())
    ? (sameDayEnd
        ? end.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', timeZone: tz })
        : end.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: tz }))
    : null;
  const place = [activity.venueName, activity.city].filter(Boolean).join(' · ');
  const price = formatPrice(activity.costMinCents, activity.costMaxCents, activity.currency);
  const isAvailable = ['onsale', 'free', 'dropin'].includes(activity.availability);
  const showImage = activity.imageUrl && !imgFailed;
  const ph = placeholderFor({
    title: activity.title,
    venueName: activity.venueName,
    organizerName: activity.organizer?.name,
    canonicalCategories: activity.canonicalCategories,
  });

  const openExternal = () => {
    // Mirror the web's behavior: only fire click-track when the user
    // actually opens the external page, not when they tap the card.
    fetch(`${API_BASE}/api/activities/click`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: activity.id }),
    }).catch(() => {});
    if (activity.url) {
      Linking.openURL(activity.url).catch(() => {});
      onClose();
    }
  };

  return (
    <View style={[styles.onboardOverlay, { backgroundColor: t.bg }]}>
      <Pressable onPress={onClose} style={[styles.detailClose, { backgroundColor: t.elev, borderColor: t.border }]} hitSlop={8}>
        <Text style={{ color: t.fg, fontSize: 14 }}>← Back</Text>
      </Pressable>
      <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
        {showImage ? (
          <Image
            source={{ uri: activity.imageUrl! }}
            style={styles.detailHero}
            onError={() => setImgFailed(true)}
          />
        ) : (
          <View style={[styles.detailHero, styles.detailHeroPlaceholder, { backgroundColor: ph.color }]}>
            <Text style={styles.detailHeroEmoji}>{ph.emoji}</Text>
          </View>
        )}

        <Text style={[styles.detailTitle, { color: t.fg }]}>{activity.title}</Text>

        {activity.organizer?.name && (
          <Text style={[styles.detailOrg, { color: t.muted }]}>
            by <Text style={{ color: t.fg, fontWeight: '600' }}>{activity.organizer.name}</Text>
            {activity.organizer.ratingCount > 0 && activity.organizer.ratingAverage != null && (
              <Text style={{ color: '#f59e0b' }}>  ★ {activity.organizer.ratingAverage.toFixed(1)} <Text style={{ color: t.subtle }}>({activity.organizer.ratingCount})</Text></Text>
            )}
          </Text>
        )}

        <View style={[styles.detailMetaBlock, { borderColor: t.border }]}>
          <Text style={[styles.detailMetaLabel, { color: t.muted }]}>When</Text>
          <Text style={[styles.detailMetaValue, { color: t.fg }]}>
            {dateLabel}{endLabel ? ` → ${endLabel}` : ''}
          </Text>
        </View>

        {place && (() => {
          // Coords beat free-text address for accurate routing — fall back
          // to the readable place string only when we have no pin.
          const dest = activity.lat != null && activity.lng != null
            ? `${activity.lat},${activity.lng}`
            : place;
          const mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(dest)}`;
          return (
            <Pressable
              onPress={() => Linking.openURL(mapsUrl).catch(() => {})}
              style={[styles.detailMetaBlock, { borderColor: t.border }]}
            >
              <Text style={[styles.detailMetaLabel, { color: t.muted }]}>Where</Text>
              <Text style={[styles.detailMetaValue, { color: t.accent }]}>{place} ↗</Text>
            </Pressable>
          );
        })()}

        <View style={styles.detailBadgeRow}>
          <View style={[styles.badge, { backgroundColor: isAvailable ? t.successSoft : t.dangerSoft }]}>
            <Text style={{ color: isAvailable ? t.success : t.danger, fontSize: 12 }}>
              {availabilityLabel(activity.availability)}
            </Text>
          </View>
          {price && (
            <View style={[styles.badge, { backgroundColor: t.elev, borderColor: t.border, borderWidth: 1 }]}>
              <Text style={{ color: t.fg, fontSize: 12, fontWeight: '600' }}>{price}</Text>
            </View>
          )}
          {activity.ageRange && (
            <View style={[styles.badge, { backgroundColor: t.accent + '22' }]}>
              <Text style={{ color: t.accent, fontSize: 12 }}>{activity.ageRange.label}</Text>
            </View>
          )}
          {activity.ratingCount > 0 && activity.ratingAverage != null && (
            <Text style={{ color: '#f59e0b', fontSize: 13, fontWeight: '500', alignSelf: 'center' }}>
              ★ {activity.ratingAverage.toFixed(1)} <Text style={{ color: t.subtle }}>({activity.ratingCount})</Text>
            </Text>
          )}
        </View>

        {activity.url && (
          <Pressable
            onPress={openExternal}
            style={[styles.onboardPrimary, { backgroundColor: t.accent, marginTop: 16 }]}
          >
            <Text style={styles.onboardPrimaryText}>Get tickets / official page ↗</Text>
          </Pressable>
        )}

        {activity.description && (
          <View style={{ marginTop: 20 }}>
            <Text style={[styles.detailSectionHeading, { color: t.fg }]}>About</Text>
            <Text style={[styles.detailDescription, { color: t.fg }]}>{activity.description}</Text>
          </View>
        )}

        {activity.canonicalCategories.length > 0 && (
          <View style={styles.detailTagRow}>
            {activity.canonicalCategories.slice(0, 6).map((k) => (
              <View key={k} style={[styles.detailTag, { borderColor: t.border, backgroundColor: t.elev }]}>
                <Text style={{ color: t.fg, fontSize: 12 }}>{CATEGORIES[k].emoji} {CATEGORIES[k].label}</Text>
              </View>
            ))}
          </View>
        )}

        <Pressable onPress={onRate} style={[styles.onboardSkip, { marginTop: 12 }]}>
          <Text style={[styles.onboardSkipText, { color: t.accent }]}>Rate this event ▸</Text>
        </Pressable>

        <Text style={[styles.detailDisclaimer, { color: t.subtle }]}>
          Aggregated from public sources. Verify details with the organizer before attending.
        </Text>
      </ScrollView>
    </View>
  );
}

function RatingOverlay({ activity, t, onClose }: { activity: Activity; t: Theme; onClose: () => void }) {
  const [target, setTarget] = useState<'event' | 'organizer'>('event');
  const [score, setScore] = useState(0);
  const [review, setReview] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (score < 1) {
      setError('Pick a star rating first.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/ratings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          activityId: activity.id,
          target,
          score,
          review: review.trim() || undefined,
          submitterName: name.trim() || undefined,
          submitterEmail: email.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      setSubmitted(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={[styles.onboardOverlay, { backgroundColor: t.bg }]}>
      {submitted ? (
        <>
          <Text style={[styles.onboardTitle, { color: t.fg }]}>Thanks!</Text>
          <Text style={[styles.onboardSubtitle, { color: t.muted }]}>
            Your review of "{activity.title}" is pending approval. It'll show once an admin OKs it.
          </Text>
          <Pressable onPress={onClose} style={[styles.onboardPrimary, { backgroundColor: t.accent }]}>
            <Text style={styles.onboardPrimaryText}>Close</Text>
          </Pressable>
        </>
      ) : (
        <ScrollView contentContainerStyle={{ paddingBottom: 24 }} showsVerticalScrollIndicator={false}>
          <Text style={[styles.onboardTitle, { color: t.fg }]}>
            {target === 'event' ? 'Rate this event' : `Rate ${activity.organizer?.name ?? 'this organizer'}`}
          </Text>
          <Text style={[styles.onboardSubtitle, { color: t.muted }]} numberOfLines={2}>
            {target === 'event'
              ? activity.title
              : `Your rating applies to all events from ${activity.organizer?.name ?? 'this organizer'}.`}
          </Text>
          {activity.organizer?.name && (
            <View style={[styles.ratingToggleRow, { backgroundColor: t.sunken }]}>
              <Pressable
                onPress={() => setTarget('event')}
                style={[styles.ratingToggleTab, target === 'event' && { backgroundColor: t.elev }]}
              >
                <Text style={{ color: target === 'event' ? t.fg : t.muted, fontSize: 13, fontWeight: target === 'event' ? '500' : '400' }}>
                  This event
                </Text>
              </Pressable>
              <Pressable
                onPress={() => setTarget('organizer')}
                style={[styles.ratingToggleTab, target === 'organizer' && { backgroundColor: t.elev }]}
              >
                <Text style={{ color: target === 'organizer' ? t.fg : t.muted, fontSize: 13, fontWeight: target === 'organizer' ? '500' : '400' }}>
                  Organizer
                </Text>
              </Pressable>
            </View>
          )}
          <View style={styles.starRow}>
            {[1, 2, 3, 4, 5].map((n) => (
              <Pressable key={n} onPress={() => setScore(n)} hitSlop={6}>
                <Text style={{ fontSize: 36, color: score >= n ? '#f59e0b' : t.border, marginHorizontal: 4 }}>
                  ★
                </Text>
              </Pressable>
            ))}
          </View>
          <TextInput
            value={review}
            onChangeText={setReview}
            multiline
            numberOfLines={4}
            maxLength={2000}
            placeholder="Optional — what was it like?"
            placeholderTextColor={t.subtle}
            style={[styles.ratingTextarea, { color: t.fg, borderColor: t.border, backgroundColor: t.elev }]}
          />
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="Your name (optional)"
            placeholderTextColor={t.subtle}
            maxLength={80}
            style={[styles.search, { color: t.fg, borderColor: t.border, backgroundColor: t.elev, marginBottom: 8 }]}
          />
          <TextInput
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            placeholder="Email (optional, not shown publicly)"
            placeholderTextColor={t.subtle}
            maxLength={200}
            style={[styles.search, { color: t.fg, borderColor: t.border, backgroundColor: t.elev }]}
          />
          {error && <Text style={{ color: t.danger, marginVertical: 8 }}>{error}</Text>}
          <Pressable
            onPress={submit}
            disabled={submitting || score < 1}
            style={[
              styles.onboardPrimary,
              { backgroundColor: t.accent, opacity: submitting || score < 1 ? 0.55 : 1 },
            ]}
          >
            <Text style={styles.onboardPrimaryText}>
              {submitting ? 'Submitting…' : 'Submit review'}
            </Text>
          </Pressable>
          <Pressable onPress={onClose} style={styles.onboardSkip}>
            <Text style={[styles.onboardSkipText, { color: t.muted }]}>Cancel</Text>
          </Pressable>
        </ScrollView>
      )}
    </View>
  );
}

/**
 * Group activities into day-bucketed sections, matching the web's day-label
 * scheme (Today / Tomorrow / weekday name / "Mon, Jun 3").
 */
function groupByDay(items: Activity[]): { title: string; data: Activity[] }[] {
  if (items.length === 0) return [];
  const map = new Map<string, Activity[]>();
  const order: string[] = [];
  for (const a of items) {
    const label = dayLabel(new Date(a.startAt));
    if (!map.has(label)) { map.set(label, []); order.push(label); }
    map.get(label)!.push(a);
  }
  return order.map((title) => ({ title, data: map.get(title)! }));
}

function dayLabel(date: Date): string {
  const now = new Date();
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffDays = Math.round((start.getTime() - today.getTime()) / 86400000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Tomorrow';
  if (diffDays >= 2 && diffDays <= 6) {
    return date.toLocaleDateString(undefined, { weekday: 'long' });
  }
  return date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

function availabilityLabel(a: string): string {
  switch (a) {
    case 'onsale': return 'On sale';
    case 'free': return 'Free';
    case 'dropin': return 'Drop-in';
    case 'sold_out': return 'Sold out';
    case 'cancelled': return 'Cancelled';
    default: return 'TBD';
  }
}

function formatPrice(min: number | null, max: number | null, currency: string | null): string | null {
  if (min == null && max == null) return null;
  if (min === 0 && (max == null || max === 0)) return 'Free';
  const cur = currency ?? 'USD';
  const fmt = (cents: number) =>
    new Intl.NumberFormat(undefined, { style: 'currency', currency: cur, maximumFractionDigits: 0 }).format(cents / 100);
  if (min != null && max != null && min !== max) return `${fmt(min)}–${fmt(max)}`;
  return fmt((min ?? max) as number);
}

function Logo({ size = 22, color }: { size?: number; color: string }) {
  // Triangle proportions tuned to match the SVG version on web.
  const triH = size * 0.36; // triangle height (top+bottom borders)
  const triW = size * 0.3;  // triangle width (left border)
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: color,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <View
        style={{
          width: 0,
          height: 0,
          borderTopWidth: triH / 2,
          borderBottomWidth: triH / 2,
          borderLeftWidth: triW,
          borderTopColor: 'transparent',
          borderBottomColor: 'transparent',
          borderLeftColor: '#ffffff',
          marginLeft: size * 0.08, // optical balance
        }}
      />
    </View>
  );
}

// ----- theme -----
interface Theme {
  bg: string; elev: string; sunken: string;
  fg: string; muted: string; subtle: string;
  border: string; accent: string;
  success: string; successSoft: string;
  danger: string; dangerSoft: string;
}
const light: Theme = {
  bg: '#fafaf9', elev: '#ffffff', sunken: '#f4f4f2',
  fg: '#18181b', muted: '#71717a', subtle: '#a1a1aa',
  border: '#e4e4e7', accent: '#6d28d9',
  success: '#15803d', successSoft: '#dcfce7',
  danger: '#b91c1c', dangerSoft: '#fee2e2',
};
const dark: Theme = {
  bg: '#0a0a0b', elev: '#18181b', sunken: '#050506',
  fg: '#fafafa', muted: '#a1a1aa', subtle: '#71717a',
  border: '#27272a', accent: '#a78bfa',
  success: '#4ade80', successSoft: 'rgba(74, 222, 128, 0.12)',
  danger: '#f87171', dangerSoft: 'rgba(248, 113, 113, 0.15)',
};

const styles = StyleSheet.create({
  root: { flex: 1, paddingTop: Platform.OS === 'ios' ? 60 : 36, paddingHorizontal: 16 },
  header: { marginBottom: 12 },
  wordmarkRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 11, height: 11, borderRadius: 6 },
  wordmark: { fontSize: 24, fontWeight: '700', letterSpacing: -0.5 },
  tagline: { marginTop: 2, fontSize: 13 },
  geo: { marginTop: 8, fontSize: 12 },
  geoRow: { flexDirection: 'row', alignItems: 'center' },
  locBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  locSheet: { borderRadius: 16, borderWidth: 1, padding: 16 },
  locTitle: { fontSize: 16, fontWeight: '700', marginBottom: 10 },
  locRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderTopWidth: 1,
  },
  locRowLabel: { fontSize: 15 },
  search: {
    paddingVertical: 10, paddingHorizontal: 14,
    borderRadius: 10, borderWidth: 1, fontSize: 15,
    marginBottom: 10,
  },
  rangeRow: { flexDirection: 'row', gap: 6, marginBottom: 8 },
  rangeChip: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1 },
  rangeChipText: { fontSize: 13 },
  catScroll: { flexGrow: 0, marginBottom: 10 },
  catRow: { gap: 6, paddingVertical: 4, paddingRight: 16 },
  list: { flex: 1 },
  chip: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1, marginRight: 6 },
  chipText: { fontSize: 13 },
  card: { flexDirection: 'row', borderRadius: 14, borderWidth: 1, padding: 10, gap: 10 },
  cardImg: { width: 72, height: 72, borderRadius: 10 },
  cardImgPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  cardImgEmoji: { fontSize: 30 },
  cardBody: { flex: 1 },
  cardTitle: { fontSize: 14, fontWeight: '600', marginBottom: 3 },
  cardMeta: { fontSize: 12 },
  cardBottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 },
  cardBadges: { flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 1 },
  badge: { paddingVertical: 2, paddingHorizontal: 8, borderRadius: 999 },
  price: { fontSize: 13, fontWeight: '600' },
  errorBox: { padding: 10, borderRadius: 10, marginVertical: 8 },
  empty: { padding: 32, alignItems: 'center', marginTop: 16 },
  emptyTitle: { fontSize: 16, fontWeight: '600', marginBottom: 4 },
  emptyBody: { fontSize: 13, textAlign: 'center' },
  onboardOverlay: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    paddingTop: Platform.OS === 'ios' ? 80 : 50,
    paddingHorizontal: 24,
    paddingBottom: 32,
  },
  onboardTitle: { fontSize: 26, fontWeight: '700', letterSpacing: -0.5, marginTop: 24, marginBottom: 8 },
  onboardSubtitle: { fontSize: 14, lineHeight: 20, marginBottom: 20 },
  onboardChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingBottom: 20 },
  onboardChip: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 999, borderWidth: 1, marginRight: 4, marginBottom: 4 },
  onboardChipText: { fontSize: 15 },
  onboardPrimary: { paddingVertical: 14, paddingHorizontal: 20, borderRadius: 12, alignItems: 'center', marginTop: 12 },
  onboardPrimaryText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  onboardSkip: { paddingVertical: 12, alignItems: 'center' },
  onboardSkipText: { fontSize: 13 },
  detailClose: { alignSelf: 'flex-start', borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6, marginBottom: 8 },
  detailHero: { width: '100%', aspectRatio: 16 / 9, borderRadius: 12, backgroundColor: '#e5e7eb' },
  detailHeroPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  detailHeroEmoji: { fontSize: 64 },
  detailTitle: { fontSize: 22, fontWeight: '700', letterSpacing: -0.3, marginTop: 14 },
  detailOrg: { fontSize: 14, marginTop: 4 },
  detailMetaBlock: { marginTop: 14, borderTopWidth: 1, paddingTop: 10 },
  detailMetaLabel: { fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 },
  detailMetaValue: { fontSize: 15, lineHeight: 21 },
  detailBadgeRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginTop: 14 },
  detailSectionHeading: { fontSize: 16, fontWeight: '600', marginBottom: 6 },
  detailDescription: { fontSize: 14, lineHeight: 21 },
  detailTagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 16 },
  detailTag: { paddingVertical: 4, paddingHorizontal: 10, borderRadius: 999, borderWidth: 1 },
  detailDisclaimer: { fontSize: 11, marginTop: 20, textAlign: 'center' },
  cardRateBtn: { position: 'absolute', right: 10, bottom: 8, paddingVertical: 2 },
  starRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginVertical: 12 },
  ratingTextarea: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
    fontSize: 14,
    marginBottom: 8,
    minHeight: 80,
    textAlignVertical: 'top',
  },
  ratingToggleRow: { flexDirection: 'row', borderRadius: 8, padding: 4, marginVertical: 8, gap: 4 },
  ratingToggleTab: { flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: 6 },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
  headerCta: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 10, marginTop: 4 },
  disclaimer: { fontSize: 10, lineHeight: 14, marginTop: 24, paddingHorizontal: 8, textAlign: 'center' },
  dayHeading: { fontSize: 13, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5, paddingTop: 14, paddingBottom: 6 },
});
