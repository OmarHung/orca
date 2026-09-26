const base = require('../../electron-builder.config.cjs')

// Why: the base config ships every file it doesn't exclude, so local-only folders in the
// checkout (a 1.6 GB CodeGraph index, Playwright output) ended up inside app.asar.
module.exports = {
  ...base,
  files: [
    ...base.files,
    '!.codegraph{,/**/*}',
    '!test-results{,/**/*}',
    '!playwright-report{,/**/*}'
  ]
}
