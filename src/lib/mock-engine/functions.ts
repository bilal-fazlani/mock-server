import vm from 'node:vm'
import { transformSync } from 'esbuild'

export type FnValue = string | number | boolean | null | FnValue[] | { [k: string]: FnValue }
export interface FnContext {
  request: {
    method: string; path: string; pathParams: Record<string, string>
    query: Record<string, string[]>; headers: Record<string, string>; body: unknown
  }
  now: Date
  seed: string
}
export type MockFn = (context: FnContext, ...args: FnValue[]) => FnValue
export interface CompiledFn { invoke(ctx: FnContext, args: FnValue[], timeoutMs: number): FnValue }

export const DEFAULT_FN_TIMEOUT_MS = 100
export class FunctionCompileError extends Error {}
export class FunctionRuntimeError extends Error {}
export class FunctionTimeoutError extends Error {}

export function compileFunctions(source: string, label: string): Map<string, CompiledFn> {
  let code: string
  try {
    // ESM→CJS only — `.mjs` is the sole authoring format (#26); esbuild stays
    // for the module-format transform, not for type stripping.
    code = transformSync(source, { loader: 'js', format: 'cjs', target: 'node18' }).code
  } catch (err) {
    throw new FunctionCompileError(`${label}: failed to transpile: ${message(err)}`)
  }

  const sandbox: Record<string, unknown> = { module: { exports: {} } }
  sandbox.exports = (sandbox.module as { exports: unknown }).exports
  const context = vm.createContext(sandbox)
  try {
    new vm.Script(code, { filename: label }).runInContext(context, { timeout: 1000 })
  } catch (err) {
    throw new FunctionCompileError(`${label}: failed to evaluate: ${message(err)}`)
  }

  const mod = (sandbox.module as { exports: Record<string, unknown> }).exports
  // Placeholders address functions by export name, so a default export has no
  // name to be called by — registering it would expose a callable "default".
  // Fatal rather than skipped so the author sees the mistake at catalog load.
  if ('default' in mod) {
    throw new FunctionCompileError(
      `${label}: default export is not usable; export named functions instead`,
    )
  }
  sandbox.__exports = mod
  const out = new Map<string, CompiledFn>()
  for (const [name, val] of Object.entries(mod)) {
    if (typeof val !== 'function') continue
    const script = new vm.Script(`__exports[${JSON.stringify(name)}].apply(null, [__ctx].concat(__args))`, {
      filename: `${label}#${name}`,
    })
    out.set(name, {
      invoke(ctx: FnContext, args: FnValue[], timeoutMs: number): FnValue {
        sandbox.__ctx = ctx
        sandbox.__args = args
        try {
          return script.runInContext(context, { timeout: timeoutMs }) as FnValue
        } catch (err) {
          if (isTimeout(err)) throw new FunctionTimeoutError(`${label}#${name}: exceeded ${timeoutMs}ms`)
          throw new FunctionRuntimeError(`${label}#${name}: threw: ${message(err)}`)
        }
      },
    })
  }
  return out
}

function isTimeout(err: unknown): boolean {
  return err !== null && typeof err === 'object' &&
    (err as { code?: unknown }).code === 'ERR_SCRIPT_EXECUTION_TIMEOUT'
}
function message(err: unknown): string {
  if (err && typeof err === 'object' && typeof (err as { message?: unknown }).message === 'string') {
    return (err as { message: string }).message
  }
  return String(err)
}
