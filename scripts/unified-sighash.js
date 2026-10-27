'use strict'

// Installed beside bitcoinjs transaction.js by patch-unified-signing.cjs.
// Knots UnifiedSighash v1, restricted to ALL|UNIFIED and the supported scripts.
const { sha256 } = require('./crypto')
const { Transaction } = require('./transaction')

function u32(value) {
  const bytes = Buffer.alloc(4)
  bytes.writeUInt32LE(value >>> 0)
  return bytes
}
function u64(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('Invalid prevout amount')
  const bytes = Buffer.alloc(8)
  bytes.writeUInt32LE(value % 0x100000000, 0)
  bytes.writeUInt32LE(Math.floor(value / 0x100000000), 4)
  return bytes
}
function compactScript(script) {
  const size = script.length
  let prefix
  if (size < 253) prefix = Buffer.from([size])
  else if (size <= 0xffff) {
    prefix = Buffer.alloc(3)
    prefix[0] = 253
    prefix.writeUInt16LE(size, 1)
  } else prefix = Buffer.concat([Buffer.from([254]), u32(size)])
  return Buffer.concat([prefix, script])
}
const txout = output => Buffer.concat([u64(output.value), compactScript(output.script)])
const hashItems = items => sha256(Buffer.concat(items))

function spentOutputs(transaction, inputs) {
  if (inputs.length !== transaction.ins.length) throw new Error('Every input needs a prevout')
  return inputs.map((input, index) => {
    let parentOutput
    if (input.nonWitnessUtxo) {
      const parent = Transaction.fromBuffer(input.nonWitnessUtxo)
      if (!parent.getHash().equals(transaction.ins[index].hash)) throw new Error('Prevout transaction hash mismatch')
      parentOutput = parent.outs[transaction.ins[index].index]
      if (!parentOutput) throw new Error('Prevout index out of range')
    }
    if (parentOutput && input.witnessUtxo &&
        (parentOutput.value !== input.witnessUtxo.value || !parentOutput.script.equals(input.witnessUtxo.script))) {
      throw new Error('Conflicting prevout metadata')
    }
    const output = parentOutput || input.witnessUtxo
    if (!output) throw new Error('Unified signing requires every input prevout')
    u64(output.value)
    return output
  })
}

function unifiedSighash(transaction, outputs, index, scriptCode, scriptType, hashType) {
  if (hashType !== 0x21) throw new Error('Unsupported unified sighash; expected ALL|UNIFIED (0x21)')
  if (![1, 2].includes(scriptType)) throw new Error('Unsupported unified script type')
  if (outputs.length !== transaction.ins.length || !transaction.ins[index]) throw new Error('Missing input prevouts')
  const message = Buffer.concat([
    Buffer.from([0, hashType]), u32(transaction.version), u32(transaction.locktime), Buffer.from([0]),
    hashItems(transaction.ins.map(input => Buffer.concat([input.hash, u32(input.index)]))),
    hashItems(outputs.map(output => u64(output.value))),
    hashItems(outputs.map(output => compactScript(output.script))),
    hashItems(transaction.ins.map(input => u32(input.sequence))),
    hashItems(transaction.outs.map(txout)), Buffer.from([scriptType]), u32(index),
    scriptType === 2 ? Buffer.from([0]) : compactScript(scriptCode)
  ])
  const tag = sha256(Buffer.from('UnifiedSighash'))
  return sha256(Buffer.concat([tag, tag, message]))
}
module.exports = { unifiedSighash, spentOutputs }
