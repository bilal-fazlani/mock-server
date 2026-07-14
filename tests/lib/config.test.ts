import { describe, expect, it } from 'vitest'
import {
  ConfigError,
  parseConsoleLogLevel,
  parseDynamicHistoryLimit,
  parsePassthroughAsDefault,
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
