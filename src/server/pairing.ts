/**
 * Pairing token generation and LAN address discovery for mobile mode.
 *
 * When the server runs with mobile enabled it binds to 0.0.0.0 and requires
 * a pairing token on every request. The token is printed as a QR code in
 * the terminal — scanning it opens the mobile client with the token pre-loaded
 * into the URL fragment (fragments don't leave the browser, so they stay
 * out of proxy logs and referrer headers).
 */

import { randomBytes } from 'node:crypto'
import { networkInterfaces } from 'node:os'

/** Returns a 32-char hex token suitable for Bearer auth. */
export function generatePairingToken(): string {
  return randomBytes(16).toString('hex')
}

/**
 * Picks the best LAN IPv4 address to print in the QR code. Prefers private
 * ranges (10.x, 172.16–31.x, 192.168.x) and skips loopback/link-local.
 * Returns 'localhost' if nothing usable is found.
 */
export function getLanAddress(): string {
  const nets = networkInterfaces() as Record<
    string,
    Array<{ family: string; internal: boolean; address: string }> | undefined
  >
  const candidates: string[] = []
  for (const name of Object.keys(nets)) {
    const list = nets[name]
    if (!list) continue
    for (const iface of list) {
      if (iface.family !== 'IPv4' || iface.internal) continue
      if (iface.address.startsWith('169.254.')) continue
      candidates.push(iface.address)
    }
  }
  const priv = candidates.find(
    (a) =>
      a.startsWith('192.168.') ||
      a.startsWith('10.') ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(a),
  )
  return priv ?? candidates[0] ?? 'localhost'
}

/**
 * Builds the mobile client URL. The token lives in the fragment so it never
 * hits server logs or Referer headers.
 */
export function buildPairingUrl(host: string, port: number, token: string): string {
  return `http://${host}:${port}/m#token=${token}`
}
