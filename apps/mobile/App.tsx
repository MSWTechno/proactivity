import { StatusBar } from 'expo-status-bar';
import * as Location from 'expo-location';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';
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

const STORAGE_ONBOARDED = 'proactivity:onboarded:v1';
const STORAGE_INTERESTS = 'proactivity:interests:v1';

interface Activity {
  id: string;
  title: string;
  description: string | null;
  startAt: string;
  venueName: string | null;
  city: string | null;
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
  const [items, setItems] = useState<Activity[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [activeCategories, setActiveCategories] = useState<Set<CategoryKey>>(new Set());
  const [daysAhead, setDaysAhead] = useState(7);
  const [orderedCategories, setOrderedCategories] = useState<CategoryKey[]>([...ALL_CATEGORY_KEYS]);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [onboardingChecked, setOnboardingChecked] = useState(false);
  const [ratingTarget, setRatingTarget] = useState<Activity | null>(null);
  const [showSubmitForm, setShowSubmitForm] = useState(false);

  // Fetch site-wide popularity order once on mount.
  useEffect(() => {
    fetch(`${API_BASE}/api/categories/popular`)
      .then((r) => (r.ok ? r.json() : { ordered: [] }))
      .then((d: { ordered?: CategoryKey[] }) => {
        if (d.ordered && d.ordered.length > 0) setOrderedCategories(d.ordered);
      })
      .catch(() => {
        /* keep default order */
      });
  }, []);

  // Onboarding check + pre-fill saved interests.
  useEffect(() => {
    (async () => {
      try {
        const [onboarded, interests] = await Promise.all([
          AsyncStorage.getItem(STORAGE_ONBOARDED),
          AsyncStorage.getItem(STORAGE_INTERESTS),
        ]);
        if (onboarded === '1') {
          if (interests) {
            const arr = JSON.parse(interests) as CategoryKey[];
            if (Array.isArray(arr) && arr.length > 0) {
              setActiveCategories(new Set(arr.filter((k) => ALL_CATEGORY_KEYS.includes(k))));
            }
          }
        } else {
          setShowOnboarding(true);
        }
      } catch {
        /* storage unavailable — proceed without onboarding */
      } finally {
        setOnboardingChecked(true);
      }
    })();
  }, []);

  const completeOnboarding = useCallback(async (skip = false) => {
    setShowOnboarding(false);
    try {
      await AsyncStorage.setItem(STORAGE_ONBOARDED, '1');
      if (!skip) {
        await AsyncStorage.setItem(STORAGE_INTERESTS, JSON.stringify([...activeCategories]));
      }
    } catch {
      /* ignore */
    }
  }, [activeCategories]);

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
    // daysAhead=0 means "all upcoming"; send the sentinel the API expects.
    p.set('daysAhead', daysAhead === 0 ? 'all' : String(daysAhead));
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
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
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
          <Pressable
            onPress={() => setShowSubmitForm(true)}
            style={[styles.headerCta, { backgroundColor: t.accent + '22' }]}
          >
            <Text style={{ color: t.accent, fontSize: 12, fontWeight: '500' }}>Submit event</Text>
          </Pressable>
        </View>
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
        <FlatList
          data={items ?? []}
          keyExtractor={(a) => a.id}
          renderItem={({ item }) => (
            <ActivityRow activity={item} t={t} onRate={() => setRatingTarget(item)} />
          )}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.accent} />}
          style={styles.list}
          contentContainerStyle={{ paddingBottom: 60 }}
          ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
          ListFooterComponent={() => (
            <Text style={[styles.disclaimer, { color: t.subtle }]}>
              Events listed here are organized and run by third parties. Proactivity aggregates publicly available listings but is not responsible for event content, accuracy, conduct, or anything that happens at or as a result of attending. Verify details with the event organizer and use your own judgment.
            </Text>
          )}
        />
      )}

      {ratingTarget && (
        <RatingOverlay activity={ratingTarget} t={t} onClose={() => setRatingTarget(null)} />
      )}

      {showSubmitForm && (
        <SubmitEventOverlay t={t} onClose={() => setShowSubmitForm(false)} />
      )}

      {showOnboarding && onboardingChecked && (
        <View style={[styles.onboardOverlay, { backgroundColor: t.bg }]}>
          <View style={styles.wordmarkRow}>
            <Logo size={22} color={t.accent} />
            <Text style={[styles.wordmark, { color: t.fg }]}>proactivity</Text>
          </View>
          <Text style={[styles.onboardTitle, { color: t.fg }]}>What interests you?</Text>
          <Text style={[styles.onboardSubtitle, { color: t.muted }]}>
            Pick a few — we'll show you events you'll love first. You can change this later.
          </Text>
          <ScrollView
            contentContainerStyle={styles.onboardChips}
            showsVerticalScrollIndicator={false}
          >
            {orderedCategories.map((key) => {
              const c = CATEGORIES[key];
              const active = activeCategories.has(key);
              return (
                <Pressable
                  key={key}
                  onPress={() => toggleCategory(key)}
                  style={[
                    styles.onboardChip,
                    { borderColor: t.border, backgroundColor: t.elev },
                    active && { backgroundColor: t.accent, borderColor: t.accent },
                  ]}
                >
                  <Text style={[
                    styles.onboardChipText,
                    { color: t.fg },
                    active && { color: '#fff' },
                  ]}>
                    {c.emoji}  {c.label}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
          <Pressable
            onPress={() => completeOnboarding(false)}
            style={[styles.onboardPrimary, { backgroundColor: t.accent, opacity: activeCategories.size > 0 ? 1 : 0.55 }]}
            disabled={activeCategories.size === 0}
          >
            <Text style={styles.onboardPrimaryText}>
              {activeCategories.size > 0
                ? `Continue (${activeCategories.size} selected)`
                : 'Pick at least one'}
            </Text>
          </Pressable>
          <Pressable onPress={() => completeOnboarding(true)} style={styles.onboardSkip}>
            <Text style={[styles.onboardSkipText, { color: t.muted }]}>Skip for now</Text>
          </Pressable>
        </View>
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

function ActivityRow({ activity, t, onRate }: { activity: Activity; t: Theme; onRate: () => void }) {
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
      onPress={() => {
        // Fire-and-forget click tracking for site-wide popularity stats.
        fetch(`${API_BASE}/api/activities/click`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: activity.id }),
        }).catch(() => {});
        if (activity.url) Linking.openURL(activity.url).catch(() => {});
      }}
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
          {when}{place ? ` · ${place}` : ''}{distance ? ` · ${distance}` : ''}
        </Text>
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
});
