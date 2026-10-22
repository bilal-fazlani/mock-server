/** Where the browser reaches a system's mocked API: this page's host, on the system's port. */
export function systemOrigin(port: number | undefined): string {
  if (port === undefined) return window.location.origin
  return `${window.location.protocol}//${window.location.hostname}:${port}`
}
