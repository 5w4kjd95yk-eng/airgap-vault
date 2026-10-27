# Unified signing over QR

Vault accepts PSBT requests declaring `SIGHASH_ALL|UNIFIED` (`0x21`) for
P2WPKH, multisig P2WSH and BIP86 Taproot key-path signing. Both directions use
the existing animated `ur:crypto-psbt` envelope containing a CBOR byte string.
Ordinary ALL signing and Taproot DEFAULT remain supported.

The transaction approval screen identifies unified requests. The signer requires
every input's prevout, rejects conflicting UTXO metadata, verifies its newly
created signatures, and reports an error if no new signature can be produced.
It preserves other cosigners' signatures and returns an unfinalized PSBT.
There is no automatic downgrade from unified to standard signing.

`scripts/patch-unified-signing.cjs` installs checked-in helpers and anchored,
idempotent patches into the pinned `@airgap/bitcoin` and `@airgap/coinlib-core`
packages during `yarn install`. A package version or anchor change requires
review. The patch also blocks routing unified requests through the ordinary
Bitcoin transaction hash methods.

Run `yarn test:unified` for hash vectors, signature verification/finalization,
mixed multisig signing, failure cases, and actual Vault protocol/QR codecs.
External coordinators can use `scripts/sighash-vault-qr.cjs` as a test-only
bridge. It reads a JSON object containing `fragments` (UR strings), `mnemonic`
(a test signing seed), and optional `fragmentLen` from stdin. It returns JSON
containing signed PSBT `fragments` and a base64 `psbt`. This exercises Vault's
installed Bitcoin protocol and UR codecs without its account selection or
approval screens. Test mnemonics are not logged.

Requests must use a homogeneous Segwit or Taproot signing flow. Tapscript,
annexes, non-BIP86 Taproot trees, and unified NONE/SINGLE/ANYONECANPAY modes are
unsupported. PSBT does not identify its network: the coordinator selects the
chain and signing mode; the offline signer follows the explicit request.

Physical camera exchange and TalkBack approval/error flows require a connected
Android phone and remain separate acceptance checks.

Validated on 2026-10-27: all 12 Vault signing/QR tests and TypeScript checking
passed. The local QA Android APK was built and signed. No Android device or
activated Knots node was available for the remaining acceptance checks.
