/**
 * Shared domain allow/block filter for web tools.
 *
 * Used by web_browse (and web_search wrapper if needed) to restrict
 * which domains agents can access.
 *
 * Security: always blocks private/loopback IPs regardless of filter config.
 */

import { isIP } from "node:net"

export interface DomainFilter {
  /** If set, only these domains (and their subdomains) are allowed. */
  allowedDomains?: string[]
  /** If set, these domains (and their subdomains) are blocked. Takes precedence over allowedDomains. */
  blockedDomains?: string[]
}

/**
 * Check whether a hostname is permitted by the filter.
 *
 * Rules:
 *  - Private/loopback IPs are always blocked (SSRF prevention).
 *  - blockedDomains takes precedence over allowedDomains.
 *  - "example.com" matches both "example.com" and "sub.example.com".
 *  - Empty filter (no allowed/blocked) → all public domains allowed.
 */
export function isDomainAllowed(
  hostname: string,
  filter: DomainFilter,
): boolean {
  const normalized = hostname.toLowerCase()

  // Always block private/loopback IPs — SSRF prevention
  if (isPrivateOrLoopback(normalized)) {
    return false
  }

  // Blocked check first — takes precedence
  if (filter.blockedDomains?.length) {
    for (const domain of filter.blockedDomains) {
      if (matchesDomain(normalized, domain.toLowerCase())) {
        return false
      }
    }
  }

  // If allowedDomains is set, hostname must match at least one
  if (filter.allowedDomains?.length) {
    return filter.allowedDomains.some((domain) =>
      matchesDomain(normalized, domain.toLowerCase()),
    )
  }

  return true
}

/** Check if hostname is exactly `domain` or a subdomain of it. */
function matchesDomain(hostname: string, domain: string): boolean {
  return hostname === domain || hostname.endsWith(`.${domain}`)
}

/**
 * Check if a hostname is a private, loopback, or link-local IP address.
 * Handles IPv4, IPv6, and common evasion patterns (localhost alias).
 *
 * The URL constructor in Node.js normalizes hex/octal/decimal IP forms,
 * so by the time we see hostname from `new URL(...)`, it's already canonical.
 */
function isPrivateOrLoopback(hostname: string): boolean {
  // Block "localhost" and common aliases
  if (hostname === "localhost" || hostname === "localhost.localdomain") {
    return true
  }

  // Strip IPv6 brackets if present
  const host = hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname

  const version = isIP(host)
  if (version === 0) return false // not an IP — let domain check handle it

  if (version === 4) {
    const parts = host.split(".").map(Number)
    return (
      parts[0] === 10 ||                                          // 10.0.0.0/8
      parts[0] === 127 ||                                         // 127.0.0.0/8
      (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||  // 172.16.0.0/12
      (parts[0] === 192 && parts[1] === 168) ||                   // 192.168.0.0/16
      (parts[0] === 169 && parts[1] === 254) ||                   // 169.254.0.0/16 (link-local / AWS IMDS)
      host === "0.0.0.0"
    )
  }

  if (version === 6) {
    const addr = host.toLowerCase()
    return (
      addr === "::1" ||               // loopback
      addr === "::" ||                 // unspecified
      addr.startsWith("fc") ||         // unique local (fc00::/7)
      addr.startsWith("fd") ||         // unique local (fc00::/7)
      addr.startsWith("fe80")          // link-local
    )
  }

  return false
}
