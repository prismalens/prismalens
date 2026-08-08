// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { NextFunction, Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	createHostAllowlistMiddleware,
	defaultAllowedHostnames,
	isHostnameAllowed,
	isLoopbackBindAddress,
	normalizeHostname,
	resolveAllowedHostnames,
} from "./host-allowlist.middleware.js";

interface Harness {
	next: NextFunction;
	res: Response;
	status: ReturnType<typeof vi.fn>;
	json: ReturnType<typeof vi.fn>;
}

function harness(): Harness {
	const json = vi.fn();
	const status = vi.fn(() => ({ json }));
	return {
		next: vi.fn() as unknown as NextFunction,
		res: { status } as unknown as Response,
		status,
		json,
	};
}

function request(headers: Record<string, string>, path = "/api/health"): Request {
	return { headers, path } as unknown as Request;
}

describe("normalizeHostname", () => {
	it.each([
		["example.com", "example.com"],
		["Example.COM", "example.com"],
		["example.com:8443", "example.com"],
		["https://example.com/some/path", "example.com"],
		["http://localhost:3001", "localhost"],
		["[::1]:3001", "::1"],
		["[::1]", "::1"],
		["::1", "::1"],
		["127.0.0.1:3001", "127.0.0.1"],
		["  example.com  ", "example.com"],
		// Root-label dot: `localhost.` is the same host as `localhost`.
		["localhost.", "localhost"],
		["example.com.:8443", "example.com"],
		// …including via the URL branch, which must agree with the bare one.
		["https://example.com./path", "example.com"],
	])("normalizes %s to %s", (input, expected) => {
		expect(normalizeHostname(input)).toBe(expected);
	});

	it.each(["", "   ", "://", "not a url://x"])(
		"drops the unparseable entry %j rather than widening the allowlist",
		(input) => {
			expect(normalizeHostname(input)).toBeUndefined();
		},
	);
});

describe("resolveAllowedHostnames", () => {
	it("defaults to loopback names when nothing is configured", () => {
		const { hostnames, disabled } = resolveAllowedHostnames({});
		expect(disabled).toBe(false);
		expect(hostnames).toEqual(defaultAllowedHostnames());
		expect(hostnames).toContain("localhost");
	});

	it("adds configured hosts, the public URL and the domain", () => {
		const { hostnames } = resolveAllowedHostnames({
			allowedHosts: "prismalens.internal, ops.example.com:8443",
			publicUrl: "https://prismalens.example.com/app",
			domain: "prismalens.example.com",
		});

		expect(hostnames).toEqual(
			expect.arrayContaining([
				"localhost",
				"prismalens.internal",
				"ops.example.com",
				"prismalens.example.com",
			]),
		);
		// The domain duplicates the public URL's hostname — recorded once.
		expect(hostnames.filter((h) => h === "prismalens.example.com")).toHaveLength(
			1,
		);
	});

	it("admits a configured CORS origin, so the grant is not 403'd first", () => {
		const { hostnames } = resolveAllowedHostnames({
			corsOrigins: "https://dash.example.com, https://ops.example.com",
		});
		expect(hostnames).toEqual(
			expect.arrayContaining([
				"localhost",
				"dash.example.com",
				"ops.example.com",
			]),
		);
	});

	it('treats "*" as an explicit disable', () => {
		expect(resolveAllowedHostnames({ allowedHosts: " * " })).toEqual({
			hostnames: [],
			disabled: true,
		});
	});
});

describe("isHostnameAllowed", () => {
	const allowed = ["localhost", "prismalens.example.com"];

	it("allows an allowlisted hostname regardless of port", () => {
		expect(isHostnameAllowed("localhost:3001", allowed)).toBe(true);
		expect(isHostnameAllowed("prismalens.example.com:8443", allowed)).toBe(true);
	});

	it("rejects a hostname that is not allowlisted", () => {
		expect(isHostnameAllowed("evil.example", allowed)).toBe(false);
		// A subdomain is a different name — no implicit wildcarding.
		expect(isHostnameAllowed("evil.prismalens.example.com", allowed)).toBe(
			false,
		);
	});

	it("allows IP literals, which DNS rebinding cannot produce", () => {
		expect(isHostnameAllowed("192.168.1.5:3001", allowed)).toBe(true);
		expect(isHostnameAllowed("127.0.0.1:3001", allowed)).toBe(true);
		expect(isHostnameAllowed("[::1]:3001", allowed)).toBe(true);
	});

	it("rejects a missing hostname", () => {
		expect(isHostnameAllowed(undefined, allowed)).toBe(false);
	});

	it("accepts the fully qualified form of an allowlisted name", () => {
		expect(isHostnameAllowed("localhost.:3001", allowed)).toBe(true);
	});

	it("does not let the root-label dot smuggle a hostile name through", () => {
		expect(isHostnameAllowed("evil.example.", allowed)).toBe(false);
	});
});

describe("isLoopbackBindAddress", () => {
	it.each(["localhost", "127.0.0.1", "127.0.0.53", "::1", "[::1]"])(
		"treats %s as loopback",
		(address) => {
			expect(isLoopbackBindAddress(address)).toBe(true);
		},
	);

	it.each(["0.0.0.0", "::", "192.168.1.5", "prismalens.example.com"])(
		"treats %s as a network bind",
		(address) => {
			expect(isLoopbackBindAddress(address)).toBe(false);
		},
	);
});

describe("createHostAllowlistMiddleware", () => {
	let h: Harness;

	beforeEach(() => {
		h = harness();
	});

	const middleware = createHostAllowlistMiddleware({
		allowedHostnames: ["localhost", "prismalens.example.com"],
	});

	it("passes an allowlisted Host through", () => {
		middleware(request({ host: "localhost:3001" }), h.res, h.next);
		expect(h.next).toHaveBeenCalledOnce();
		expect(h.status).not.toHaveBeenCalled();
	});

	it("rejects a non-allowlisted Host with 403", () => {
		middleware(request({ host: "evil.example" }), h.res, h.next);
		expect(h.next).not.toHaveBeenCalled();
		expect(h.status).toHaveBeenCalledWith(403);
		expect(h.json.mock.calls[0][0].message).toContain("evil.example");
	});

	it("rejects a request with no Host header at all", () => {
		middleware(request({}), h.res, h.next);
		expect(h.next).not.toHaveBeenCalled();
		expect(h.status).toHaveBeenCalledWith(403);
	});

	it("passes an allowlisted Origin through", () => {
		middleware(
			request({ host: "localhost:3001", origin: "http://localhost:3000" }),
			h.res,
			h.next,
		);
		expect(h.next).toHaveBeenCalledOnce();
	});

	it("rejects a non-allowlisted Origin even when the Host is fine", () => {
		middleware(
			request({ host: "localhost:3001", origin: "https://evil.example" }),
			h.res,
			h.next,
		);
		expect(h.next).not.toHaveBeenCalled();
		expect(h.status).toHaveBeenCalledWith(403);
		expect(h.json.mock.calls[0][0].message).toContain("Origin");
	});

	it("rejects the opaque Origin `null` — a sandboxed iframe is not a caller", () => {
		middleware(
			request({ host: "localhost:3001", origin: "null" }),
			h.res,
			h.next,
		);
		expect(h.next).not.toHaveBeenCalled();
		expect(h.status).toHaveBeenCalledWith(403);
	});

	it("exempts webhook routes from the Origin check but not the Host check", () => {
		const withExemption = createHostAllowlistMiddleware({
			allowedHostnames: ["localhost"],
			originExemptPathPrefixes: ["/api/webhooks/"],
		});

		withExemption(
			request(
				{ host: "localhost:3001", origin: "https://hoppscotch.io" },
				"/api/webhooks/generic",
			),
			h.res,
			h.next,
		);
		expect(h.next).toHaveBeenCalledOnce();

		const second = harness();
		withExemption(
			request(
				{ host: "evil.example", origin: "https://hoppscotch.io" },
				"/api/webhooks/generic",
			),
			second.res,
			second.next,
		);
		expect(second.next).not.toHaveBeenCalled();
		expect(second.status).toHaveBeenCalledWith(403);
	});

	it("is a no-op when explicitly disabled", () => {
		const disabled = createHostAllowlistMiddleware({
			allowedHostnames: [],
			disabled: true,
		});
		disabled(request({ host: "evil.example" }), h.res, h.next);
		expect(h.next).toHaveBeenCalledOnce();
		expect(h.status).not.toHaveBeenCalled();
	});

	it("protects the unconfigured default: loopback in, anything else out", () => {
		const { hostnames, disabled } = resolveAllowedHostnames({});
		const unconfigured = createHostAllowlistMiddleware({
			allowedHostnames: hostnames,
			disabled,
		});

		unconfigured(request({ host: "localhost:3001" }), h.res, h.next);
		expect(h.next).toHaveBeenCalledOnce();

		const rebound = harness();
		unconfigured(request({ host: "rebound.attacker.test" }), rebound.res, rebound.next);
		expect(rebound.next).not.toHaveBeenCalled();
		expect(rebound.status).toHaveBeenCalledWith(403);
	});
});
