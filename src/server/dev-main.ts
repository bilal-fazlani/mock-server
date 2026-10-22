// `npm run dev`: opens the system listeners the shipped entry opens, then runs
// `next dev` as a child on the admin port, so development routes system
// traffic exactly as the built server does. A catalog edit that adds a system
// or changes a port needs a restart.

import { spawn } from 'node:child_process'
import { BindAddressError, parseBindAddress } from '../lib/bind-address'
import { prepareSystemListeners, SystemStartError } from './system-start'

async function main(): Promise<void> {
  const bindAddress = parseBindAddress(process.env.BIND_ADDRESS)
  await prepareSystemListeners(process.env, bindAddress)
  const child = spawn(
    process.execPath,
    [require.resolve('next/dist/bin/next'), 'dev', ...process.argv.slice(2)],
    { stdio: 'inherit', env: process.env },
  )
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => child.kill(signal))
  }
  child.on('exit', (code, signal) => process.exit(signal ? 1 : (code ?? 0)))
}

main().catch((err: unknown) => {
  if (!(err instanceof SystemStartError) && !(err instanceof BindAddressError)) throw err
  process.stderr.write(`mock-server: cannot start: ${err.message}\n`)
  process.exit(1)
})
