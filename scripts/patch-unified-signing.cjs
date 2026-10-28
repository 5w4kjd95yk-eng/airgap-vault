// Reproducible, idempotent patches for the pinned AirGap packages. Anchor
// failures deliberately stop installation rather than silently losing signing fixes.
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const root = path.resolve(__dirname, '..')
const patchedFiles = []
const core = 'node_modules/@airgap/coinlib-core/dependencies/src/bitcoinjs-lib-6.1.7/src/'
const bitcoin = 'node_modules/@airgap/bitcoin/v1/'
for (const [pkg, version] of [['bitcoin', '0.14.0'], ['coinlib-core', '0.14.0']]) {
  if (require(path.join(root, 'node_modules/@airgap', pkg, 'package.json')).version !== version) throw new Error(`Review unified patches for ${pkg}`)
}
function patch(file, transform) {
  const target = path.join(root, file)
  patchedFiles.push(target)
  const source = fs.readFileSync(target, 'utf8')
  if (source.includes('// airgap-unified-v1')) return
  let output = source
  const replace = (from, to) => {
    if (!output.includes(from) || output.indexOf(from) !== output.lastIndexOf(from)) throw new Error(`Patch anchor changed: ${file}: ${from}`)
    output = output.replace(from, to)
  }
  transform(replace, () => output)
  fs.writeFileSync(target, '// airgap-unified-v1\n' + output)
}
fs.copyFileSync(path.join(__dirname, 'unified-sighash.js'), path.join(root, core, 'unified-sighash.js'))
fs.copyFileSync(path.join(__dirname, 'sign-account-psbt.js'), path.join(root, bitcoin, 'utils/sign-account-psbt.js'))
patch(core + 'script.js', replace => replace('var hashTypeMod = hashType & ~0x80;', 'if (hashType === 0x21) return true;\n    var hashTypeMod = hashType & ~0x80;'))
patch(core + 'psbt.js', replace => {
  replace('function getHashForSig(inputIndex, input, cache, forValidate, sighashTypes) {', 'function getHashForSig(inputIndex, input, cache, forValidate, sighashTypes, inputs) {')
  replace('getHashForSig(inputIndex, input, cache, false, sighashTypes)', 'getHashForSig(inputIndex, input, cache, false, sighashTypes, inputs)')
  replace('getHashForSig(inputIndex, Object.assign({}, input, { sighashType: sig.hashType }), this.__CACHE, true)', 'getHashForSig(inputIndex, Object.assign({}, input, { sighashType: sig.hashType }), this.__CACHE, true, undefined, this.data.inputs)')
  replace("if (['p2sh-p2wsh', 'p2wsh'].indexOf(type) >= 0) {", `if (sighashType & 0x20) {
        var unified = require('./unified-sighash');
        var code = meaningfulScript;
        if ((0, psbtutils_1.isP2WPKH)(meaningfulScript)) code = payments.p2pkh({ hash: meaningfulScript.slice(2) }).output;
        else if (type !== 'p2wsh' || classifyScript(code) !== 'multisig') throw new Error('Unsupported unified input script');
        hash = unified.unifiedSighash(unsignedTx, unified.spentOutputs(unsignedTx, inputs), inputIndex, code, 1, sighashType);
    }
    else if (['p2sh-p2wsh', 'p2wsh'].indexOf(type) >= 0) {`)
  replace('var tapKeyHash = unsignedTx.hashForWitnessV1(inputIndex, signingScripts, values, sighashType);', `var unified = require('./unified-sighash');
            var tapKeyHash = (sighashType & 0x20)
                ? unified.unifiedSighash(unsignedTx, unified.spentOutputs(unsignedTx, inputs), inputIndex, Buffer.alloc(0), 2, sighashType)
                : unsignedTx.hashForWitnessV1(inputIndex, signingScripts, values, sighashType);`)
  replace('var tapScriptHash = unsignedTx.hashForWitnessV1', "if (sighashType & 0x20) throw new Error('Unified tapscript is unsupported');\n        var tapScriptHash = unsignedTx.hashForWitnessV1")
  replace('var allHashses = pubkey', `if (tapKeySig) {
            var actualHashType = tapKeySig.length === 64 ? 0 : tapKeySig[64];
            if (input.sighashType !== undefined && actualHashType !== input.sighashType) throw new Error('Taproot sighash mismatch');
            input = Object.assign({}, input, { sighashType: actualHashType });
        }
        var allHashses = pubkey`)
})
patch(core + 'transaction.js', (replace, source) => {
  for (const method of ['hashForSignature', 'hashForWitnessV0', 'hashForWitnessV1']) {
    const declaration = source().match(new RegExp('Transaction.prototype.' + method + ' = function \\([^\\n]+\\) \\{'))[0]
    replace(declaration, declaration + "\n        if (hashType & 0x20) throw new Error('Use the unified PSBT hash implementation');")
  }
})
for (const name of ['BitcoinSegwitProtocol', 'BitcoinTaprootProtocol']) {
  patch(bitcoin + 'protocol/' + name + '.js', (replace, source) => {
    const start = source().indexOf('                decodedPSBT.data.inputs.forEach', source().indexOf(name + 'Impl.prototype.signTransactionWithExtendedSecretKey'))
    const end = source().indexOf('                return [2 /*return*/,', start)
    if (start < 0 || end < 0) throw new Error('Signing method patch anchor changed')
    replace(source().slice(start, end), `                require('../utils/sign-account-psbt').signAccountPsbt(decodedPSBT, bip32, ${name === 'BitcoinTaprootProtocol'}, this.bitcoinJS.lib);\n`)
  })
}

// Angular/webpack treats node_modules as immutable and can keep compiling the
// original package after an in-place patch. Invalidate once per installed patch
// revision, including the first run against caches created before this stamp.
const digest = crypto.createHash('sha256')
for (const file of [...patchedFiles, path.join(__dirname, 'unified-sighash.js'), path.join(__dirname, 'sign-account-psbt.js')]) {
  digest.update(fs.readFileSync(file))
}
const revision = digest.digest('hex')
const cache = path.join(root, '.angular', 'cache')
const stamp = path.join(cache, 'airgap-unified.sha256')
if (!fs.existsSync(stamp) || fs.readFileSync(stamp, 'utf8') !== revision) {
  fs.rmSync(cache, { recursive: true, force: true })
  fs.mkdirSync(cache, { recursive: true })
  fs.writeFileSync(stamp, revision)
}
