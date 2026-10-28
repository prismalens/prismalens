// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import { localRequestRefusal } from "./local-request.js";

const PORT = 6473;
const base = {
	remoteAddress: "127.0.0.1",
	listeningPort: PORT,
	headers: {
		host: `127.0.0.1:${PORT}`,
		origin: `http://127.0.0.1:${PORT}`,
	} as Record<string, string | undefined>,
};
const facts = (over: Partial<typeof base> & { headers?: Record<string, string | undefined> }) => ({
	...base,
	...over,
	headers: { ...base.headers, ...(over.headers ?? {}) },
});

describe("localRequestRefusal", () => {
	it("accepts the host's own browser on each loopback name", () => {
		expect(localRequestRefusal(base)).toBeNull();
		for (const name of ["localhost", "[::1]"]) {
			expect(
				localRequestRefusal(
					facts({
						remoteAddress: "::1",
						headers: { host: `${name}:${PORT}`, origin: `http://${name}:${PORT}` },
					}),
				),
			).toBeNull();
		}
		expect(localRequestRefusal(facts({ remoteAddress: "::ffff:127.0.0.1" }))).toBeNull();
	});

	it("refuses a peer that is not loopback, even with local headers", () => {
		expect(localRequestRefusal(facts({ remoteAddress: "100.101.102.103" }))).toBe(
			"peer-not-loopback",
		);
		expect(localRequestRefusal(facts({ remoteAddress: "192.168.1.20" }))).toBe(
			"peer-not-loopback",
		);
		expect(localRequestRefusal(facts({ remoteAddress: undefined }))).toBe(
			"peer-not-loopback",
		);
	});

	it("refuses a proxied request: tailscale serve keeps the public Host and adds X-Forwarded-Host", () => {
		expect(
			localRequestRefusal(
				facts({ headers: { host: "box.tail1234.ts.net", origin: "https://box.tail1234.ts.net" } }),
			),
		).toBe("host-not-loopback");
		for (const header of [
			"forwarded",
			"x-forwarded-for",
			"x-forwarded-host",
			"x-forwarded-proto",
			"x-real-ip",
			"tailscale-user-login",
		]) {
			expect(localRequestRefusal(facts({ headers: { [header]: "x" } }))).toBe("forwarded");
		}
	});

	it("refuses a rebound hostname", () => {
		expect(
			localRequestRefusal(
				facts({ headers: { host: `evil.example:${PORT}`, origin: `http://evil.example:${PORT}` } }),
			),
		).toBe("host-not-loopback");
	});

	it("refuses another localhost port: cookies are not port-scoped, origins are", () => {
		expect(
			localRequestRefusal(facts({ headers: { origin: "http://localhost:5173" } })),
		).toBe("origin-mismatch");
		expect(localRequestRefusal(facts({ headers: { host: "127.0.0.1:5173" } }))).toBe(
			"host-not-loopback",
		);
	});

	it("refuses a missing, opaque or cross-scheme origin", () => {
		expect(localRequestRefusal(facts({ headers: { origin: undefined } }))).toBe(
			"origin-mismatch",
		);
		expect(localRequestRefusal(facts({ headers: { origin: "null" } }))).toBe(
			"origin-mismatch",
		);
		expect(
			localRequestRefusal(facts({ headers: { origin: `http://localhost:${PORT}` } })),
		).toBe("origin-mismatch");
	});

	it("accepts the Vite dev origin only when the caller names it", () => {
		const dev = facts({
			headers: { host: `localhost:${PORT}`, origin: "http://localhost:3000", "x-forwarded-for": "127.0.0.1" },
		});
		expect(localRequestRefusal(dev)).not.toBeNull();
		expect(localRequestRefusal({ ...dev, devOrigin: "http://localhost:3000" })).toBeNull();
	});
});
