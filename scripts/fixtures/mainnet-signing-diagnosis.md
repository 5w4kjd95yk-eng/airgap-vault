The 2026-10-27 manual XBT payment failed in the packaged Vault signer.
All four snapshots in the local `psbt.txt` (current, prepared, imported, merged)
are byte-identical. All five inputs request `0x21`, use the same P2WPKH key at
`m/84'/0'/1'/0/0`, and contain no partial signatures or final witnesses.
BDWallet therefore correctly leaves the payment incomplete.

The local `vault.apk`'s `assets/public/vendor.js` contains the unpatched
`BitcoinSegwitProtocolImpl.signTransactionWithExtendedSecretKey`. Its empty
`catch (e) {}` swallows signing failures and returns the unsigned PSBT as a
signed response. The APK contains neither `signAccountPsbt` nor the unified
hash implementation, despite the installed Node dependencies having both.

Angular's persistent cache also reused the unpatched package after the files
in `node_modules` had been patched. A normal web rebuild reproduced the old
signer until that cache was invalidated.

The dependency patch now runs before the web build scripts, as well as during
installation, and invalidates Angular's cache once per installed signing patch
revision. Android's preBuild checks the compiled assets it will package
and rejects assets missing the patched signer. Rebuild with:

```sh
source ~/.local/share/airgap-vault/env.sh
yarn build
npx cap sync android
cd android
./gradlew assembleRelease
```

Sign the resulting release APK using the local QA signing setup before device
installation. `node scripts/check-unified-bundle.cjs <asset-directory>` can also
check the extracted web assets of a signed APK. The signing regression covers
five unified P2WPKH inputs with both prevout formats and account index 1 through
the installed Vault protocol and UR codecs, verifying and finalizing all inputs
with a synthetic test seed; no real wallet secrets are needed.

Validation after the fix: all 14 Vault signing/QR tests pass; BDWallet's
`airgap_vault_ur_interoperability` test passes; the web build and Android release
build pass. The compiled bundle guard rejects the original stale Android
assets and accepts the rebuilt assets. The unchanged patch revision preserves
Angular's cache on subsequent runs.
