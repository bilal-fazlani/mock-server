import path from 'node:path'
import vm from 'node:vm'
import { transformSync } from 'esbuild'

export const DYNAMIC_FILE = '_dynamic.ts'
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
  invoke(input: ResolverInput, timeoutMs: number): unknown
}

export class ResolverCompileError extends Error {}
export class ResolverRuntimeError extends Error {}
export class ResolverTimeoutError extends Error {}

export function dynamicFilePath(catalogDir: string, systemSlug: string, endpointName: string): string {
  return path.join(catalogDir, systemSlug, endpointName, DYNAMIC_FILE)
}

export function compileResolver(source: string, label: string): CompiledResolver {
  let code: string
  try {
    code = transformSync(source, { loader: 'ts', format: 'cjs', target: 'node18' }).code
  } catch (err) {
    throw new ResolverCompileError(`${label}: failed to transpile _dynamic.ts: ${message(err)}`)
  }

  // Empty context: no require / process / fetch / console leak from the host.
  const sandbox: Record<string, unknown> = { module: { exports: {} } }
  sandbox.exports = (sandbox.module as { exports: unknown }).exports
  const context = vm.createContext(sandbox)
  try {
    new vm.Script(code, { filename: label }).runInContext(context, { timeout: 1000 })
  } catch (err) {
    throw new ResolverCompileError(`${label}: failed to evaluate _dynamic.ts: ${message(err)}`)
  }

  const mod = (sandbox.module as { exports: Record<string, unknown> }).exports
  const fn = typeof mod === 'function' ? mod : (mod?.default as unknown)
  if (typeof fn !== 'function') {
    throw new ResolverCompileError(`${label}: _dynamic.ts must default-export a function`)
  }
  sandbox.__resolver = fn
  const invokeScript = new vm.Script('__resolver(__input)', { filename: `${label}#invoke` })

  return {
    invoke(input: ResolverInput, timeoutMs: number): unknown {
      sandbox.__input = input
      try {
        return invokeScript.runInContext(context, { timeout: timeoutMs })
      } catch (err) {
        if (isTimeout(err)) {
          throw new ResolverTimeoutError(`${label}: _dynamic.ts exceeded ${timeoutMs}ms`)
        }
        throw new ResolverRuntimeError(`${label}: _dynamic.ts threw: ${message(err)}`)
      }
    },
  }
}

function isTimeout(err: unknown): boolean {
  return /timed out/i.test(message(err))
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
