/**
 * "Stay nearby" Vrbo affiliate card for the mobile app — RN counterpart
 * to apps/web/app/StayNearbyLink.tsx.
 *
 * Attribution note (TODO): the web version relies on CJ's Deep Link
 * Automation script (loaded in layout.tsx) to rewrite plain advertiser
 * URLs to tracking URLs at click time. That script is browser-only —
 * it doesn't run inside RN. So clicks from the mobile app currently
 * open a plain Vrbo URL with no CJ tracking. To enable mobile
 * attribution, wrap `href` below in a CJ tracking URL of the form
 *   https://www.tkqlhce.com/click-<PID>-<VRBO_AID>?url=<encoded_dest>
 * once we have the Vrbo Advertiser ID from the CJ portal.
 */
import { Linking, Pressable, Text, View } from 'react-native';

interface StayNearbyLinkProps {
  city: string;
  region?: string;
  hidden?: boolean;
  t: {
    accent: string;
    fg: string;
    muted: string;
    subtle: string;
  };
}

export function StayNearbyLink({ city, region, hidden, t }: StayNearbyLinkProps) {
  if (hidden || !city) return null;

  const destinationText = [city, region, 'United States of America']
    .filter(Boolean)
    .join(', ');
  const href = `https://www.vrbo.com/search?destination=${encodeURIComponent(destinationText)}&sort=RECOMMENDED`;

  return (
    <View
      style={{
        marginTop: 20,
        marginBottom: 16,
        padding: 16,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: t.accent,
        backgroundColor: t.accent + '1A', // ~10% opacity tint
      }}
    >
      <Text style={{ fontSize: 16, fontWeight: '700', color: t.accent, marginBottom: 4 }}>
        🏡 Coming from out of town?
      </Text>
      <Text style={{ fontSize: 14, color: t.fg, marginBottom: 12, lineHeight: 19 }}>
        Find a place to stay near {city} on Vrbo — vacation rentals from
        cozy cabins to lakefront homes, often cheaper than a hotel for groups.
      </Text>
      <Pressable
        onPress={() => Linking.openURL(href).catch(() => {})}
        style={({ pressed }) => ({
          alignSelf: 'flex-start',
          paddingVertical: 10,
          paddingHorizontal: 16,
          borderRadius: 8,
          backgroundColor: t.accent,
          opacity: pressed ? 0.85 : 1,
        })}
      >
        <Text style={{ color: 'white', fontWeight: '600', fontSize: 14 }}>
          Search Vrbo rentals in {city} →
        </Text>
      </Pressable>
      <Text style={{ fontSize: 10, color: t.subtle, marginTop: 10 }}>
        Affiliate link — we may earn a small commission if you book, at no extra cost to you.
      </Text>
    </View>
  );
}
