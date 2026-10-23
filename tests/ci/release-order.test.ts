import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const script = resolve(__dirname, '../../.github/scripts/release-order.sh');

function decide(tag: string, published: string[]) {
  const out = execFileSync(script, [tag], {
    encoding: 'utf8',
    env: { ...process.env, RELEASE_TAGS: published.join('\n') },
  });
  return Object.fromEntries(out.trim().split('\n').map((l) => l.split('=')));
}

const published = ['v0.9.0', 'v0.19.0', 'v0.18.0', 'v0.16.0', 'v0.10.0'];

describe('release-order.sh', () => {
  it('a new highest release moves everything', () => {
    expect(decide('v0.20.0', [...published, 'v0.20.0'])).toEqual({
      highest: 'v0.20.0',
      is_highest: 'true',
      npm_tag: 'latest',
    });
  });

  it('is already published when decided: still highest, not displaced by itself', () => {
    expect(decide('v0.19.0', published).is_highest).toBe('true');
  });

  it('compares by semver, not lexically', () => {
    expect(decide('v0.9.1', published)).toMatchObject({ highest: 'v0.19.0', is_highest: 'false' });
    expect(decide('v0.100.0', published).is_highest).toBe('true');
  });

  it('a backport moves nothing and publishes under its own npm tag', () => {
    expect(decide('v0.16.1', [...published, 'v0.16.1'])).toEqual({
      highest: 'v0.19.0',
      is_highest: 'false',
      npm_tag: '0.16-backport',
    });
  });

  it('a prerelease is never highest and goes to next', () => {
    expect(decide('v1.0.0-rc.1', published)).toEqual({
      highest: 'v0.19.0',
      is_highest: 'false',
      npm_tag: 'next',
    });
  });

  it('the first release is the highest', () => {
    expect(decide('v0.1.0', [])).toMatchObject({ highest: 'v0.1.0', is_highest: 'true' });
  });

  it('a non-tag candidate only reports the highest published release', () => {
    expect(decide('none', published).highest).toBe('v0.19.0');
  });
});
