import { describe, expect, it } from 'vitest'
import {
  ConfigError,
  parseConsoleLogLevel,
  parseDynamicHistoryLimit,
  parsePassthroughAsDefault,
  parseRequestLogTtlSeconds,
  parseUnmockedUsers,
} from '../../src/lib/config'

describe('parsePassthroughAsDefault', () => {
  it('defaults to false when unset', () => {
    expect(parsePassthroughAsDefault(undefined)).toBe(false)
  })

  it('accepts true and false values, case-insensitively', () => {
    expect(parsePassthroughAsDefault('true')).toBe(true)
    expect(parsePassthroughAsDefault('TRUE')).toBe(true)
    expect(parsePassthroughAsDefault('false')).toBe(false)
    expect(parsePassthroughAsDefault('FALSE')).toBe(false)
  })

  it('throws ConfigError for an unrecognized value', () => {
    expect(() => parsePassthroughAsDefault('YES')).toThrow(ConfigError)
  })
})

describe('parseUnmockedUsers', () => {
  it('defaults to ERROR when unset', () => {
    expect(parseUnmockedUsers(undefined)).toBe('ERROR')
  })

  it('accepts the three valid values, case-insensitively', () => {
    expect(parseUnmockedUsers('error')).toBe('ERROR')
    expect(parseUnmockedUsers('default_mock')).toBe('DEFAULT_MOCK')
    expect(parseUnmockedUsers('REAL')).toBe('REAL')
  })

  it('throws ConfigError for an unrecognized value', () => {
    expect(() => parseUnmockedUsers('MAYBE')).toThrow(ConfigError)
  })
})

describe('parseConsoleLogLevel', () => {
  it('defaults to info when unset', () => {
    expect(parseConsoleLogLevel(undefined)).toBe('info')
  })

  it('accepts info, warn, and error values case-insensitively', () => {
    expect(parseConsoleLogLevel('INFO')).toBe('info')
    expect(parseConsoleLogLevel('warn')).toBe('warn')
    expect(parseConsoleLogLevel('Error')).toBe('error')
  })

  it('throws ConfigError for an unrecognized value', () => {
    expect(() => parseConsoleLogLevel('debug')).toThrow(ConfigError)
  })
})

describe('parseDynamicHistoryLimit', () => {
  it('defaults to 10 when unset', () => {
    expect(parseDynamicHistoryLimit(undefined)).toBe(10)
  })
  it('parses a positive integer', () => {
    expect(parseDynamicHistoryLimit('25')).toBe(25)
  })
  it('rejects zero, negatives, and non-integers', () => {
    expect(() => parseDynamicHistoryLimit('0')).toThrow(ConfigError)
    expect(() => parseDynamicHistoryLimit('-3')).toThrow(ConfigError)
    expect(() => parseDynamicHistoryLimit('abc')).toThrow(ConfigError)
    expect(() => parseDynamicHistoryLimit('1.5')).toThrow(ConfigError)
  })
})

describe('parseRequestLogTtlSeconds', () => {
  it('defaults to 1 day (86400s) when unset or empty', () => {
    expect(parseRequestLogTtlSeconds(undefined)).toBe(86400)
    expect(parseRequestLogTtlSeconds('')).toBe(86400)
  })

  it('parses each supported unit into seconds', () => {
    expect(parseRequestLogTtlSeconds('45s')).toBe(45)
    expect(parseRequestLogTtlSeconds('30m')).toBe(1800)
    expect(parseRequestLogTtlSeconds('24h')).toBe(86400)
    expect(parseRequestLogTtlSeconds('7d')).toBe(604800)
    expect(parseRequestLogTtlSeconds('1d')).toBe(86400)
  })

  it('rejects zero, missing unit, unsupported unit, and malformed values', () => {
    expect(() => parseRequestLogTtlSeconds('0h')).toThrow(ConfigError)
    expect(() => parseRequestLogTtlSeconds('100')).toThrow(ConfigError)
    expect(() => parseRequestLogTtlSeconds('7w')).toThrow(ConfigError)
    expect(() => parseRequestLogTtlSeconds('1d12h')).toThrow(ConfigError)
    expect(() => parseRequestLogTtlSeconds('-3d')).toThrow(ConfigError)
    expect(() => parseRequestLogTtlSeconds('1.5h')).toThrow(ConfigError)
    expect(() => parseRequestLogTtlSeconds('abc')).toThrow(ConfigError)
    expect(() => parseRequestLogTtlSeconds('h')).toThrow(ConfigError)
  })
})
