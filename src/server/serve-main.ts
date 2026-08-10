// Entry point for the shipped server, bundled to .next/standalone/serve.cjs.
//
// It exists to get one thing in place before Next's generated `server.js` runs:
// the upgrade guard (#72), which has to patch `http.createServer` before Next
// calls it. Next offers no hook that early — `instrumentation.ts` runs after the
// server is already listening — so the guard lives in front of the entry point
// rather than inside the app.
//
// Everything that starts the server starts this file: `bin/mock-server.js`, the
// image's CMD, and the `docker/mock-server` shim.

import { installUpgradeGuard } from './ignore-unsupported-upgrades'

installUpgradeGuard()

// Next's standalone entry, which only exists once `next build` has run — hence
// external at bundle time, resolved next to this file at runtime. It takes over
// the process from here: reads PORT/HOSTNAME, listens, and never returns.
// eslint-disable-next-line @typescript-eslint/no-require-imports -- CJS bundle; a static import would be hoisted above installUpgradeGuard()
require('./server.js')
