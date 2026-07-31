import { afterEach, describe, expect, it, vi } from 'vitest'
import { formatJsonLine, writeConsoleLog } from '../../src/lib/logs/console'

function spyConsole() {
  const info = vi.spyOn(console, 'info').mockImplementation(() => {})
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  return { info, warn, error }
}

const originalEnv = { ...process.env }

afterEach(() => {
  vi.restoreAllMocks()
  process.env = { ...originalEnv }
})

describe('formatJsonLine', () => {
  it('leads with the three fields Kibana and Datadog treat specially', () => {
    const line = formatJsonLine('warn', 'something happened', {}, new Date('2026-07-31T10:00:00Z'))

    expect(Object.keys(JSON.parse(line)).slice(0, 3)).toEqual([
      '@timestamp',
      'log.level',
      'message',
    ])
    expect(JSON.parse(line)).toMatchObject({
      '@timestamp': '2026-07-31T10:00:00.000Z',
      'log.level': 'warn',
      message: 'something happened',
      'service.name': 'mock-server',
    })
  })

  it('omits undefined fields rather than emitting them as null', () => {
    const parsed = JSON.parse(
      formatJsonLine('info', 'msg', { 'mock.scenario': 'default', 'mock.profileId': undefined }),
    )

    expect(parsed['mock.scenario']).toBe('default')
    expect(parsed).not.toHaveProperty('mock.profileId')
  })

  it('never emits a top-level "status" key, which Datadog remaps to the log severity', () => {
    const parsed = JSON.parse(formatJsonLine('info', 'msg', { 'http.response.status_code': 200 }))

    expect(parsed).not.toHaveProperty('status')
    expect(parsed['http.response.status_code']).toBe(200)
  })
})

describe('writeConsoleLog', () => {
  it('writes the bare message in text format', () => {
    const spy = spyConsole()

    writeConsoleLog('warn', 'plain line', { level: 'info', format: 'text', fields: { a: 1 } })

    expect(spy.warn).toHaveBeenCalledWith('plain line')
  })

  it('applies the severity threshold identically in both formats', () => {
    const spy = spyConsole()

    writeConsoleLog('info', 'quiet', { level: 'warn', format: 'text' })
    writeConsoleLog('info', 'quiet', { level: 'warn', format: 'json' })
    writeConsoleLog('error', 'loud', { level: 'warn', format: 'text' })

    expect(spy.info).not.toHaveBeenCalled()
    expect(spy.error).toHaveBeenCalledWith('loud')
  })

  it('falls back to MOCK_LOG_FORMAT and MOCK_CONSOLE_LOG_LEVEL when not passed explicitly', () => {
    const spy = spyConsole()
    process.env.MOCK_LOG_FORMAT = 'json'
    process.env.MOCK_CONSOLE_LOG_LEVEL = 'warn'

    writeConsoleLog('info', 'below threshold')
    writeConsoleLog('warn', 'catalog warning: x', { fields: { 'event.action': 'catalog_warning' } })

    expect(spy.info).not.toHaveBeenCalled()
    expect(JSON.parse(spy.warn.mock.calls[0][0] as string)).toMatchObject({
      'log.level': 'warn',
      message: 'catalog warning: x',
      'event.action': 'catalog_warning',
    })
  })

  it('falls back to the defaults instead of throwing when the env values are invalid', () => {
    const spy = spyConsole()
    process.env.MOCK_LOG_FORMAT = 'ecs'
    process.env.MOCK_CONSOLE_LOG_LEVEL = 'debug'

    expect(() => writeConsoleLog('info', 'still logged')).not.toThrow()
    expect(spy.info).toHaveBeenCalledWith('still logged')
  })
})
