// Main-process dependencies compiled into the bundle instead of loaded from node_modules.
export const BUNDLED_MAIN_DEPENDENCIES = new Set([
  'stream-json',
  'stream-chain',
  '@xterm/headless',
  '@xterm/addon-serialize',
  'tldts',
  'smol-toml',
  'yaml',
  'fflate',
  'mime-types',
  'mime-db',
  // Linear save confirmation; bundled like orcad so packaging needs no extra node_modules.
  'unified',
  'remark-parse',
  'remark-gfm',
  'remark-cjk-friendly',
  'markdown-table',
  'hast-util-from-html-isomorphic',
  // tedious loads @azure/identity eagerly; bundling it into the database worker avoids ~45 MB of Azure SDK node_modules.
  'tedious',
  // Windows NSIS copies app.asar before external resources; bootstrap must not race resources/node_modules.
  'zod',
  'semver'
])
