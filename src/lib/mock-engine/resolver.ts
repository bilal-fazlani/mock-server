import path from 'node:path'
import vm from 'node:vm'
import { transformSync } from 'esbuild'

export const DEFAULT_DYNAMIC_TIMEOUT_MS = 100

export interface ResolverInput {
  request: {
    method: string
    path: string
    pathParams: Record<string, string>
    query: Record<string, string[]>
    headers: Record<string, string>
    body: unknown
  }
  history: string[]
  profileId: string | null
}

export interface CompiledResolver {
  /** Optional `export const description = '…'` from the resolver source — its UI label. */
  description?: string
  invoke(input: ResolverInput, timeoutMs: number): unknown
}

export class ResolverCompileError extends Error {}
export class ResolverRuntimeError extends Error {}
export class ResolverTimeoutError extends Error {}

export function resolverFilePath(
  catalogDir: string,
  systemSlug: string,
  endpointName: string,
  slug: string,
): string {
  return path.join(catalogDir, systemSlug, endpointName, `${slug}.ts`)
}

export function compileResolver(source: string, label: string): CompiledResolver {
  let code: string
  try {
    code = transformSync(source, { loader: 'ts', format: 'cjs', target: 'node18' }).code
  } catch (err) {
    throw new ResolverCompileError(`${label}: failed to transpile resolver: ${message(err)}`)
  }

  // Empty context: no require / process / fetch / console leak from the host.
  const sandbox: Record<string, unknown> = { module: { exports: {} } }
  sandbox.exports = (sandbox.module as { exports: unknown }).exports
  const context = vm.createContext(sandbox)
  try {
    new vm.Script(code, { filename: label }).runInContext(context, { timeout: 1000 })
  } catch (err) {
    throw new ResolverCompileError(`${label}: failed to evaluate resolver: ${message(err)}`)
  }

  const mod = (sandbox.module as { exports: Record<string, unknown> }).exports
  const fn = typeof mod === 'function' ? mod : (mod?.default as unknown)
  if (typeof fn !== 'function') {
    throw new ResolverCompileError(`${label}: resolver must default-export a function`)
  }
  const rawDescription = (mod as Record<string, unknown> | undefined)?.description
  const description = typeof rawDescription === 'string' ? rawDescription : undefined
  sandbox.__resolver = fn
  const invokeScript = new vm.Script('__resolver(__input)', { filename: `${label}#invoke` })

  return {
    ...(description !== undefined ? { description } : {}),
    invoke(input: ResolverInput, timeoutMs: number): unknown {
      sandbox.__input = input
      try {
        return invokeScript.runInContext(context, { timeout: timeoutMs })
      } catch (err) {
        if (isTimeout(err)) {
          throw new ResolverTimeoutError(`${label}: resolver exceeded ${timeoutMs}ms`)
        }
        throw new ResolverRuntimeError(`${label}: resolver threw: ${message(err)}`)
      }
    },
  }
}

// Real vm timeouts carry Node's documented, stable error code
// `ERR_SCRIPT_EXECUTION_TIMEOUT`. Detect them by code rather than by matching
// the message text, so a resolver that legitimately throws an error whose
// message merely contains "timed out" is still surfaced as a runtime error
// with its original message intact. Like `.message`, this own-property `code`
// survives the vm realm crossing, and regular thrown errors do not have it.
function isTimeout(err: unknown): boolean {
  return (
    err !== null &&
    typeof err === 'object' &&
    (err as { code?: unknown }).code === 'ERR_SCRIPT_EXECUTION_TIMEOUT'
  )
}

// Errors thrown by vm timeouts are constructed in the sandbox's realm, so
// `err instanceof Error` is false even though `err.message` is a normal
// string. Check for a `message` property instead of relying on `instanceof`.
function message(err: unknown): string {
  if (err && typeof err === 'object' && typeof (err as { message?: unknown }).message === 'string') {
    return (err as { message: string }).message
  }
  return String(err)
}
