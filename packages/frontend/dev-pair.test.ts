// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { IncomingMessage } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isLocalRequest, isPaired } from "./dev-pair.ts";

function request(remoteAddress: string, host: string): IncomingMessage {
	return { socket: { remoteAddress }, headers: { host } } as IncomingMessage;
}

describe("isLocalRequest", () => {
	it("accepts a browser on this machine", () => {
		expect(isLocalRequest(request("127.0.0.1", "localhost:3000"))).toBe(true);
		expect(isLocalRequest(request("::1", "[::1]:3000"))).toBe(true);
		expect(isLocalRequest(request("::ffff:127.0.0.1", "127.0.0.1:3000"))).toBe(
			true,
		);
	});

	it("refuses a LAN client of a `--host` dev server", () => {
		expect(isLocalRequest(request("192.168.1.20", "192.168.1.5:3000"))).toBe(
			false,
		);
		expect(isLocalRequest(request("192.168.1.20", "localhost:3000"))).toBe(
			false,
		);
	});

	it("refuses a tunnel, whose client connects over loopback", () => {
		expect(isLocalRequest(request("127.0.0.1", "abc.trycloudflare.com"))).toBe(
			false,
		);
	});
});

describe("isPaired", () => {
	afterEach(() => vi.unstubAllGlobals());

	it("reads `via` from a successful whoami", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => Response.json({ via: null, scopes: [] })),
		);
		await expect(isPaired("http://api", undefined)).resolves.toBe(false);
	});

	it("throws on a failed whoami instead of calling the browser paired", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => Response.json({ message: "boom" }, { status: 500 })),
		);
		await expect(isPaired("http://api", undefined)).rejects.toThrow(
			"whoami 500",
		);
	});
});
