# Building & submitting the mobile app

Everything here happens from `apps/mobile/` unless noted.

## One-time setup

```bash
# from the monorepo root
npm i -g eas-cli

cd apps/mobile
eas login                # sign in to your Expo account
eas init                 # links this directory to an EAS project, writes
                         # extra.eas.projectId into app.json
```

`eas init` will also detect this is part of a pnpm workspace and
configure the build environment to use pnpm.

## Build profiles

`eas.json` defines three profiles:

| Profile        | Output                          | Used for                                       |
|----------------|---------------------------------|------------------------------------------------|
| `development`  | dev client (APK / dev-IPA)      | `expo start --dev-client` against your devices |
| `preview`      | internal APK / ad-hoc IPA       | sharing test builds with a few people via URL  |
| `production`   | signed AAB / store-ready IPA    | submitting to Play Store / App Store           |

### Why dev builds, not Expo Go

AdMob (`react-native-google-mobile-ads`) is a native module. It does
not work in Expo Go. To run the app with ads locally, build a
development client once via EAS and install it on your device:

```bash
eas build --profile development --platform android   # or ios
```

When the build finishes EAS gives you a URL. Open it on your phone
(or scan the QR code) to install the dev client. After that:

```bash
pnpm start                # in apps/mobile, starts Metro
                          # → connect from the installed dev client
```

## Producing store builds

```bash
# Android — produces an AAB ready for the Play Store
eas build --platform android --profile production

# iOS — produces an IPA ready for App Store Connect
eas build --platform ios --profile production
```

The first iOS build will prompt you to set up credentials
(distribution certificate, provisioning profile, push key). The
recommended path is to let EAS manage them — answer "yes" when asked.

## Submitting to the stores

### Google Play

1. Create the app in Play Console. Set bundle identifier to
   `com.mswtechno.proactivity` (matches `app.json`'s `android.package`).
2. Create a Google Cloud service account, grant it the **Service Account
   User** role on the Play developer account, and download the JSON key.
   Save it as `apps/mobile/google-service-account.json` (gitignored).
3. Submit:
   ```bash
   eas submit --platform android --profile production
   ```

By default this submits to the **internal** testing track (see
`eas.json` → `submit.production.android.track`). Promote to
`production` in Play Console once you're ready.

### App Store

1. Apple Developer Program account ($99/year). Verify identity.
2. In App Store Connect, create a new app with the bundle ID
   `com.mswtechno.proactivity`.
3. Edit `eas.json` and replace:
   - `appleId` — your Apple ID email
   - `ascAppId` — numeric App Store Connect app ID (in the URL of the app's page)
4. Submit:
   ```bash
   eas submit --platform ios --profile production
   ```

EAS will use an app-specific password (it'll prompt) to upload to TestFlight.

## After your first store builds

Things to verify before review:

- **Privacy nutrition labels** (Apple) / **Data safety form** (Google) —
  match what the `/privacy` page says. Key items:
  - Email Address: linked to user, account creation.
  - Coarse Location: not linked to user, app functionality.
  - Product Interaction: not linked to user, analytics.
  - Ads via AdMob: contextual only (non-personalized requested by default).
- **App icons + screenshots**. Apple wants 1024×1024 icon + 2-8
  screenshots per device size. Play wants 512×512 icon + 2-8 phone
  screenshots.
- **Privacy policy URL** must point to `https://proactivity.app/privacy`
  (already live).
- **Support URL** — pick one (e.g. `mailto:support@proactivity.app`).

## Troubleshooting

### pnpm monorepo issues

If `eas build` fails because dependencies don't resolve, check:

1. The mobile `package.json` lists everything it needs directly — don't
   rely on hoisted workspace dependencies.
2. `metro.config.js` already configures `watchFolders` to include the
   workspace root.
3. Set `EAS_NO_VCS=1` if EAS complains about uncommitted changes during
   a quick one-off build.

### AdMob test ads showing in production

By default the `AdSlot` component uses AdMob's test ad unit when
`__DEV__` is true. In a release build this evaluates to `false` and
the component reads real unit IDs from `app.json` → `extra`. If those
fields are empty, no ad renders. Fill them in before shipping:

```json
"extra": {
  "adMobBannerUnitIdAndroid": "ca-app-pub-XXXX/YYYY",
  "adMobBannerUnitIdIos": "ca-app-pub-XXXX/YYYY",
  "adMobInFeedUnitIdAndroid": "ca-app-pub-XXXX/YYYY",
  "adMobInFeedUnitIdIos": "ca-app-pub-XXXX/YYYY"
}
```

You also need to replace the placeholder `androidAppId` / `iosAppId`
in `app.json` → `plugins[react-native-google-mobile-ads]` with your
real AdMob app IDs.
