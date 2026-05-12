import { StatusBar } from 'expo-status-bar';
import * as Location from 'expo-location';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Constants from 'expo-constants';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Linking,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useColorScheme,
  View,
} from 'react-native';
import { ALL_CATEGORY_KEYS, CATEGORIES, type CategoryKey } from './lib/categories';
import { placeholderFor } from './lib/icons';

const API_BASE = (Constants.expoConfig?.extra as { apiBaseUrl?: string } | undefined)?.apiBaseUrl
  ?? 'https://proactivity-web.vercel.app';

interface Activity {
  id: string;
  title: string;
  description: string | null;
  startAt: string;
  venueName: string | null;
  city: string | null;
  costMinCents: number | null;
  costMaxCents: number | null;
  currency: string | null;
  availability: string;
  url: string | null;
  imageUrl: string | null;
  canonicalCategories: CategoryKey[];
  distanceMeters: number | null;
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
  const [items, setItems] = useState<Activity[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [activeCategories, setActiveCategories] = useState<Set<CategoryKey>>(new Set());
  const [daysAhead, setDaysAhead] = useState(7);

  // Geolocation on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setGeo({ kind: 'loading' });
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (cancelled) return;
        if (status !== 'granted') {
          setGeo({ kind: 'denied' });
          return;
        }
        const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low });
        if (cancelled) return;
        setGeo({ kind: 'ok', lat: pos.coords.latitude, lng: pos.coords.longitude });
      } catch (e) {
        if (!cancelled) setGeo({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Debounce search.
  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => clearTimeout(id);
  }, [search]);

  // Reverse-geocode once location is known.
  useEffect(() => {
    if (geo.kind !== 'ok') return;
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
  }, [geo]);

  const queryString = useMemo(() => {
    const p = new URLSearchParams();
    if (geo.kind === 'ok') {
      p.set('lat', String(geo.lat));
      p.set('lng', String(geo.lng));
      p.set('sort', 'distance');
    } else {
      p.set('sort', 'time');
    }
    p.set('daysAhead', String(daysAhead));
    if (debouncedSearch) p.set('search', debouncedSearch);
    if (activeCategories.size > 0) p.set('category', [...activeCategories].join(','));
    return p.toString();
  }, [geo, daysAhead, debouncedSearch, activeCategories]);

  const fetchActivities = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/activities?${queryString}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { items: Activity[] };
      setItems(data.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [queryString]);

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

  const toggleCategory = useCallback((key: CategoryKey) => {
    setActiveCategories((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  return (
    <View style={[styles.root, { backgroundColor: t.bg }]}>
      <StatusBar style="auto" />
      <View style={styles.header}>
        <View style={styles.wordmarkRow}>
          <View style={[styles.dot, { backgroundColor: t.accent }]} />
          <Text style={[styles.wordmark, { color: t.fg }]}>proactivity</Text>
        </View>
        <Text style={[styles.tagline, { color: t.muted }]}>Things to do near you, this week.</Text>
        <GeoBar geo={geo} placeName={placeName} t={t} />
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

      <View style={styles.rangeRow}>
        {[1, 7, 14, 30].map((d) => (
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
              {d === 1 ? 'Today' : d === 7 ? '7 days' : d === 14 ? '2 weeks' : '1 month'}
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
        {ALL_CATEGORY_KEYS.map((key) => {
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
        <FlatList
          data={items ?? []}
          keyExtractor={(a) => a.id}
          renderItem={({ item }) => <ActivityRow activity={item} t={t} />}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.accent} />}
          style={styles.list}
          contentContainerStyle={{ paddingBottom: 40 }}
          ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
        />
      )}
    </View>
  );
}

function GeoBar({ geo, placeName, t }: { geo: GeoState; placeName: string | null; t: Theme }) {
  let label = '';
  if (geo.kind === 'ok') {
    label = `📍 near ${placeName ?? `${geo.lat.toFixed(2)}, ${geo.lng.toFixed(2)}`}`;
  } else if (geo.kind === 'loading') label = 'Detecting location…';
  else if (geo.kind === 'denied') label = 'Location declined — showing all events by time';
  else if (geo.kind === 'error') label = `Location error: ${geo.message}`;
  if (!label) return null;
  return <Text style={[styles.geo, { color: t.muted }]}>{label}</Text>;
}

function ActivityRow({ activity, t }: { activity: Activity; t: Theme }) {
  const [imgFailed, setImgFailed] = useState(false);
  const start = new Date(activity.startAt);
  const when = start.toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
  const place = [activity.venueName, activity.city].filter(Boolean).join(' · ');
  const distance = activity.distanceMeters != null ? `${(activity.distanceMeters / 1000).toFixed(1)} km` : null;
  const price = formatPrice(activity.costMinCents, activity.costMaxCents, activity.currency);
  const isAvailable = ['onsale', 'free', 'dropin'].includes(activity.availability);
  const showImage = activity.imageUrl && !imgFailed;

  return (
    <Pressable
      onPress={() => activity.url && Linking.openURL(activity.url).catch(() => {})}
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
          const ph = placeholderFor({ title: activity.title, canonicalCategories: activity.canonicalCategories });
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
          {when}{place ? ` · ${place}` : ''}{distance ? ` · ${distance}` : ''}
        </Text>
        <View style={styles.cardBottom}>
          <View style={[
            styles.badge,
            { backgroundColor: isAvailable ? t.successSoft : t.dangerSoft },
          ]}>
            <Text style={{ color: isAvailable ? t.success : t.danger, fontSize: 11 }}>
              {availabilityLabel(activity.availability)}
            </Text>
          </View>
          {price && <Text style={[styles.price, { color: t.fg }]}>{price}</Text>}
        </View>
      </View>
    </Pressable>
  );
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
  badge: { paddingVertical: 2, paddingHorizontal: 8, borderRadius: 999 },
  price: { fontSize: 13, fontWeight: '600' },
  errorBox: { padding: 10, borderRadius: 10, marginVertical: 8 },
  empty: { padding: 32, alignItems: 'center', marginTop: 16 },
  emptyTitle: { fontSize: 16, fontWeight: '600', marginBottom: 4 },
  emptyBody: { fontSize: 13, textAlign: 'center' },
});
