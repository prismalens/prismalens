// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Hermetic tests for the process launcher: the child env must be built from the
 * allowlist (never process.env verbatim), the caller's env must win, and
 * destroy() must reap live children. No network/LLM.
 */
import { once } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildChildEnv, createProcessLauncher } from "./process.js";

const SECRET = "PRISMALENS_FLOOR_TEST_SECRET";

afterEach(() => {
	delete process.env[SECRET];
	vi.unstubAllEnvs();
});

describe("buildChildEnv (ADR 0004 §5)", () => {
	it("drops host secrets that are not on the allowlist", () => {
		process.env[SECRET] = "leak-me";
		const env = buildChildEnv();
		expect(env[SECRET]).toBeUndefined();
	});

	it("keeps allowlisted vars and layers the caller's env on top", () => {
		process.env[SECRET] = "leak-me";
		const env = buildChildEnv({ OPENAI_API_KEY: "byo-key", TZ: "UTC" });
		expect(env.OPENAI_API_KEY).toBe("byo-key");
		expect(env.TZ).toBe("UTC"); // caller wins over the inherited value
		expect(env[SECRET]).toBeUndefined();
		if (process.env.PATH !== undefined) expect(env.PATH).toBe(process.env.PATH);
	});

	it("passes proxy and private-CA settings through so the agent can reach its provider (#633)", () => {
		vi.stubEnv("HTTPS_PROXY", "http://proxy.corp:3128");
		vi.stubEnv("no_proxy", "localhost,.corp");
		vi.stubEnv("NODE_EXTRA_CA_CERTS", "/etc/ssl/corp-ca.pem");
		const env = buildChildEnv();
		expect(env.HTTPS_PROXY).toBe("http://proxy.corp:3128");
		expect(env.no_proxy).toBe("localhost,.corp");
		expect(env.NODE_EXTRA_CA_CERTS).toBe("/etc/ssl/corp-ca.pem");
	});

	it("keeps a relocated Claude config dir for a laptop placement (#650)", () => {
		vi.stubEnv("CLAUDE_CONFIG_DIR", "/home/dev/.config/claude");
		expect(buildChildEnv().CLAUDE_CONFIG_DIR).toBe("/home/dev/.config/claude");
		// A server placement's row still wins: the caller's env is layered on top.
		expect(buildChildEnv({ CLAUDE_CONFIG_DIR: "/run/x/home" }).CLAUDE_CONFIG_DIR).toBe(
			"/run/x/home",
		);
	});

	it("skips undefined caller entries instead of stringifying them", () => {
		const env = buildChildEnv({ OPENAI_BASE_URL: undefined });
		expect("OPENAI_BASE_URL" in env).toBe(false);
	});

	it("drops PRISMALENS_* keys even if the caller passes them in extra", () => {
		const env = buildChildEnv({
			PRISMALENS_AUTH_SECRET: "leak-me",
			PRISMALENS_WEBHOOK_SECRET: "leak-me-too",
			OPENAI_API_KEY: "byo-key",
		});
		expect(env.PRISMALENS_AUTH_SECRET).toBeUndefined();
		expect(env.PRISMALENS_WEBHOOK_SECRET).toBeUndefined();
		expect(env.OPENAI_API_KEY).toBe("byo-key");
	});
});

describe("createProcessLauncher", () => {
	it("spawns a duplex-stdio child with the scrubbed env", async () => {
		process.env[SECRET] = "leak-me";
		const launcher = createProcessLauncher();
		const child = launcher.spawn(
			process.execPath,
			["-e", "process.stdout.write(JSON.stringify(process.env))"],
			{ cwd: process.cwd(), env: { OPENAI_API_KEY: "byo-key" } },
		);
		const chunks: Buffer[] = [];
		child.stdout.on("data", (d: Buffer) => chunks.push(d));
		await once(child, "close");
		const childEnv = JSON.parse(Buffer.concat(chunks).toString()) as Record<
			string,
			string
		>;
		expect(childEnv.OPENAI_API_KEY).toBe("byo-key");
		expect(childEnv[SECRET]).toBeUndefined();
		await launcher.destroy();
	});

	it("a child spawned with PRISMALENS_AUTH_SECRET and PRISMALENS_WEBHOOK_SECRET in the parent env sees neither", async () => {
		vi.stubEnv("PRISMALENS_AUTH_SECRET", "auth-secret-123");
		vi.stubEnv("PRISMALENS_WEBHOOK_SECRET", "webhook-secret-456");
		const launcher = createProcessLauncher();
		const child = launcher.spawn(
			process.execPath,
			["-e", "process.stdout.write(JSON.stringify(process.env))"],
			{ cwd: process.cwd(), env: { OPENAI_API_KEY: "byo-key" } },
		);
		const chunks: Buffer[] = [];
		child.stdout.on("data", (d: Buffer) => chunks.push(d));
		await once(child, "close");
		const childEnv = JSON.parse(Buffer.concat(chunks).toString()) as Record<
			string,
			string
		>;
		expect(childEnv.OPENAI_API_KEY).toBe("byo-key");
		expect(childEnv.PRISMALENS_AUTH_SECRET).toBeUndefined();
		expect(childEnv.PRISMALENS_WEBHOOK_SECRET).toBeUndefined();
		await launcher.destroy();
	});

	it("destroy() kills children still running inside the boundary", async () => {
		const launcher = createProcessLauncher();
		const child = launcher.spawn(
			process.execPath,
			["-e", "setInterval(() => {}, 1000)"],
			{ cwd: process.cwd() },
		);
		const closed = once(child, "close");
		await launcher.destroy();
		await closed;
		expect(child.killed).toBe(true);
	});
});

describe("createProcessLauncher — resource limits (ADR-0020)", () => {
	it("wallClockMs SIGKILLs a sleeping child and marks it timedOut", async () => {
		const launcher = createProcessLauncher();
		// A child that would otherwise never exit — only the deadline can end it.
		const child = launcher.spawn(
			process.execPath,
			["-e", "setInterval(() => {}, 1000)"],
			{ cwd: process.cwd(), limits: { wallClockMs: 50 } },
		);
		const [, signal] = (await once(child, "close")) as [
			number | null,
			NodeJS.Signals | null,
		];
		expect(child.timedOut).toBe(true); // the distinguishable timeout marker
		expect(signal).toBe("SIGKILL");
		await launcher.destroy();
	});

	it("no limits: the child runs to completion, no deadline armed", async () => {
		const launcher = createProcessLauncher();
		const child = launcher.spawn(process.execPath, ["-e", "process.exit(0)"], {
			cwd: process.cwd(),
		});
		const [code] = (await once(child, "close")) as [number | null, unknown];
		expect(child.timedOut).toBe(false);
		expect(code).toBe(0);
		await launcher.destroy();
	});
});
