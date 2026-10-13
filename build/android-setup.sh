#!/usr/bin/env bash
# Customises the generated Android project: camera permission, portrait mode,
# app icon, splash screen, version number and a fixed signing key
# (so new versions install over old ones without losing your collection).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RES="$ROOT/android/app/src/main/res"
MANIFEST="$ROOT/android/app/src/main/AndroidManifest.xml"
GRADLE="$ROOT/android/app/build.gradle"

# 1. Fixed signing key
mkdir -p "$HOME/.android"
cp "$ROOT/build/debug.keystore" "$HOME/.android/debug.keystore"

# 2. Camera permission + portrait orientation
if ! grep -q 'android.permission.CAMERA' "$MANIFEST"; then
  sed -i 's#</manifest>#    <uses-permission android:name="android.permission.CAMERA" />\n    <uses-feature android:name="android.hardware.camera" android:required="false" />\n</manifest>#' "$MANIFEST"
fi
if ! grep -q 'screenOrientation' "$MANIFEST"; then
  sed -i 's#android:name=".MainActivity"#android:name=".MainActivity"\n            android:screenOrientation="portrait"#' "$MANIFEST"
fi

# 3. App icon (plain PNG icons; remove adaptive-icon XML so ours are used)
rm -rf "$RES/mipmap-anydpi-v26"
cp -r "$ROOT/build/res/." "$RES/"

# 4. Splash screen
find "$RES" -name 'splash.png' -exec cp "$ROOT/build/splash.png" {} \;

# 5. Version number from the GitHub build number
BUILD="${GITHUB_RUN_NUMBER:-1}"
sed -i -E "s/versionCode [0-9]+/versionCode ${BUILD}/; s/versionName \"[^\"]*\"/versionName \"1.0.${BUILD}\"/" "$GRADLE"

echo "Android project customised (build ${BUILD})"
