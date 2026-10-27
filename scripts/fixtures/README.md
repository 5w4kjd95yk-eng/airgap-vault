`unified-sighash.json` contains the SIGHASH_ALL|UNIFIED (`33`), Segwit-v0
(`1`) rows from Knots v29.4.2.knots20260508's
`src/test/data/unified_sighash.json`, Git blob
`7f6c9685bf913cba28a334ff5b2bd1b447d44d56`. Columns are scriptCode, rawTx,
input index, hashType, scriptType, spentOutputs, expected digest.

Other unified modes are deliberately unsupported. The signing tests also cover
Taproot key-path signature verification and QR transport.
