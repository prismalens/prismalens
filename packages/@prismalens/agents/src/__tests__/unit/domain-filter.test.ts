import { describe, it, expect } from "vitest"
import { isDomainAllowed } from "../../tools/domain-filter.js"

describe("isDomainAllowed", () => {
  it("allows all domains when filter is empty", () => {
    expect(isDomainAllowed("example.com", {})).toBe(true)
    expect(isDomainAllowed("anything.org", {})).toBe(true)
  })

  it("allows exact match in allowedDomains", () => {
    const filter = { allowedDomains: ["example.com"] }
    expect(isDomainAllowed("example.com", filter)).toBe(true)
  })

  it("allows subdomain match in allowedDomains", () => {
    const filter = { allowedDomains: ["example.com"] }
    expect(isDomainAllowed("sub.example.com", filter)).toBe(true)
    expect(isDomainAllowed("deep.sub.example.com", filter)).toBe(true)
  })

  it("rejects non-matching domain when allowedDomains is set", () => {
    const filter = { allowedDomains: ["example.com"] }
    expect(isDomainAllowed("other.com", filter)).toBe(false)
    expect(isDomainAllowed("notexample.com", filter)).toBe(false)
  })

  it("blocks exact match in blockedDomains", () => {
    const filter = { blockedDomains: ["evil.com"] }
    expect(isDomainAllowed("evil.com", filter)).toBe(false)
  })

  it("blocks subdomain match in blockedDomains", () => {
    const filter = { blockedDomains: ["evil.com"] }
    expect(isDomainAllowed("sub.evil.com", filter)).toBe(false)
  })

  it("allows non-blocked domains", () => {
    const filter = { blockedDomains: ["evil.com"] }
    expect(isDomainAllowed("good.com", filter)).toBe(true)
  })

  it("blockedDomains takes precedence over allowedDomains", () => {
    const filter = {
      allowedDomains: ["example.com"],
      blockedDomains: ["example.com"],
    }
    expect(isDomainAllowed("example.com", filter)).toBe(false)
  })

  it("blocks subdomain even when parent is allowed", () => {
    const filter = {
      allowedDomains: ["example.com"],
      blockedDomains: ["bad.example.com"],
    }
    expect(isDomainAllowed("example.com", filter)).toBe(true)
    expect(isDomainAllowed("good.example.com", filter)).toBe(true)
    expect(isDomainAllowed("bad.example.com", filter)).toBe(false)
  })

  it("is case-insensitive", () => {
    const filter = { allowedDomains: ["Example.COM"] }
    expect(isDomainAllowed("example.com", filter)).toBe(true)
    expect(isDomainAllowed("EXAMPLE.COM", filter)).toBe(true)
  })

  it("does not match partial suffix (notexample.com != example.com)", () => {
    const filter = { allowedDomains: ["example.com"] }
    expect(isDomainAllowed("notexample.com", filter)).toBe(false)
  })

  describe("private IP / SSRF prevention", () => {
    it("blocks localhost", () => {
      expect(isDomainAllowed("localhost", {})).toBe(false)
    })

    it("blocks 127.0.0.1 (loopback)", () => {
      expect(isDomainAllowed("127.0.0.1", {})).toBe(false)
    })

    it("blocks 127.x.x.x range", () => {
      expect(isDomainAllowed("127.0.0.2", {})).toBe(false)
    })

    it("blocks 10.x.x.x (private)", () => {
      expect(isDomainAllowed("10.0.0.1", {})).toBe(false)
      expect(isDomainAllowed("10.255.255.255", {})).toBe(false)
    })

    it("blocks 172.16-31.x.x (private)", () => {
      expect(isDomainAllowed("172.16.0.1", {})).toBe(false)
      expect(isDomainAllowed("172.31.255.255", {})).toBe(false)
    })

    it("allows 172.32.x.x (not private)", () => {
      expect(isDomainAllowed("172.32.0.1", {})).toBe(true)
    })

    it("blocks 192.168.x.x (private)", () => {
      expect(isDomainAllowed("192.168.1.1", {})).toBe(false)
    })

    it("blocks 169.254.x.x (link-local / AWS IMDS)", () => {
      expect(isDomainAllowed("169.254.169.254", {})).toBe(false)
    })

    it("blocks 0.0.0.0", () => {
      expect(isDomainAllowed("0.0.0.0", {})).toBe(false)
    })

    it("blocks IPv6 loopback (::1)", () => {
      expect(isDomainAllowed("::1", {})).toBe(false)
    })

    it("blocks IPv6 link-local (fe80::)", () => {
      expect(isDomainAllowed("fe80::1", {})).toBe(false)
    })

    it("blocks private IPs even when in allowedDomains", () => {
      // Private IPs are always blocked regardless of filter
      expect(isDomainAllowed("127.0.0.1", { allowedDomains: ["127.0.0.1"] })).toBe(false)
    })

    it("allows public IPs", () => {
      expect(isDomainAllowed("8.8.8.8", {})).toBe(true)
      expect(isDomainAllowed("1.1.1.1", {})).toBe(true)
    })
  })
})
