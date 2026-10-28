// Check compiled assets, not node_modules: Capacitor can otherwise package an
// old www tree even when the source signing tests pass.
const fs = require('fs')
const path = require('path')

function checkUnifiedBundle(directory) {
  const files = fs.existsSync(directory) ? fs.readdirSync(directory).filter(name => name.endsWith('.js')) : []
  const sources = files.map(name => fs.readFileSync(path.join(directory, name), 'utf8')).join('\n')
  for (const marker of ['No new signatures for the selected account', 'Unified signing requires every input prevout', 'Schnorr signature verification failed']) {
    if (!sources.includes(marker)) {
      throw new Error(`Missing unified signer in ${directory}. Run yarn build, then npx cap sync android before building the APK.`)
    }
  }
}

module.exports = { checkUnifiedBundle }
if (require.main === module) checkUnifiedBundle(process.argv[2] || path.join(__dirname, '..', 'www'))
