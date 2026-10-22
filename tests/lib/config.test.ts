import { describe, expect, it } from 'vitest'
import {
  ConfigError,
  parseBindAddress,
  parseConsoleLogLevel,
  parseLogFormat,
  parseResolverHistoryLimit,
  parsePassthroughAsDefault,
  parseRequestLogTtlSeconds,
  parseProfileApiTtl,
  parseProfileKeyTtlSeconds,
  profileTtlSeconds,
  parseResolverHistoryTtlSeconds,
  parseUnmatchedEndpoints,
  parseUnmockedUsers,
} from '../../src/lib/config'

describe('parseBindAddress', () => {
  it('defaults to 0.0.0.0 and accepts IPv4 and IPv6 literals', () => {
    expect(parseBindAddress(undefined)).toBe('0.0.0.0')
    expect(parseBindAddress('127.0.0.1')).toBe('127.0.0.1')
    expect(parseBindAddress('::1')).toBe('::1')
  })

  it('reports a non-IP value as a ConfigError naming the variable and the value', () => {
    expect(() => parseBindAddress('my-host')).toThrow(ConfigError)
    expect(() => parseBindAddress('my-host')).toThrow('BIND_ADDRESS')
    expect(() => parseBindAddress('my-host')).toThrow('"my-host"')
  })
})

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
  it('defaults to DEFAULT_MOCK when unset', () => {
    expect(parseUnmockedUsers(undefined)).toBe('DEFAULT_MOCK')
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

describe('parseUnmatchedEndpoints', () => {
  it('defaults to ERROR when unset', () => {
    expect(parseUnmatchedEndpoints(undefined)).toBe('ERROR')
  })

  it('accepts ERROR and REAL, case-insensitively', () => {
    expect(parseUnmatchedEndpoints('error')).toBe('ERROR')
    expect(parseUnmatchedEndpoints('Real')).toBe('REAL')
  })

  it('throws ConfigError naming the variable for an unrecognized value, including DEFAULT_MOCK', () => {
    expect(() => parseUnmatchedEndpoints('DEFAULT_MOCK')).toThrow(ConfigError)
    expect(() => parseUnmatchedEndpoints('MAYBE')).toThrow('UNMATCHED_ENDPOINTS')
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

describe('parseLogFormat', () => {
  it('defaults to text when unset', () => {
    expect(parseLogFormat(undefined)).toBe('text')
  })

  it('accepts text and json case-insensitively', () => {
    expect(parseLogFormat('text')).toBe('text')
    expect(parseLogFormat('JSON')).toBe('json')
    expect(parseLogFormat('Json')).toBe('json')
  })

  it('throws ConfigError for an unrecognized value', () => {
    expect(() => parseLogFormat('ecs')).toThrow(ConfigError)
  })
})

describe('parseResolverHistoryLimit', () => {
  it('defaults to 10 when unset', () => {
    expect(parseResolverHistoryLimit(undefined)).toBe(10)
  })
  it('parses a positive integer', () => {
    expect(parseResolverHistoryLimit('25')).toBe(25)
  })
  it('rejects zero, negatives, and non-integers', () => {
    expect(() => parseResolverHistoryLimit('0')).toThrow(ConfigError)
    expect(() => parseResolverHistoryLimit('-3')).toThrow(ConfigError)
    expect(() => parseResolverHistoryLimit('abc')).toThrow(ConfigError)
    expect(() => parseResolverHistoryLimit('1.5')).toThrow(ConfigError)
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

describe('parseResolverHistoryTtlSeconds', () => {
  it('defaults to 1 day (86400s) when unset or empty', () => {
    expect(parseResolverHistoryTtlSeconds(undefined)).toBe(86400)
    expect(parseResolverHistoryTtlSeconds('')).toBe(86400)
  })

  it('parses each supported unit into seconds', () => {
    expect(parseResolverHistoryTtlSeconds('45s')).toBe(45)
    expect(parseResolverHistoryTtlSeconds('30m')).toBe(1800)
    expect(parseResolverHistoryTtlSeconds('24h')).toBe(86400)
    expect(parseResolverHistoryTtlSeconds('7d')).toBe(604800)
  })

  it('rejects zero, missing unit, unsupported unit, and malformed values', () => {
    expect(() => parseResolverHistoryTtlSeconds('0h')).toThrow(ConfigError)
    expect(() => parseResolverHistoryTtlSeconds('100')).toThrow(ConfigError)
    expect(() => parseResolverHistoryTtlSeconds('7w')).toThrow(ConfigError)
    expect(() => parseResolverHistoryTtlSeconds('1d12h')).toThrow(ConfigError)
    expect(() => parseResolverHistoryTtlSeconds('1.5h')).toThrow(ConfigError)
  })

  it('names itself in the error message, not the request-log var', () => {
    expect(() => parseResolverHistoryTtlSeconds('7w')).toThrow(/RESOLVER_HISTORY_TTL_DURATION/)
  })
})

describe('parseProfileKeyTtlSeconds', () => {
  it('defaults to 1 day (86400s) when unset or empty', () => {
    expect(parseProfileKeyTtlSeconds(undefined)).toBe(86400)
    expect(parseProfileKeyTtlSeconds('')).toBe(86400)
  })

  it('parses each supported unit into seconds', () => {
    expect(parseProfileKeyTtlSeconds('45s')).toBe(45)
    expect(parseProfileKeyTtlSeconds('30m')).toBe(1800)
    expect(parseProfileKeyTtlSeconds('24h')).toBe(86400)
    expect(parseProfileKeyTtlSeconds('7d')).toBe(604800)
  })

  it('rejects zero, missing unit, unsupported unit, and malformed values', () => {
    expect(() => parseProfileKeyTtlSeconds('0h')).toThrow(ConfigError)
    expect(() => parseProfileKeyTtlSeconds('100')).toThrow(ConfigError)
    expect(() => parseProfileKeyTtlSeconds('7w')).toThrow(ConfigError)
    expect(() => parseProfileKeyTtlSeconds('1d12h')).toThrow(ConfigError)
    expect(() => parseProfileKeyTtlSeconds('1.5h')).toThrow(ConfigError)
  })

  it('names itself in the error message, not a sibling TTL var', () => {
    expect(() => parseProfileKeyTtlSeconds('7w')).toThrow(/PROFILE_KEY_TTL_DURATION/)
  })
})

describe('parseProfileApiTtl', () => {
  it('defaults to 1d when unset or empty', () => {
    expect(parseProfileApiTtl(undefined)).toBe('1d')
    expect(parseProfileApiTtl('')).toBe('1d')
  })

  it('returns a valid duration as given', () => {
    expect(parseProfileApiTtl('30m')).toBe('30m')
    expect(parseProfileApiTtl('7d')).toBe('7d')
  })

  it('returns null for off, in any case', () => {
    expect(parseProfileApiTtl('off')).toBeNull()
    expect(parseProfileApiTtl('OFF')).toBeNull()
  })

  it('rejects anything else, naming itself', () => {
    expect(() => parseProfileApiTtl('0h')).toThrow(ConfigError)
    expect(() => parseProfileApiTtl('forever')).toThrow(/PROFILE_API_TTL_DURATION/)
    expect(() => parseProfileApiTtl('30s')).toThrow(/PROFILE_API_TTL_DURATION/)
    expect(() => parseProfileApiTtl('366d')).toThrow(/PROFILE_API_TTL_DURATION/)
  })
})

describe('profileTtlSeconds', () => {
  it('reads minutes, hours and days from 1m to 365d', () => {
    expect(profileTtlSeconds('1m')).toBe(60)
    expect(profileTtlSeconds('2h')).toBe(7200)
    expect(profileTtlSeconds('365d')).toBe(365 * 86400)
    expect(profileTtlSeconds('8760h')).toBe(365 * 86400)
  })

  it('returns null for seconds, anything over 365d, and malformed values', () => {
    expect(profileTtlSeconds('30s')).toBeNull()
    expect(profileTtlSeconds('120s')).toBeNull()
    expect(profileTtlSeconds('366d')).toBeNull()
    expect(profileTtlSeconds('8761h')).toBeNull()
    expect(profileTtlSeconds('525601m')).toBeNull()
    expect(profileTtlSeconds('99999999999999999d')).toBeNull()
    expect(profileTtlSeconds('0h')).toBeNull()
    expect(profileTtlSeconds('1d12h')).toBeNull()
    expect(profileTtlSeconds('')).toBeNull()
  })
})
