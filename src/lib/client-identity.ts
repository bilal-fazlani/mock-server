import { X509Certificate, createPrivateKey } from 'node:crypto'
import type { SystemDef } from './catalog/types'

export interface ClientIdentity {
  cert: string
  key: string
}

export type ClientIdentityResult =
  | { ok: true; identity: ClientIdentity | null }
  | { ok: false; code: 'missing_client_cert' | 'invalid_client_cert'; message: string }

const checked = new Map<string, { cert: string; key: string; problem: string | null }>()

export function resolveClientIdentity(
  system: SystemDef,
  env: Record<string, string | undefined>,
): ClientIdentityResult {
  if (!system.clientCertEnv || !system.clientKeyEnv) return { ok: true, identity: null }
  const cert = env[system.clientCertEnv]
  const key = env[system.clientKeyEnv]
  for (const [name, value] of [
    [system.clientCertEnv, cert],
    [system.clientKeyEnv, key],
  ] as const) {
    if (!value) {
      return { ok: false, code: 'missing_client_cert', message: `environment variable ${name} is not set` }
    }
  }
  const problem = pemProblem(system, cert!, key!)
  if (problem) return { ok: false, code: 'invalid_client_cert', message: problem }
  return { ok: true, identity: { cert: cert!, key: key! } }
}

export function unsetClientIdentityEnv(
  system: SystemDef,
  env: Record<string, string | undefined>,
): string[] {
  return [system.clientCertEnv, system.clientKeyEnv].filter(
    (name): name is string => name !== undefined && !env[name],
  )
}

function pemProblem(system: SystemDef, cert: string, key: string): string | null {
  const last = checked.get(system.slug)
  if (last && last.cert === cert && last.key === key) return last.problem
  const problem = checkPem(system, cert, key)
  checked.set(system.slug, { cert, key, problem })
  return problem
}

function checkPem(system: SystemDef, cert: string, key: string): string | null {
  let x509: X509Certificate
  try {
    x509 = new X509Certificate(cert)
  } catch (err) {
    return `environment variable ${system.clientCertEnv} does not hold a PEM certificate: ${reason(err)}`
  }
  let privateKey
  try {
    privateKey = createPrivateKey(key)
  } catch (err) {
    return `environment variable ${system.clientKeyEnv} does not hold an unencrypted PEM private key: ${reason(err)}`
  }
  if (!x509.checkPrivateKey(privateKey)) {
    return `environment variable ${system.clientKeyEnv} does not hold the private key for the certificate in ${system.clientCertEnv}`
  }
  return null
}

function reason(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
