import fs from 'node:fs'
import path from 'node:path'

export interface Fixture {
  description?: string
  summary?: string
  status: number
  /** Optional response delay, e.g. "400ms", "2s", "1m". Applied before the
   * mock response is returned. Validated at catalog load. */
  delay?: string
  headers?: Record<string, string>
  body: unknown
}

export class FixtureError extends Error {}

export function fixtureFilePath(
  catalogDir: string,
  systemSlug: string,
  endpointName: string,
  scenario: string,
): string {
  return path.join(catalogDir, systemSlug, endpointName, `${scenario}.json`)
}

export function loadFixture(
  catalogDir: string,
  systemSlug: string,
  endpointName: string,
  scenario: string,
): Fixture {
  const file = fixtureFilePath(catalogDir, systemSlug, endpointName, scenario)
  if (!fs.existsSync(file)) {
    throw new FixtureError(`fixture not found: ${file}`)
  }
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as Fixture
  if (typeof parsed.status !== 'number' || !('body' in parsed)) {
    throw new FixtureError(`invalid fixture (requires numeric "status" and "body"): ${file}`)
  }
  return parsed
}
