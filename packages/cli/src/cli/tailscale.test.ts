// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import {
	ensureServe,
	removeServe,
	type Run,
	type RunResult,
	serveTarget,
	TailscaleError,
	tailnetHostname,
	withAllowedHost,
} from "./tailscale.js";

const ok = (stdout: string): RunResult => ({ status: 0, stdout, stderr: "" });
const running = ok(
	JSON.stringify({ BackendState: "Running", Self: { DNSName: "Box.tail1.ts.net." } }),
);

function fake(responses: Record<string, RunResult>): Run & { calls: string[][] } {
	const calls: string[][] = [];
	const run = ((args: string[]) => {
		calls.push(args);
		const key = args.join(" ");
		const hit = Object.keys(responses).find((k) => key.startsWith(k));
		return hit ? responses[hit] : ok("");
	}) as Run & { calls: string[][] };
	run.calls = calls;
	return run;
}

describe("tailnetHostname", () => {
	it("reads Self.DNSName without the root dot, lowercased", () => {
		expect(tailnetHostname(fake({ "status --json": running }))).toBe("box.tail1.ts.net");
	});

	it("names a missing CLI", () => {
		const run = fake({ status: { status: null, stdout: "", stderr: "" } });
		expect(() => tailnetHostname(run)).toThrow(/isn't on PATH/);
	});

	it("names a logged-out daemon", () => {
		const run = fake({ "status --json": ok(JSON.stringify({ BackendState: "NeedsLogin" })) });
		expect(() => tailnetHostname(run)).toThrow(/logged out.*tailscale up/);
	});

	it("names a missing MagicDNS name", () => {
		const run = fake({ "status --json": ok(JSON.stringify({ BackendState: "Running", Self: {} })) });
		expect(() => tailnetHostname(run)).toThrow(TailscaleError);
	});
});

describe("ensureServe", () => {
	it("creates the mapping when none exists", () => {
		const run = fake({ "status --json": running, "serve status --json": ok("{}") });
		expect(ensureServe("http://127.0.0.1:6473", run)).toEqual({
			url: "https://box.tail1.ts.net",
			created: true,
		});
		expect(run.calls.at(-1)).toEqual(["serve", "--bg", "--https=443", "http://127.0.0.1:6473"]);
	});

	it("keeps a mapping that already points at this server", () => {
		const status = { Web: { "box.tail1.ts.net:443": { Handlers: { "/": { Proxy: "http://127.0.0.1:6473" } } } } };
		const run = fake({ "status --json": running, "serve status --json": ok(JSON.stringify(status)) });
		expect(ensureServe("http://127.0.0.1:6473", run).created).toBe(false);
		expect(run.calls).toHaveLength(2);
	});

	it("refuses to replace a mapping to something else", () => {
		const status = { Web: { "box.tail1.ts.net:443": { Handlers: { "/": { Proxy: "http://127.0.0.1:3000" } } } } };
		const run = fake({ "status --json": running, "serve status --json": ok(JSON.stringify(status)) });
		expect(() => ensureServe("http://127.0.0.1:6473", run)).toThrow(/already serves/);
	});

	it("explains a serve the user may not configure", () => {
		const run = fake({
			"status --json": running,
			"serve status --json": ok(""),
			"serve --bg": { status: 1, stdout: "", stderr: "Access denied: serve config denied" },
		});
		expect(() => ensureServe("http://127.0.0.1:6473", run)).toThrow(/--operator/);
	});

	it("passes through why serve is not enabled on the tailnet", () => {
		const run = fake({
			"status --json": running,
			"serve status --json": ok(""),
			"serve --bg": { status: 1, stdout: "Serve is not enabled on your tailnet.\nhttps://login.tailscale.com/f/serve", stderr: "" },
		});
		expect(() => ensureServe("http://127.0.0.1:6473", run)).toThrow(/not enabled/);
	});

	it("explains a timeout during cert issuance", () => {
		const timeoutError = Object.assign(new Error("timed out"), { code: "ETIMEDOUT" });
		const run = fake({
			"status --json": running,
			"serve status --json": ok("{}"),
			"serve --bg": { status: null, stdout: "", stderr: "", error: timeoutError },
		});
		expect(() => ensureServe("http://127.0.0.1:3170", run)).toThrow(
			"Tailscale is still issuing this machine's HTTPS certificate. Run `tailscale serve --bg --https=443 http://127.0.0.1:3170` once, then rerun.",
		);
		expect(() => ensureServe("http://localhost", run)).toThrow(
			"Run `tailscale serve --bg --https=443 http://localhost` once",
		);
	});
});

describe("serveTarget", () => {
	it("proxies a wildcard or default bind through loopback", () => {
		expect(serveTarget("0.0.0.0", 6473)).toBe("http://127.0.0.1:6473");
		expect(serveTarget(undefined, 6473)).toBe("http://127.0.0.1:6473");
		expect(serveTarget("127.0.0.1", 1)).toBe("http://127.0.0.1:1");
	});

	it("rejects a bind tailscale serve cannot proxy to", () => {
		expect(() => serveTarget("192.168.1.5", 1)).toThrow(TailscaleError);
		expect(() => serveTarget("::1", 1)).toThrow(/only proxy to 127.0.0.1/);
	});
});

describe("spawn failures", () => {
	it("reports a non-ENOENT spawn error instead of a missing CLI", () => {
		const error = Object.assign(new Error("spawnSync tailscale EACCES"), { code: "EACCES" });
		const run = fake({ status: { status: null, stdout: "", stderr: "", error } });
		expect(() => tailnetHostname(run)).toThrow(/could not run: spawnSync tailscale EACCES/);
	});
});

describe("non-proxy root handler", () => {
	it("refuses to replace a text handler on /", () => {
		const run = fake({
			"status --json": running,
			"serve status": ok(
				JSON.stringify({ Web: { "box.tail1.ts.net:443": { Handlers: { "/": { Text: "hi" } } } } }),
			),
		});
		expect(() => ensureServe("http://127.0.0.1:1", run)).toThrow(/already serves a non-proxy/);
		expect(run.calls.some((c) => c.includes("--bg"))).toBe(false);
	});
});

describe("removeServe", () => {
	const mapped = (proxy: string) =>
		ok(JSON.stringify({ Web: { "box.tail1.ts.net:443": { Handlers: { "/": { Proxy: proxy } } } } }));

	it("turns off a mapping that still points at this server", () => {
		const run = fake({ "status --json": running, "serve status": mapped("http://127.0.0.1:1") });
		removeServe("http://127.0.0.1:1", run);
		expect(run.calls).toContainEqual(["serve", "--https=443", "off"]);
	});

	it("leaves a mapping that now points elsewhere", () => {
		const run = fake({ "status --json": running, "serve status": mapped("http://127.0.0.1:2") });
		removeServe("http://127.0.0.1:1", run);
		expect(run.calls).not.toContainEqual(["serve", "--https=443", "off"]);
	});
});

describe("withAllowedHost", () => {
	it("appends once and never widens to *", () => {
		expect(withAllowedHost(undefined, "b.ts.net")).toBe("b.ts.net");
		expect(withAllowedHost("a.example, b.ts.net", "b.ts.net")).toBe("a.example,b.ts.net");
		expect(withAllowedHost("*", "b.ts.net")).toBe("*");
	});
});
