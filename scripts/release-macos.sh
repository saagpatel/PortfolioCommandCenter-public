#!/usr/bin/env bash
#
# release-macos.sh — produce a signed + notarized + stapled macOS build.
#
# Tauri's bundler signs the .app with the Developer ID identity from
# tauri.conf.json (bundle.macOS.signingIdentity) under the hardened runtime,
# then — because the three APPLE_API_* notarization variables below are present
# — submits the bundle to Apple's notary service and staples the ticket. No
# custom entitlements plist is required: hardened runtime (not App Sandbox) is
# what Developer ID distribution needs, and a Tauri WKWebView app notarizes
# clean without one.
#
# Secrets stay out of the repo:
#   - APPLE_API_KEY      (Key ID) is not secret; it appears in the .p8 filename
#                        and in App Store Connect. Defaulted, overridable.
#   - APPLE_API_ISSUER   (account-level Issuer ID) is read from the macOS
#                        Keychain, never committed.
#   - the .p8 private key lives only in ~/.appstoreconnect/private_keys/.
#
# Usage:  ./scripts/release-macos.sh
# Override any value inline, e.g.:  APPLE_API_KEY=ABCD1234 ./scripts/release-macos.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# --- Notarization credentials -------------------------------------------------
# App Store Connect API key ID (the <id> in AuthKey_<id>.p8).
export APPLE_API_KEY="${APPLE_API_KEY:-6NPVH55ZWG}"

# Private key location. Tauri also auto-discovers ~/.appstoreconnect/private_keys/
# but we set it explicitly so the failure mode is a clear error, not a silent skip.
export APPLE_API_KEY_PATH="${APPLE_API_KEY_PATH:-$HOME/.appstoreconnect/private_keys/AuthKey_${APPLE_API_KEY}.p8}"

# Account-level Issuer ID. Read from the Keychain (shared across this Apple
# account; the asc-radar entry is its canonical store on this machine).
# Override KEYCHAIN_ISSUER_SERVICE / _ACCOUNT if you relocate it.
KEYCHAIN_ISSUER_SERVICE="${KEYCHAIN_ISSUER_SERVICE:-asc-radar}"
KEYCHAIN_ISSUER_ACCOUNT="${KEYCHAIN_ISSUER_ACCOUNT:-issuer_id}"
export APPLE_API_ISSUER="${APPLE_API_ISSUER:-$(security find-generic-password \
  -s "$KEYCHAIN_ISSUER_SERVICE" -a "$KEYCHAIN_ISSUER_ACCOUNT" -w 2>/dev/null || true)}"

# --- Pre-flight ---------------------------------------------------------------
if [[ ! -f "$APPLE_API_KEY_PATH" ]]; then
  echo "error: API private key not found at $APPLE_API_KEY_PATH" >&2
  echo "       download it from App Store Connect → Users and Access → Integrations." >&2
  exit 1
fi
if [[ -z "$APPLE_API_ISSUER" ]]; then
  echo "error: APPLE_API_ISSUER is empty (Keychain lookup ${KEYCHAIN_ISSUER_SERVICE}/${KEYCHAIN_ISSUER_ACCOUNT} failed)." >&2
  echo "       set it inline:  APPLE_API_ISSUER=<uuid> ./scripts/release-macos.sh" >&2
  exit 1
fi

echo "==> Building signed + notarized macOS bundle (key ${APPLE_API_KEY}, issuer …${APPLE_API_ISSUER: -4})"
pnpm tauri build "$@"

# --- Verify -------------------------------------------------------------------
# Bundles land under target/<triple>/release/bundle when --target is passed,
# else target/release/bundle. Resolve the exact dir so the right artifact is
# verified even when several target dirs coexist.
BUNDLE_BASE="src-tauri/target/release/bundle"
for arg in "$@"; do
  case "$arg" in
    --target) NEXT_IS_TARGET=1 ;;
    --target=*) BUNDLE_BASE="src-tauri/target/${arg#--target=}/release/bundle" ;;
    *) [[ "${NEXT_IS_TARGET:-}" == 1 ]] && { BUNDLE_BASE="src-tauri/target/${arg}/release/bundle"; NEXT_IS_TARGET=; } ;;
  esac
done
APP_PATH="$(find "$BUNDLE_BASE/macos" -maxdepth 1 -name '*.app' 2>/dev/null | head -1)"
DMG_PATH="$(find "$BUNDLE_BASE/dmg" -maxdepth 1 -name '*.dmg' 2>/dev/null | head -1)"

if [[ -n "$APP_PATH" ]]; then
  echo "==> codesign verification: $APP_PATH"
  codesign --verify --deep --strict --verbose=2 "$APP_PATH"
  echo "==> Gatekeeper assessment:"
  spctl --assess --type exec --verbose=2 "$APP_PATH"
  echo "==> stapled ticket:"
  xcrun stapler validate "$APP_PATH"
fi
if [[ -n "$DMG_PATH" ]]; then
  # Tauri notarizes + staples the .app, but not the .dmg wrapper. Submit the
  # signed DMG on its own so the downloaded disk image verifies offline, then
  # staple its ticket.
  echo "==> Notarizing DMG: $DMG_PATH"
  xcrun notarytool submit "$DMG_PATH" \
    --key "$APPLE_API_KEY_PATH" --key-id "$APPLE_API_KEY" --issuer "$APPLE_API_ISSUER" --wait
  echo "==> Stapling DMG"
  xcrun stapler staple "$DMG_PATH"
  xcrun stapler validate "$DMG_PATH"
fi

echo "==> Done."
[[ -n "$APP_PATH" ]] && echo "    app: $APP_PATH"
[[ -n "$DMG_PATH" ]] && echo "    dmg: $DMG_PATH"
