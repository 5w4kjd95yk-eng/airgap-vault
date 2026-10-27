'use strict'

// Installed in @airgap/bitcoin/v1/utils. All signing errors for matching keys
// propagate; unrelated cosigners are skipped by comparing the derived pubkey.
const ecc = require('@airgap/coinlib-core/dependencies/src/@bitcoinerlab/secp256k1-1.2.0/src/index')

function signAccountPsbt(psbt, account, taproot, bitcoin) {
  let added = 0
  psbt.data.inputs.forEach((input, index) => {
    const hashType = input.sighashType === undefined ? (taproot ? 0 : 1) : input.sighashType
    if (!(taproot ? [0, 1, 0x21] : [1, 0x21]).includes(hashType)) throw new Error('Unsupported signing sighash')
    if (input.tapLeafScript || input.tapScriptSig || input.tapMerkleRoot) throw new Error('Only BIP86 Taproot key-path signing is supported')
    if (taproot !== !!input.tapBip32Derivation) throw new Error('Mixed Taproot and Segwit inputs are not supported')
    const derivations = (taproot ? input.tapBip32Derivation : input.bip32Derivation) || []
    derivations.forEach(derivation => {
      if (taproot && derivation.leafHashes.length) throw new Error('Tapscript signing is not supported')
      const parts = derivation.path.replace(/^m\//, '').split('/')
      const suffix = parts.slice(account.depth).map(part => part.replace(/[hH]$/, "'")).join('/')
      if (!suffix || !/^\d+'?(\/\d+'?)*$/.test(suffix)) throw new Error('Invalid account child derivation')
      const child = account.derivePath(suffix)
      const publicKey = Buffer.from(child.publicKey)
      if (!(taproot ? publicKey.subarray(1) : publicKey).equals(derivation.pubkey)) return
      if (taproot && (!input.tapInternalKey || !publicKey.subarray(1).equals(input.tapInternalKey))) throw new Error('Taproot internal key mismatch')
      if (taproot ? !!input.tapKeySig : (input.partialSig || []).some(sig => sig.pubkey.equals(publicKey))) return
      const signer = taproot ? child.tweak(bitcoin.crypto.taggedHash('TapTweak', publicKey.subarray(1))) : child
      psbt.signInput(index, {
        publicKey: Buffer.from(signer.publicKey),
        sign(hash, lowR) {
          const sig = Buffer.from(signer.sign(hash, lowR))
          if (!ecc.verify(hash, signer.publicKey, sig)) throw new Error('Signature verification failed')
          return sig
        },
        signSchnorr(hash) {
          const sig = Buffer.from(signer.signSchnorr(hash))
          if (!ecc.verifySchnorr(hash, signer.publicKey.subarray(1), sig)) throw new Error('Schnorr signature verification failed')
          return sig
        }
      }, [hashType])
      added++
    })
  })
  if (!added) throw new Error('No new signatures for the selected account')
  return psbt
}
module.exports = { signAccountPsbt }
