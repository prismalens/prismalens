// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Hermetic tests for the process launcher: the child env must be built from the
 * allowlist (never process.env verbatim), the caller's env must win, and
 * destroy() must reap live children. No network/LLM.
 */
import { once } from "node:events";
import { createRequire } from "node:module";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ resolveOnPath: vi.fn(() => null as string | null) }));
vi.mock("@prismalens/config/harness-selection", () => ({
	resolveOnPath: mocks.resolveOnPath,
}));

const {
	buildChildEnv,
	createProcessLauncher,
	escapeArgument,
	escapeCommand,
	killProcessTree,
	reapLiveHarnesses,
	windowsSpawnPlan,
	wrapWithTreeKill,
} = await import("./process.js");

const SECRET = "PRISMALENS_FLOOR_TEST_SECRET";

afterEach(() => {
	delete process.env[SECRET];
	vi.unstubAllEnvs();
	mocks.resolveOnPath.mockReset();
	mocks.resolveOnPath.mockReturnValue(null);
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

describe("windowsSpawnPlan (#634 — npm .cmd/.bat shims can't execve on Windows)", () => {
	it("re-plans a .cmd command through cmd.exe with verbatim args", () => {
		const plan = windowsSpawnPlan("opencode.cmd", ["acp", "--pure"], "win32");
		expect(plan).toEqual({
			command: process.env.ComSpec ?? "cmd.exe",
			args: ["/d", "/s", "/c", '"opencode.cmd ^^^"acp^^^" ^^^"--pure^^^""'],
			options: { windowsVerbatimArguments: true },
		});
	});

	it("re-plans a .bat command the same way, case-insensitively", () => {
		const plan = windowsSpawnPlan("Foo.BAT", [], "win32");
		expect(plan.command).toBe(process.env.ComSpec ?? "cmd.exe");
		expect(plan.args).toEqual(["/d", "/s", "/c", '"Foo.BAT"']);
	});

	it("re-plans when the bare command isn't a shim but its resolved PATH copy is", () => {
		mocks.resolveOnPath.mockReturnValue("C:\\npm\\opencode.cmd");
		const plan = windowsSpawnPlan("opencode", ["acp"], "win32");
		expect(plan.command).toBe(process.env.ComSpec ?? "cmd.exe");
		expect(plan.args).toEqual(["/d", "/s", "/c", '"opencode ^^^"acp^^^""']);
		expect(mocks.resolveOnPath).toHaveBeenCalledWith("opencode");
	});

	it("quotes and ^-escapes a token with a space and a cmd metacharacter", () => {
		const plan = windowsSpawnPlan(
			"foo.cmd",
			["C:\\Program Files\\a & b.txt"],
			"win32",
		);
		expect(plan.args).toEqual([
			"/d",
			"/s",
			"/c",
			'"foo.cmd ^^^"C:\\Program^^^ Files\\a^^^ ^^^&^^^ b.txt^^^""',
		]);
	});

	it("is identity on linux, even for a .cmd-looking command", () => {
		const plan = windowsSpawnPlan("opencode.cmd", ["acp"], "linux");
		expect(plan).toEqual({ command: "opencode.cmd", args: ["acp"], options: {} });
	});

	it("is identity on win32 for a non-shim command not resolved to one either", () => {
		const plan = windowsSpawnPlan("opencode.exe", ["acp"], "win32");
		expect(plan).toEqual({ command: "opencode.exe", args: ["acp"], options: {} });
	});
});

describe("windowsSpawnPlan cross-spawn quoting compliance", () => {
	const crossSpawnRequire = createRequire(import.meta.url);
	const crossSpawnEscape = crossSpawnRequire("cross-spawn/lib/util/escape.js") as {
		command: (cmd: string) => string;
		argument: (arg: string, doubleEscape: boolean) => string;
	};

	const testCases = [
		"a&b",
		"C:\\dir with space\\",
		'he said "x"',
		"%PATH%",
		"a|b^c",
	];

	for (const input of testCases) {
		it(`matches cross-spawn escaping for '${input}'`, () => {
			const plan = windowsSpawnPlan("test.cmd", [input], "win32");
			const expectedLine = `test.cmd ${crossSpawnEscape.argument(input, true)}`;
			expect(plan.args).toEqual(["/d", "/s", "/c", `"${expectedLine}"`]);
		});
	}

	it("matches cross-spawn escaping when all test cases are combined in one command", () => {
		const plan = windowsSpawnPlan("test.cmd", testCases, "win32");
		const expectedLine = [
			crossSpawnEscape.command("test.cmd"),
			...testCases.map((arg) => crossSpawnEscape.argument(arg, true)),
		].join(" ");
		expect(plan.args).toEqual(["/d", "/s", "/c", `"${expectedLine}"`]);
	});
});

describe("escapeCommand and escapeArgument (cross-spawn port)", () => {
	it("leaves a plain command untouched", () => {
		expect(escapeCommand("opencode")).toBe("opencode");
	});

	it("escapes cmd metacharacters in a command", () => {
		expect(escapeCommand("foo & bar.cmd")).toBe("foo^ ^&^ bar.cmd");
	});

	it("wraps an argument in quotes and escapes metacharacters with double escape for shims", () => {
		expect(escapeArgument("hello world", true)).toBe('^^^"hello^^^ world^^^"');
	});

	it("backslash-escapes an embedded quote and doubles backslashes before quote", () => {
		expect(escapeArgument('say "hi"', true)).toBe('^^^"say^^^ \\^^^"hi\\^^^"^^^"');
	});
});

describe("killProcessTree (win32 taskkill /T /F tree kill)", () => {
	it("executes taskkill with /pid, String(pid), /T, /F on win32", () => {
		const fakeKill = vi.fn(() => true);
		const fakeSpawnSync = vi.fn(() => ({
			status: 0,
			error: undefined,
		})) as unknown as typeof import("node:child_process").spawnSync;
		const child = { pid: 4321, kill: fakeKill, killed: false };

		const result = killProcessTree(child, "SIGKILL", "win32", fakeSpawnSync);

		expect(result).toBe(true);
		expect(fakeSpawnSync).toHaveBeenCalledWith("taskkill", [
			"/pid",
			"4321",
			"/T",
			"/F",
		]);
		expect(fakeKill).not.toHaveBeenCalled();
		expect(child.killed).toBe(true);
	});

	it("falls back to child.kill() on win32 if taskkill exits with non-zero status", () => {
		const fakeKill = vi.fn(() => true);
		const fakeSpawnSync = vi.fn(() => ({
			status: 128,
			error: undefined,
		})) as unknown as typeof import("node:child_process").spawnSync;
		const child = { pid: 4321, kill: fakeKill, killed: false };

		const result = killProcessTree(child, "SIGKILL", "win32", fakeSpawnSync);

		expect(result).toBe(true);
		expect(fakeSpawnSync).toHaveBeenCalledWith("taskkill", [
			"/pid",
			"4321",
			"/T",
			"/F",
		]);
		expect(fakeKill).toHaveBeenCalledWith("SIGKILL");
	});

	it("falls back to child.kill() on win32 if taskkill returns an error", () => {
		const fakeKill = vi.fn(() => true);
		const fakeSpawnSync = vi.fn(() => ({
			status: null,
			error: new Error("taskkill not found"),
		})) as unknown as typeof import("node:child_process").spawnSync;
		const child = { pid: 4321, kill: fakeKill, killed: false };

		const result = killProcessTree(child, "SIGKILL", "win32", fakeSpawnSync);

		expect(result).toBe(true);
		expect(fakeKill).toHaveBeenCalledWith("SIGKILL");
	});

	it("falls back to child.kill() on win32 if taskkill throws an exception", () => {
		const fakeKill = vi.fn(() => true);
		const fakeSpawnSync = vi.fn(() => {
			throw new Error("spawnSync failure");
		}) as unknown as typeof import("node:child_process").spawnSync;
		const child = { pid: 4321, kill: fakeKill, killed: false };

		const result = killProcessTree(child, "SIGKILL", "win32", fakeSpawnSync);

		expect(result).toBe(true);
		expect(fakeKill).toHaveBeenCalledWith("SIGKILL");
	});

	it("falls back to child.kill() on win32 if child pid is undefined", () => {
		const fakeKill = vi.fn(() => true);
		const fakeSpawnSync = vi.fn() as unknown as typeof import("node:child_process").spawnSync;
		const child = { pid: undefined, kill: fakeKill, killed: false };

		const result = killProcessTree(child, "SIGKILL", "win32", fakeSpawnSync);

		expect(result).toBe(true);
		expect(fakeSpawnSync).not.toHaveBeenCalled();
		expect(fakeKill).toHaveBeenCalledWith("SIGKILL");
	});

	it("calls injected process.kill(-pid, 'SIGKILL') on linux", () => {
		const fakeKill = vi.fn(() => true);
		const fakeKillProcess = vi.fn(() => true) as unknown as typeof process.kill;
		const fakeSpawnSync = vi.fn() as unknown as typeof import("node:child_process").spawnSync;
		const child = { pid: 4321, kill: fakeKill, killed: false };

		const result = killProcessTree(
			child,
			"SIGKILL",
			"linux",
			fakeSpawnSync,
			fakeKillProcess,
		);

		expect(result).toBe(true);
		expect(fakeSpawnSync).not.toHaveBeenCalled();
		expect(fakeKillProcess).toHaveBeenCalledWith(-4321, "SIGKILL");
		expect(fakeKill).not.toHaveBeenCalled();
		expect(child.killed).toBe(true);
	});

	it("defaults signal to SIGTERM on linux if unspecified", () => {
		const fakeKill = vi.fn(() => true);
		const fakeKillProcess = vi.fn(() => true) as unknown as typeof process.kill;
		const child = { pid: 4321, kill: fakeKill, killed: false };

		const result = killProcessTree(
			child,
			undefined,
			"linux",
			undefined,
			fakeKillProcess,
		);

		expect(result).toBe(true);
		expect(fakeKillProcess).toHaveBeenCalledWith(-4321, "SIGTERM");
		expect(fakeKill).not.toHaveBeenCalled();
		expect(child.killed).toBe(true);
	});

	it("falls back to child.kill() on ESRCH", () => {
		const fakeKill = vi.fn(() => true);
		const fakeKillProcess = vi.fn(() => {
			const err = new Error("kill ESRCH");
			(err as NodeJS.ErrnoException).code = "ESRCH";
			throw err;
		}) as unknown as typeof process.kill;
		const child = { pid: 4321, kill: fakeKill, killed: false };

		const result = killProcessTree(
			child,
			"SIGKILL",
			"linux",
			undefined,
			fakeKillProcess,
		);

		expect(result).toBe(true);
		expect(fakeKillProcess).toHaveBeenCalledWith(-4321, "SIGKILL");
		expect(fakeKill).toHaveBeenCalledWith("SIGKILL");
	});

	it("falls back to child.kill() on EPERM", () => {
		const fakeKill = vi.fn(() => true);
		const fakeKillProcess = vi.fn(() => {
			const err = new Error("kill EPERM");
			(err as NodeJS.ErrnoException).code = "EPERM";
			throw err;
		}) as unknown as typeof process.kill;
		const child = { pid: 4321, kill: fakeKill, killed: false };

		const result = killProcessTree(
			child,
			"SIGKILL",
			"linux",
			undefined,
			fakeKillProcess,
		);

		expect(result).toBe(true);
		expect(fakeKillProcess).toHaveBeenCalledWith(-4321, "SIGKILL");
		expect(fakeKill).toHaveBeenCalledWith("SIGKILL");
	});

	it("falls back to child.kill() on linux if child pid is undefined", () => {
		const fakeKill = vi.fn(() => true);
		const fakeKillProcess = vi.fn(() => true) as unknown as typeof process.kill;
		const child = { pid: undefined, kill: fakeKill, killed: false };

		const result = killProcessTree(
			child,
			"SIGKILL",
			"linux",
			undefined,
			fakeKillProcess,
		);

		expect(result).toBe(true);
		expect(fakeKillProcess).not.toHaveBeenCalled();
		expect(fakeKill).toHaveBeenCalledWith("SIGKILL");
	});

	it("wrapWithTreeKill delegates child.kill() through treeKill", () => {
		const fakeKill = vi.fn(() => true);
		const fakeKillProcess = vi.fn(() => true) as unknown as typeof process.kill;
		const child = { pid: 9999, kill: fakeKill, killed: false };
		const wrapped = wrapWithTreeKill(
			child,
			"linux",
			undefined,
			fakeKillProcess,
		);

		wrapped.kill("SIGTERM");
		expect(fakeKillProcess).toHaveBeenCalledWith(-9999, "SIGTERM");
	});
});

describe.skipIf(process.platform === "win32")(
	"process group tree kill (POSIX regression)",
	() => {
		async function pollForEsrch(pid: number, timeoutMs = 2000): Promise<void> {
			const start = Date.now();
			while (Date.now() - start < timeoutMs) {
				try {
					process.kill(pid, 0);
				} catch (err) {
					if ((err as NodeJS.ErrnoException).code === "ESRCH") {
						return;
					}
				}
				await new Promise((r) => setTimeout(r, 50));
			}
			expect(() => process.kill(pid, 0)).toThrow(
				expect.objectContaining({ code: "ESRCH" }),
			);
		}

		it("wallClockMs kills the harness and its descendant process tree", async () => {
			const launcher = createProcessLauncher();
			const child = launcher.spawn(
				process.execPath,
				[
					"-e",
					'const { spawn } = require("node:child_process"); const sub = spawn(process.execPath, ["-e", "setInterval(()=>{},1e3)"], { stdio: "ignore" }); process.stdout.write(String(sub.pid) + "\\n"); setInterval(()=>{}, 1e3);',
				],
				{ cwd: process.cwd(), limits: { wallClockMs: 500 } },
			);

			const [chunk] = (await once(child.stdout, "data")) as [Buffer];
			const grandchildPid = Number.parseInt(chunk.toString().trim(), 10);
			expect(grandchildPid).toBeGreaterThan(0);

			try {
				await once(child, "close");
				expect(child.timedOut).toBe(true);
				await pollForEsrch(grandchildPid, 2000);
			} finally {
				try {
					process.kill(grandchildPid, "SIGKILL");
				} catch {
					// ESRCH if already dead
				}
				await launcher.destroy();
			}
		});

		it("destroy() kills the harness and its descendant process tree without a deadline", async () => {
			const launcher = createProcessLauncher();
			const child = launcher.spawn(
				process.execPath,
				[
					"-e",
					'const { spawn } = require("node:child_process"); const sub = spawn(process.execPath, ["-e", "setInterval(()=>{},1e3)"], { stdio: "ignore" }); process.stdout.write(String(sub.pid) + "\\n"); setInterval(()=>{}, 1e3);',
				],
				{ cwd: process.cwd() },
			);

			const [chunk] = (await once(child.stdout, "data")) as [Buffer];
			const grandchildPid = Number.parseInt(chunk.toString().trim(), 10);
			expect(grandchildPid).toBeGreaterThan(0);

			const closed = once(child, "close");
			try {
				await launcher.destroy();
				await closed;
				expect(child.killed).toBe(true);
				await pollForEsrch(grandchildPid, 2000);
			} finally {
				try {
					process.kill(grandchildPid, "SIGKILL");
				} catch {
					// ESRCH if already dead
				}
			}
		});

		it("reapLiveHarnesses() kills every launcher's harness tree on the way out", async () => {
			const child = createProcessLauncher().spawn(
				process.execPath,
				[
					"-e",
					'const { spawn } = require("node:child_process"); const sub = spawn(process.execPath, ["-e", "setInterval(()=>{},1e3)"], { stdio: "ignore" }); process.stdout.write(String(sub.pid) + "\\n"); setInterval(()=>{}, 1e3);',
				],
				{ cwd: process.cwd() },
			);

			const [chunk] = (await once(child.stdout, "data")) as [Buffer];
			const grandchildPid = Number.parseInt(chunk.toString().trim(), 10);
			expect(grandchildPid).toBeGreaterThan(0);

			const closed = once(child, "close");
			try {
				reapLiveHarnesses();
				await closed;
				await pollForEsrch(grandchildPid, 2000);
			} finally {
				try {
					process.kill(grandchildPid, "SIGKILL");
				} catch {
					// ESRCH if already dead
				}
			}
		});
	},
);
