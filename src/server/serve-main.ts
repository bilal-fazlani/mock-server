// Entry point for the shipped server, bundled to .next/standalone/serve.cjs.
//
// It exists to get two things in place before Next's generated `server.js` runs:
//
// - The upgrade guard (#72), which has to patch `http.createServer` before Next
//   calls it. Next offers no hook that early — `instrumentation.ts` runs after
//   the server is already listening — so the guard lives in front of the entry
//   point rather than inside the app.
// - The listen address (#98). Next reads it from `HOSTNAME`, which container
//   platforms set to the machine's own name, so the server would listen only on
//   that name's address and refuse connections to localhost. `BIND_ADDRESS`
//   decides instead and is copied over `HOSTNAME` here; a bad value stops the
//   process before anything listens.
//
// Everything that starts the server starts this file: `bin/mock-server.js`, the
// image's CMD, and the `docker/mock-server` shim.

import { applyBindAddress, BindAddressError } from '../lib/bind-address'
import { installUpgradeGuard } from './ignore-unsupported-upgrades'

try {
  applyBindAddress(process.env)
} catch (err) {
  if (!(err instanceof BindAddressError)) throw err
  process.stderr.write(`mock-server: ${err.message}\n`)
  process.exit(1)
}

installUpgradeGuard()

// Next's standalone entry, which only exists once `next build` has run — hence
// external at bundle time, resolved next to this file at runtime. It takes over
// the process from here: reads PORT and the HOSTNAME set above, listens, and never returns.
// eslint-disable-next-line @typescript-eslint/no-require-imports -- CJS bundle; a static import would be hoisted above installUpgradeGuard()
require('./server.js')
