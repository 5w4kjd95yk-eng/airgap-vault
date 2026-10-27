// Test-only bridge: coordinator UR -> Vault's installed Bitcoin protocol -> UR.
// Test mnemonics arrive on stdin and are never logged.
const { URDecoder, UREncoder } = require('@ngraveio/bc-ur')
const { CryptoPSBT } = require('@keystonehq/bc-ur-registry')
const lib = require('@airgap/coinlib-core/dependencies/src/bitcoinjs-lib-6.1.7/src/index')
const ecc = require('@airgap/coinlib-core/dependencies/src/@bitcoinerlab/secp256k1-1.2.0/src/index')
const { BIP32Factory } = require('@airgap/coinlib-core/dependencies/src/bip32-5.0.1/src/index')
const { mnemonicToSeedSync } = require('bip39')
const { createBitcoinSegwitProtocol } = require('@airgap/bitcoin/v1/protocol/BitcoinSegwitProtocol')
const { createBitcoinTaprootProtocol } = require('@airgap/bitcoin/v1/protocol/BitcoinTaprootProtocol')
async function exchange(request) {
  lib.initEccLib(ecc)
  const decoder = new URDecoder()
  // Exercise case normalization, duplicate and reordered frames.
  const frames = [...request.fragments].reverse()
  for (const frame of [frames[0], ...frames]) decoder.receivePart(frame.toUpperCase())
  if (!decoder.isComplete() || !decoder.isSuccess()) throw new Error('Vault UR decoding failed')
  const ur = decoder.resultUR()
  if (ur.type !== 'crypto-psbt') throw new Error('Unexpected UR type')
  const psbt = lib.Psbt.fromBuffer(CryptoPSBT.fromCBOR(ur.cbor).getPSBT())
  const taproot = psbt.data.inputs.some(input => input.tapBip32Derivation)
  const root = BIP32Factory(ecc).fromSeed(mnemonicToSeedSync(request.mnemonic))
  const derivations = psbt.data.inputs.flatMap(input => (taproot ? input.tapBip32Derivation : input.bip32Derivation) || [])
  let account
  for (const derivation of derivations) {
    const path = derivation.path.replace(/h/g, "'")
    const lastHardened = path.lastIndexOf("'")
    const origin = lastHardened < 0 ? 'm' : path.slice(0, lastHardened + 1)
    const candidate = origin === 'm' ? root : root.derivePath(origin)
    const child = candidate.derivePath(path.slice(origin.length + 1))
    const pubkey = Buffer.from(child.publicKey)
    if ((taproot ? pubkey.subarray(1) : pubkey).equals(derivation.pubkey)) {
      account = candidate
      break
    }
  }
  if (!account) throw new Error('Test mnemonic does not match request')
  const protocol = taproot ? createBitcoinTaprootProtocol() : createBitcoinSegwitProtocol()
  const signed = await protocol.signTransactionWithSecretKey({ type: 'unsigned', psbt: psbt.toHex() }, { type: 'xpriv', format: 'encoded', value: account.toBase58() })
  const returned = lib.Psbt.fromHex(signed.psbt)
  const encoder = new UREncoder(new CryptoPSBT(returned.toBuffer()).toUR(), request.fragmentLen || 200)
  const fragments = Array.from({ length: encoder.fragmentsLength }, () => encoder.nextPart())
  return { fragments, psbt: returned.toBase64() }
}
module.exports = { exchange }
if (require.main === module) {
  let data = ''
  process.stdin.on('data', chunk => { data += chunk })
  process.stdin.on('end', () => exchange(JSON.parse(data)).then(result => process.stdout.write(JSON.stringify(result))).catch(error => { console.error(error.message); process.exitCode = 1 }))
}
