/**
 * AdMob banner slot for the mobile app. Equivalent of the web's AdSlot
 * component, but built on Google AdMob (the mobile-app SDK) instead of
 * AdSense (web-only). The SDK is wired up in app.json via the
 * react-native-google-mobile-ads plugin.
 *
 * Rendering rules:
 *  - In dev (`__DEV__`), always use AdMob's well-known test ad unit so
 *    you can confirm the integration in a development client without
 *    risking policy violations on live ads.
 *  - In production, render only if the per-platform unit ID has been
 *    configured in app.json's `extra` block. Empty = render nothing.
 *  - Caller can also pass `hidden` (used for users on the Plus tier).
 */

import { Platform, View } from 'react-native';
import Constants from 'expo-constants';
import { BannerAd, BannerAdSize, TestIds } from 'react-native-google-mobile-ads';

type SlotKind = 'banner' | 'infeed';

interface Extra {
  adMobBannerUnitIdAndroid?: string;
  adMobBannerUnitIdIos?: string;
  adMobInFeedUnitIdAndroid?: string;
  adMobInFeedUnitIdIos?: string;
}

function unitIdFor(kind: SlotKind): string | null {
  if (__DEV__) return TestIds.BANNER;
  const extra = (Constants.expoConfig?.extra ?? {}) as Extra;
  if (Platform.OS === 'android') {
    return (kind === 'banner' ? extra.adMobBannerUnitIdAndroid : extra.adMobInFeedUnitIdAndroid) || null;
  }
  if (Platform.OS === 'ios') {
    return (kind === 'banner' ? extra.adMobBannerUnitIdIos : extra.adMobInFeedUnitIdIos) || null;
  }
  return null;
}

export function AdSlot({
  kind, hidden,
}: {
  kind: SlotKind;
  hidden?: boolean;
}) {
  if (hidden) return null;
  const unitId = unitIdFor(kind);
  if (!unitId) return null;
  return (
    <View style={{ alignItems: 'center', marginVertical: 12 }}>
      <BannerAd
        unitId={unitId}
        size={kind === 'banner' ? BannerAdSize.ANCHORED_ADAPTIVE_BANNER : BannerAdSize.MEDIUM_RECTANGLE}
        requestOptions={{
          // Privacy-first default: request non-personalized ads. Avoids
          // needing the App Tracking Transparency prompt and the IDFA on
          // iOS. Users can opt into personalized ads later if we decide
          // to add the ATT flow.
          requestNonPersonalizedAdsOnly: true,
        }}
      />
    </View>
  );
}
