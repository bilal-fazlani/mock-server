import { describe, expect, it } from 'vitest'
import {
  applyBindAddress,
  BindAddressError,
  DEFAULT_BIND_ADDRESS,
  parseBindAddress,
} from '../../src/lib/bind-address'

describe('parseBindAddress', () => {
  it('defaults to every IPv4 interface when unset or empty', () => {
    expect(DEFAULT_BIND_ADDRESS).toBe('0.0.0.0')
    expect(parseBindAddress(undefined)).toBe('0.0.0.0')
    expect(parseBindAddress('')).toBe('0.0.0.0')
    expect(parseBindAddress('   ')).toBe('0.0.0.0')
  })

  it('accepts IPv4 literals', () => {
    expect(parseBindAddress('0.0.0.0')).toBe('0.0.0.0')
    expect(parseBindAddress('127.0.0.1')).toBe('127.0.0.1')
    expect(parseBindAddress('10.1.2.3')).toBe('10.1.2.3')
  })

  it('accepts IPv6 literals', () => {
    expect(parseBindAddress('::')).toBe('::')
    expect(parseBindAddress('::1')).toBe('::1')
    expect(parseBindAddress('fe80::1')).toBe('fe80::1')
  })

  it('trims surrounding whitespace', () => {
    expect(parseBindAddress(' 127.0.0.1 ')).toBe('127.0.0.1')
  })

  it.each([
    'my-host',
    'localhost',
    'ip-10-0-1-23.eu-west-1.compute.internal',
    '256.1.1.1',
    '1.2.3',
    'not an ip',
    '3000',
  ])('rejects %j, naming the variable and the value', (value) => {
    expect(() => parseBindAddress(value)).toThrow(BindAddressError)
    expect(() => parseBindAddress(value)).toThrow('BIND_ADDRESS')
    expect(() => parseBindAddress(value)).toThrow(`"${value}"`)
  })
})

describe('applyBindAddress', () => {
  it('sets HOSTNAME from BIND_ADDRESS', () => {
    const env: Record<string, string | undefined> = { BIND_ADDRESS: '127.0.0.1' }
    expect(applyBindAddress(env)).toBe('127.0.0.1')
    expect(env.HOSTNAME).toBe('127.0.0.1')
  })

  it('accepts an IPv6 address', () => {
    const env: Record<string, string | undefined> = { BIND_ADDRESS: '::' }
    applyBindAddress(env)
    expect(env.HOSTNAME).toBe('::')
  })

  it('uses the default when BIND_ADDRESS is unset', () => {
    const env: Record<string, string | undefined> = {}
    applyBindAddress(env)
    expect(env.HOSTNAME).toBe('0.0.0.0')
  })

  it('ignores a platform-set HOSTNAME instead of falling back to it', () => {
    const env: Record<string, string | undefined> = { HOSTNAME: 'some-pod-name' }
    applyBindAddress(env)
    expect(env.HOSTNAME).toBe('0.0.0.0')
  })

  it('lets BIND_ADDRESS win over a platform-set HOSTNAME', () => {
    const env: Record<string, string | undefined> = { HOSTNAME: 'ip-10-0-1-23.internal', BIND_ADDRESS: '::1' }
    applyBindAddress(env)
    expect(env.HOSTNAME).toBe('::1')
  })

  it('throws for a non-IP value and leaves HOSTNAME untouched', () => {
    const env: Record<string, string | undefined> = { HOSTNAME: 'some-pod-name', BIND_ADDRESS: 'localhost' }
    expect(() => applyBindAddress(env)).toThrow(BindAddressError)
    expect(env.HOSTNAME).toBe('some-pod-name')
  })
})
