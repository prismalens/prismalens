// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { createServer } from "node:net";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
	browserCommand,
	displayUrl,
	healthUrl,
	networkBindWarning,
	portFree,
	portInUseLine,
	readTelemetryState,
	resolveBind,
	resolveConsoleMode,
	resolveLogDir,
	serviceHint,
	TELEMETRY_NOTICE,
	watchPairings,
	WSL_POWERSHELL,
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

describe("readTelemetryState (#602, #673 w45)", () => {
	const health = (body: unknown, status = 200) =>
		(async () =>
			new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

	it("reads the notice state out of /health", async () => {
		for (const state of ["notice", "on", "off"] as const) {
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
			await readTelemetryState("http://localhost:3001/health", health({ telemetry: "undecided" })),
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

	it("names the off switches and never asks the terminal to decide", () => {
		expect(TELEMETRY_NOTICE).toContain("Settings, Usage data");
		expect(TELEMETRY_NOTICE).toContain("PRISMALENS_TELEMETRY=off");
		expect(TELEMETRY_NOTICE).toContain("DO_NOT_TRACK=1");
		expect(TELEMETRY_NOTICE).toContain("Nothing is sent before the next start");
		expect(TELEMETRY_NOTICE).not.toMatch(/\[y\/n\]|\?$/);
	});
});

describe("networkBindWarning (#673)", () => {
	it("says nothing for a loopback bind", () => {
		for (const host of ["127.0.0.1", "127.0.1.1", "localhost", "::1", "[::1]"]) {
			expect(networkBindWarning({ host, protocol: "http" })).toBeNull();
		}
	});
	it("prints one plain line for a network bind", () => {
		const line = networkBindWarning({ host: "0.0.0.0", protocol: "http" });
		expect(line).toMatch(/^Bound to 0\.0\.0\.0: .*plain HTTP/);
		expect(line).not.toMatch(/[\n{}]/);
		expect(networkBindWarning({ host: "::", protocol: "https" })).toMatch(
			/over HTTPS/,
		);
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
				{ isOnPath: () => false, which: () => "/mnt/c/ps/powershell.exe" },
			),
		).toEqual({
			file: "/mnt/c/ps/powershell.exe",
			args: [
				"-NoProfile",
				"-NonInteractive",
				"-Command",
				`Start-Process '${pairingUrl}'`,
			],
		});
	});

	it("falls back to System32's PowerShell when Windows is off PATH (appendWindowsPath=false)", () => {
		expect(
			browserCommand("linux", { WSL_DISTRO_NAME: "Ubuntu", PATH: "/usr/bin" }, url, {
				isOnPath: () => false,
				which: () => null,
			})?.file,
		).toBe(WSL_POWERSHELL);
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

describe("watchPairings", () => {
	it("the startup link redeemed -> report called once with \"Paired this machine's browser (<name>).\" and kind \"paired\"; advancing past expiresAt reports nothing more", () => {
		vi.useFakeTimers();
		try {
			const link = {
				id: "link-1",
				expiresAt: new Date(Date.now() + 60_000),
			};
			let storedListener:
				| ((event: { linkId: string; device: { name: string } }) => void)
				| null = null;
			const subscribe = (
				listener: (event: { linkId: string; device: { name: string } }) => void,
			) => {
				storedListener = listener;
			};
			const report = vi.fn();

			watchPairings(link, subscribe, report);

			expect(storedListener).not.toBeNull();
			storedListener!({
				linkId: "link-1",
				device: { name: "MacBook Pro" },
			});

			expect(report).toHaveBeenCalledTimes(1);
			expect(report).toHaveBeenCalledWith(
				"Paired this machine's browser (MacBook Pro).",
				"paired",
			);

			vi.advanceTimersByTime(120_000);
			expect(report).toHaveBeenCalledTimes(1);
		} finally {
			vi.useRealTimers();
		}
	});

	it("never redeemed -> after advancing to expiresAt, report called with the line starting \"The startup link expired unused.\" and kind \"expired\"", () => {
		vi.useFakeTimers();
		try {
			const link = {
				id: "link-1",
				expiresAt: new Date(Date.now() + 60_000),
			};
			const subscribe = vi.fn();
			const report = vi.fn();

			watchPairings(link, subscribe, report);

			expect(report).not.toHaveBeenCalled();

			vi.advanceTimersByTime(60_000);

			expect(report).toHaveBeenCalledTimes(1);
			expect(report).toHaveBeenCalledWith(
				"The startup link expired unused. `pl pair --operator` prints another.",
				"expired",
			);
		} finally {
			vi.useRealTimers();
		}
	});

	it("a redemption of a different link id -> \"A device paired: <name>.\" and the expiry line still fires later", () => {
		vi.useFakeTimers();
		try {
			const link = {
				id: "link-1",
				expiresAt: new Date(Date.now() + 60_000),
			};
			let storedListener:
				| ((event: { linkId: string; device: { name: string } }) => void)
				| null = null;
			const subscribe = (
				listener: (event: { linkId: string; device: { name: string } }) => void,
			) => {
				storedListener = listener;
			};
			const report = vi.fn();

			watchPairings(link, subscribe, report);

			expect(storedListener).not.toBeNull();
			storedListener!({
				linkId: "link-other",
				device: { name: "Pixel 9" },
			});

			expect(report).toHaveBeenCalledTimes(1);
			expect(report).toHaveBeenCalledWith(
				"A device paired: Pixel 9.",
				"paired",
			);

			vi.advanceTimersByTime(60_000);

			expect(report).toHaveBeenCalledTimes(2);
			expect(report).toHaveBeenLastCalledWith(
				"The startup link expired unused. `pl pair --operator` prints another.",
				"expired",
			);
		} finally {
			vi.useRealTimers();
		}
	});
});

describe("portFree", () => {
	it("listen a node:net server on 127.0.0.1 port 0, read its port, expect portFree false; close it, expect true", async () => {
		const server = createServer();
		await new Promise<void>((resolve) => {
			server.listen({ host: "127.0.0.1", port: 0 }, () => resolve());
		});

		const address = server.address();
		if (!address || typeof address === "string") {
			throw new Error("Unexpected address");
		}
		const port = address.port;

		const freeWhileListening = await portFree("127.0.0.1", port);
		expect(freeWhileListening).toBe(false);

		await new Promise<void>((resolve, reject) => {
			server.close((err) => (err ? reject(err) : resolve()));
		});

		const freeAfterClose = await portFree("127.0.0.1", port);
		expect(freeAfterClose).toBe(true);
	});
});

describe("portInUseLine", () => {
	it("exact strings for true and false", () => {
		expect(portInUseLine(3170, true)).toBe(
			"Port 3170 is in use by another PrismaLens. Stop it, or start this one on another port with --port.",
		);
		expect(portInUseLine(3170, false)).toBe(
			"Port 3170 is in use. Start on another port with --port.",
		);
	});
});

