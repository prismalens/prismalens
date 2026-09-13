// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	displayUrl,
	healthUrl,
	resolveBind,
	resolveConsoleMode,
	resolveLogDir,
	waitForReady,
} from "./up-console.js";

describe("resolveConsoleMode", () => {
	it("defaults to quiet", () => {
		expect(resolveConsoleMode({}, false)).toBe("quiet");
	});
	it("--verbose wins over the env", () => {
		expect(resolveConsoleMode({ PRISMALENS_LOG_CONSOLE: "quiet" }, true)).toBe(
			"verbose",
		);
	});
	it("honours PRISMALENS_LOG_CONSOLE=verbose without the flag", () => {
		expect(resolveConsoleMode({ PRISMALENS_LOG_CONSOLE: "verbose" }, false)).toBe(
			"verbose",
		);
	});
	it("treats an unknown env value as quiet", () => {
		expect(resolveConsoleMode({ PRISMALENS_LOG_CONSOLE: "loud" }, false)).toBe(
			"quiet",
		);
	});
});

describe("resolveLogDir", () => {
	it("defaults to <workspace>/logs", () => {
		expect(resolveLogDir({}, "/data/pl")).toBe(join("/data/pl", "logs"));
	});
	it("honours PRISMALENS_LOG_FILE_LOCATION and ignores the rotated base name", () => {
		expect(
			resolveLogDir(
				{
					PRISMALENS_LOG_FILE_LOCATION: "/var/log/pl",
					PRISMALENS_LOG_FILE_NAME: "app.log",
				},
				"/data/pl",
			),
		).toBe("/var/log/pl");
	});
});

describe("resolveBind and displayUrl", () => {
	it("defaults to http on 127.0.0.1:3001 shown as localhost", () => {
		const bind = resolveBind({});
		expect(bind).toEqual({ host: "127.0.0.1", port: 3001, protocol: "http" });
		expect(displayUrl(bind)).toBe("http://localhost:3001");
	});
	it("reads the env and shows a wildcard bind as localhost", () => {
		const bind = resolveBind({
			PRISMALENS_PORT: "8080",
			PRISMALENS_HOST: "0.0.0.0",
			PRISMALENS_PROTOCOL: "https",
		});
		expect(displayUrl(bind)).toBe("https://localhost:8080");
	});
	it("shows a named host verbatim", () => {
		expect(
			displayUrl({ host: "pl.internal", port: 3001, protocol: "http" }),
		).toBe("http://pl.internal:3001");
	});
	it("falls back to 3001 on a non-numeric port", () => {
		expect(resolveBind({ PRISMALENS_PORT: "abc" }).port).toBe(3001);
	});
});

describe("healthUrl", () => {
	it("probes a wildcard bind over loopback", () => {
		for (const host of ["0.0.0.0", "::"]) {
			const url = healthUrl({ host, port: 3001, protocol: "http" });
			expect(url).toBe("http://127.0.0.1:3001/health");
			expect(() => new URL(url)).not.toThrow();
		}
	});
	it("brackets an IPv6 literal", () => {
		const url = healthUrl({ host: "::1", port: 3001, protocol: "http" });
		expect(url).toBe("http://[::1]:3001/health");
		expect(() => new URL(url)).not.toThrow();
	});
});

describe("waitForReady", () => {
	const noSleep = async () => {};

	it("resolves true once /health answers 200", async () => {
		let calls = 0;
		const fetchImpl = (async () => {
			calls += 1;
			if (calls < 3) throw new Error("ECONNREFUSED");
			return new Response("ok", { status: 200 });
		}) as unknown as typeof fetch;
		await expect(
			waitForReady("http://localhost:3001/health", {
				fetchImpl,
				sleep: noSleep,
				timeoutMs: 5_000,
			}),
		).resolves.toBe(true);
		expect(calls).toBe(3);
	});

	it("keeps polling on a non-200 and resolves false at the deadline", async () => {
		const fetchImpl = (async () =>
			new Response("starting", { status: 503 })) as unknown as typeof fetch;
		await expect(
			waitForReady("http://localhost:3001/health", {
				fetchImpl,
				sleep: noSleep,
				timeoutMs: 20,
				intervalMs: 1,
			}),
		).resolves.toBe(false);
	});
});
