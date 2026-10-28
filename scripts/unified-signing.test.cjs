const { test } = require('node:test')
const assert = require('node:assert/strict')
const lib = require('@airgap/coinlib-core/dependencies/src/bitcoinjs-lib-6.1.7/src/index')
const ecc = require('@airgap/coinlib-core/dependencies/src/@bitcoinerlab/secp256k1-1.2.0/src/index')
const { BIP32Factory } = require('@airgap/coinlib-core/dependencies/src/bip32-5.0.1/src/index')
const { signAccountPsbt } = require('@airgap/bitcoin/v1/utils/sign-account-psbt')
const { spentOutputs, unifiedSighash } = require('@airgap/coinlib-core/dependencies/src/bitcoinjs-lib-6.1.7/src/unified-sighash')
const bip32 = BIP32Factory(ecc)
const accounts = [1, 2].map(n => bip32.fromSeed(Buffer.alloc(32, n)).derivePath("m/84'/0'/0'"))
function fixture(policy, hashType = 0x21, signingAccounts = accounts) {
  const keys = signingAccounts.map(a => Buffer.from(a.derivePath('0/0').publicKey))
  const derivations = keys.map((pubkey, i) => ({ pubkey, masterFingerprint: Buffer.from(signingAccounts[i].fingerprint), path: "m/84'/0'/0'/0/0" }))
  const input = { hash: Buffer.alloc(32, 3), index: 0, sighashType: hashType }
  if (hashType === 0) delete input.sighashType
  if (policy === 'tr') {
    const internalPubkey = keys[0].subarray(1)
    input.witnessUtxo = { value: 100000, script: lib.payments.p2tr({ internalPubkey }).output }
    input.tapInternalKey = internalPubkey
    input.tapBip32Derivation = [{ ...derivations[0], pubkey: internalPubkey, leafHashes: [] }]
  } else {
    const payment = policy === 'wsh' ? lib.payments.p2wsh({ redeem: lib.payments.p2ms({ m: 2, pubkeys: [...keys].sort(Buffer.compare) }) }) : lib.payments.p2wpkh({ pubkey: keys[0] })
    input.witnessUtxo = { value: 100000, script: payment.output }
    input.bip32Derivation = policy === 'wsh' ? derivations : [derivations[0]]
    if (policy === 'wsh') input.witnessScript = payment.redeem.output
  }
  const psbt = new lib.Psbt().addInput(input).addOutput({ script: lib.payments.p2wpkh({ pubkey: keys[0] }).output, value: 99000 })
  return psbt
}
lib.initEccLib(ecc)
for (const policy of ['wpkh', 'wsh', 'tr']) {
  for (const hashType of [1, 0x21, ...(policy === 'tr' ? [0] : [])]) {
    test(`${policy} sighash ${hashType}: sign, verify, preserve and finalize`, () => {
      const psbt = fixture(policy, hashType)
      signAccountPsbt(psbt, accounts[0], policy === 'tr', lib)
      const sig = Buffer.from(policy === 'tr' ? psbt.data.inputs[0].tapKeySig : psbt.data.inputs[0].partialSig[0].signature)
      if (policy === 'wsh') signAccountPsbt(psbt, accounts[1], false, lib)
      assert.deepEqual(policy === 'tr' ? psbt.data.inputs[0].tapKeySig : psbt.data.inputs[0].partialSig[0].signature, sig)
      const parsed = lib.Psbt.fromHex(psbt.toHex())
      assert.ok(parsed.validateSignaturesOfAllInputs((key, hash, signature) => policy === 'tr' ? ecc.verifySchnorr(hash, key, signature) : ecc.verify(hash, key, signature)))
      assert.throws(() => signAccountPsbt(psbt, accounts[0], policy === 'tr', lib), /No new signatures/)
      parsed.finalizeAllInputs()
      assert.ok(parsed.extractTransaction().toHex())
    })
  }
}
test('multisig works in reverse and mixed signing order', () => {
  for (const modes of [[0x21, 1], [1, 0x21], [0x21, 0x21]]) {
    const psbt = fixture('wsh', modes[0])
    signAccountPsbt(psbt, accounts[1], false, lib)
    psbt.data.inputs[0].sighashType = modes[1]
    signAccountPsbt(psbt, accounts[0], false, lib)
    assert.ok(psbt.validateSignaturesOfAllInputs((k, h, s) => ecc.verify(h, k, s)))
    // A combined PSBT may contain signatures with different hash types.
    delete psbt.data.inputs[0].sighashType
    psbt.finalizeAllInputs()
  }
})
test('account origins accept h notation and master keys derive the full path', () => {
  const psbt = fixture('wpkh')
  psbt.data.inputs[0].bip32Derivation[0].path = 'm/84h/0h/0h/0/0'
  signAccountPsbt(psbt, accounts[0], false, lib)
  const master = bip32.fromSeed(Buffer.alloc(32, 1))
  signAccountPsbt(fixture('wpkh'), master, false, lib)
})
test('missing and conflicting prevouts, unsupported modes and wrong keys fail', () => {
  const psbt = fixture('wpkh')
  psbt.addInput({ hash: Buffer.alloc(32, 7), index: 0 })
  assert.throws(() => signAccountPsbt(psbt, accounts[0], false, lib), /every input prevout/)
  const wrong = bip32.fromSeed(Buffer.alloc(32, 9)).derivePath("m/84'/0'/0'")
  assert.throws(() => signAccountPsbt(fixture('wpkh'), wrong, false, lib), /No new signatures/)
  assert.throws(() => signAccountPsbt(fixture('wpkh', 0x22), accounts[0], false, lib), /Unsupported/)
  const parent = new lib.Transaction()
  parent.addInput(Buffer.alloc(32, 4), 0)
  parent.addOutput(Buffer.from('0014' + '00'.repeat(20), 'hex'), 100)
  const tx = new lib.Transaction()
  tx.addInput(parent.getHash(), 0)
  assert.throws(() => spentOutputs(tx, [{ nonWitnessUtxo: parent.toBuffer(), witnessUtxo: { value: 101, script: parent.outs[0].script } }]), /Conflicting/)
  tx.ins[0].hash = Buffer.alloc(32)
  assert.throws(() => spentOutputs(tx, [{ nonWitnessUtxo: parent.toBuffer() }]), /hash mismatch/)
  for (const method of ['hashForSignature', 'hashForWitnessV0']) {
    assert.throws(() => method === 'hashForSignature' ? tx[method](0, Buffer.alloc(0), 0x21) : tx[method](0, Buffer.alloc(0), 1, 0x21), /unified PSBT/)
  }
})
test('Knots ALL|UNIFIED Segwit vectors', () => {
  const vectors = require('./fixtures/unified-sighash.json')
  assert.ok(vectors.length > 0)
  for (const [script, raw, index, type, scriptType, prevouts, expected] of vectors) {
    const tx = lib.Transaction.fromHex(raw)
    assert.equal(unifiedSighash(tx, prevouts.map(([value, hex]) => ({ value, script: Buffer.from(hex, 'hex') })), index, Buffer.from(script, 'hex'), scriptType, type).toString('hex'), expected)
  }
})
test('actual Vault protocol and QR codecs round trip all policies with single and multiple frames', async () => {
  const { mnemonicToSeedSync } = require('bip39')
  const { CryptoPSBT } = require('@keystonehq/bc-ur-registry')
  const { UREncoder, URDecoder } = require('@ngraveio/bc-ur')
  const { exchange } = require('./sighash-vault-qr.cjs')
  const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
  const account = bip32.fromSeed(mnemonicToSeedSync(mnemonic)).derivePath("m/84'/0'/0'")
  for (const policy of ['wpkh', 'wsh', 'tr']) {
    for (const fragmentLen of [200, 10000]) {
      const psbt = fixture(policy, 0x21, [account, accounts[1]])
      const encoder = new UREncoder(new CryptoPSBT(psbt.toBuffer()).toUR(), fragmentLen)
      const fragments = Array.from({ length: encoder.fragmentsLength }, () => encoder.nextPart())
      const response = await exchange({ mnemonic, fragments, fragmentLen })
      const decoder = new URDecoder()
      for (const frame of response.fragments) decoder.receivePart(frame)
      assert.ok(decoder.isComplete() && decoder.isSuccess())
      const returned = lib.Psbt.fromBuffer(CryptoPSBT.fromCBOR(decoder.resultUR().cbor).getPSBT())
      assert.ok(returned.validateSignaturesOfAllInputs((k, h, s) => policy === 'tr' ? ecc.verifySchnorr(h, k, s) : ecc.verify(h, k, s)))
      assert.equal(returned.data.inputs[0].sighashType, 0x21)
    }
  }
})
test('five-input account 1 payment signs every input through the Vault protocol and QR codecs', async () => {
  const { mnemonicToSeedSync } = require('bip39')
  const { CryptoPSBT } = require('@keystonehq/bc-ur-registry')
  const { UREncoder, URDecoder } = require('@ngraveio/bc-ur')
  const { exchange } = require('./sighash-vault-qr.cjs')
  const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
  const account = bip32.fromSeed(mnemonicToSeedSync(mnemonic)).derivePath("m/84'/0'/1'")
  const pubkey = Buffer.from(account.derivePath('0/0').publicKey)
  const script = lib.payments.p2wpkh({ pubkey }).output
  const psbt = new lib.Psbt()
  for (let i = 0; i < 5; i++) {
    const parent = new lib.Transaction()
    parent.addInput(Buffer.alloc(32, i + 1), 0)
    parent.addOutput(script, 100000)
    psbt.addInput({
      hash: parent.getHash(), index: 0, sequence: 0xfffffffe,
      nonWitnessUtxo: parent.toBuffer(), witnessUtxo: parent.outs[0], sighashType: 0x21,
      bip32Derivation: [{ pubkey, masterFingerprint: Buffer.from(account.fingerprint), path: "m/84'/0'/1'/0/0" }]
    })
  }
  psbt.addOutput({ script, value: 499000 })
  const encoder = new UREncoder(new CryptoPSBT(psbt.toBuffer()).toUR(), 200)
  const response = await exchange({ mnemonic, fragments: Array.from({ length: encoder.fragmentsLength }, () => encoder.nextPart()) })
  const decoder = new URDecoder()
  for (const frame of response.fragments) decoder.receivePart(frame)
  assert.ok(decoder.isComplete() && decoder.isSuccess())
  const returned = lib.Psbt.fromBuffer(CryptoPSBT.fromCBOR(decoder.resultUR().cbor).getPSBT())
  assert.notEqual(returned.toHex(), psbt.toHex())
  assert.equal(returned.data.inputs.filter(input => input.partialSig?.length === 1).length, 5)
  assert.ok(returned.validateSignaturesOfAllInputs((key, hash, signature) => ecc.verify(hash, key, signature)))
  returned.finalizeAllInputs()
  assert.equal(returned.extractTransaction().ins.filter(input => input.witness.length === 2).length, 5)
})
test('native bundle guard rejects stale assets even with patched dependencies installed', () => {
  const fs = require('fs')
  const os = require('os')
  const path = require('path')
  const { checkUnifiedBundle } = require('./check-unified-bundle.cjs')
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-stale-assets-'))
  try {
    fs.writeFileSync(path.join(directory, 'vendor.js'), 'old signer: catch (e) {}')
    assert.throws(() => checkUnifiedBundle(directory), /Missing unified signer/)
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})
module.exports = { fixture, accounts, lib, ecc }
