/**
 * True for loopback, private, and link-local addresses — the networks staff
 * are actually sitting on when they use the console.
 */
export function isLocalAddress(ip: string): boolean {
  // Node reports IPv4 clients as ::ffff:a.b.c.d on a dual-stack listener.
  const address = ip.startsWith("::ffff:") ? ip.slice(7) : ip;
  if (address === "::1") return true;
  if (/^127\./.test(address)) return true;
  if (/^10\./.test(address)) return true;
  if (/^192\.168\./.test(address)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(address)) return true;
  if (/^169\.254\./.test(address)) return true;
  // IPv6 unique-local (fc00::/7) and link-local (fe80::/10).
  return /^f[cd]/i.test(address) || /^fe[89ab]/i.test(address);
}
