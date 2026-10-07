// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	browserCommand,
	displayUrl,
	healthUrl,
	readTelemetryState,
	resolveBind,
	resolveConsoleMode,
	resolveLogDir,
	serviceHint,
	TELEMETRY_CONSENT_NOTICE,
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
	it("defaults to http on 127.0.0.1 at the given port, shown as localhost", () => {
		const bind = resolveBind({}, 6473);
		expect(bind).toEqual({ host: "127.0.0.1", port: 6473, protocol: "http" });
		expect(displayUrl(bind)).toBe("http://localhost:6473");
	});
	it("reads the env and shows a wildcard bind as localhost", () => {
		const bind = resolveBind(
			{ PRISMALENS_HOST: "0.0.0.0", PRISMALENS_PROTOCOL: "https" },
			8080,
		);
		expect(displayUrl(bind)).toBe("https://localhost:8080");
	});
	it("brackets an IPv6 literal in the shown URL", () => {
		const url = displayUrl({ host: "::1", port: 3001, protocol: "http" });
		expect(url).toBe("http://[::1]:3001");
		expect(() => new URL(url)).not.toThrow();
	});
	it("shows a named host verbatim", () => {
		expect(
			displayUrl({ host: "pl.internal", port: 3001, protocol: "http" }),
		).toBe("http://pl.internal:3001");
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

describe("readTelemetryState (#602)", () => {
	const health = (body: unknown, status = 200) =>
		(async () =>
			new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

	it("reads the consent state out of /health", async () => {
		for (const state of ["undecided", "on", "off"] as const) {
			expect(
				await readTelemetryState("http://localhost:3001/health", health({ telemetry: state })),
			).toBe(state);
		}
	});

	it("is null on an old API, a non-200, a bad body or a network failure", async () => {
		expect(
			await readTelemetryState("http://localhost:3001/health", health({ status: "ok" })),
		).toBe(null);
		expect(
			await readTelemetryState("http://localhost:3001/health", health({ telemetry: "maybe" })),
		).toBe(null);
		expect(
			await readTelemetryState("http://localhost:3001/health", health({}, 503)),
		).toBe(null);
		const offline = (async () => {
			throw new TypeError("fetch failed");
		}) as unknown as typeof fetch;
		expect(await readTelemetryState("http://localhost:3001/health", offline)).toBe(
			null,
		);
	});

	it("points at Settings and never asks the terminal to decide", () => {
		expect(TELEMETRY_CONSENT_NOTICE).toContain("Settings");
		expect(TELEMETRY_CONSENT_NOTICE).toContain("nothing is sent");
		expect(TELEMETRY_CONSENT_NOTICE).not.toMatch(/\[y\/n\]|\?$/);
	});
});

describe("browserCommand", () => {
	const url = "http://localhost:3001/pair#t0ken";

	it("opens with the platform's own opener", () => {
		expect(browserCommand("darwin", {}, url)).toEqual({
			file: "open",
			args: [url],
		});
		expect(browserCommand("win32", {}, url)).toEqual({
			file: "cmd",
			args: ["/c", "start", '""', url],
		});
		expect(browserCommand("linux", { DISPLAY: ":0" }, url)).toEqual({
			file: "xdg-open",
			args: [url],
		});
	});

	it("opens under WSL with wslview when on PATH", () => {
		expect(
			browserCommand(
				"linux",
				{ WSL_DISTRO_NAME: "Ubuntu", DISPLAY: ":0" },
				url,
				{ isOnPath: (bin) => bin === "wslview" },
			),
		).toEqual({
			file: "wslview",
			args: [url],
		});
		expect(
			browserCommand(
				"linux",
				{ WSL_INTEROP: "/run/WSL/1_interop" },
				url,
				{ isOnPath: (bin) => bin === "wslview" },
			),
		).toEqual({
			file: "wslview",
			args: [url],
		});
	});

	it("opens under WSL with a PowerShell literal when wslview is missing", () => {
		const pairingUrl = "http://localhost:3170/pair#token123&foo=bar";
		expect(
			browserCommand(
				"linux",
				{ WSL_DISTRO_NAME: "Ubuntu", DISPLAY: ":0" },
				pairingUrl,
				{ isOnPath: () => false },
			),
		).toEqual({
			file: "powershell.exe",
			args: [
				"-NoProfile",
				"-NonInteractive",
				"-Command",
				`Start-Process '${pairingUrl}'`,
			],
		});
	});

	it("doubles a single quote so the URL stays one PowerShell literal", () => {
		const command = browserCommand(
			"linux",
			{ WSL_INTEROP: "/run/WSL/1_interop" },
			"http://h/it's",
			{ isOnPath: () => false },
		);
		expect(command?.args.at(-1)).toBe("Start-Process 'http://h/it''s'");
	});

	it("opens nothing on CI or on Linux with no display", () => {
		expect(browserCommand("darwin", { CI: "true" }, url)).toBeNull();
		expect(browserCommand("linux", {}, url)).toBeNull();
	});
});

describe("serviceHint", () => {
	const hint = "For a machine that should always be on: pl service install";
	it("shown for a foreground pl up on Linux and macOS", () => {
		for (const platform of ["linux", "darwin"] as const) {
			expect(serviceHint({ platform, env: {}, serviceOwnsWorkspace: false })).toBe(hint);
		}
	});
	it("hidden on Windows, under a service, in electron, or when a service owns the workspace", () => {
		expect(serviceHint({ platform: "win32", env: {}, serviceOwnsWorkspace: false })).toBeNull();
		expect(serviceHint({ platform: "linux", env: { PRISMALENS_SERVICE: "1" }, serviceOwnsWorkspace: false })).toBeNull();
		expect(serviceHint({ platform: "linux", env: { PRISMALENS_RUN_MODE: "electron" }, serviceOwnsWorkspace: false })).toBeNull();
		expect(serviceHint({ platform: "darwin", env: {}, serviceOwnsWorkspace: true })).toBeNull();
	});
});
