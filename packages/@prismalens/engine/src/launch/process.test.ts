// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Hermetic tests for the process launcher: the child gets exactly the env it is
 * handed (the launch plan's, #916), a deadline kills its tree, and destroy() and
 * the exit reaper end live children. No network/LLM.
 */
import { once } from "node:events";
import { describe, expect, it, vi } from "vitest";
import {
	createProcessLauncher,
	reapLiveHarnesses,
	wrapWithTreeKill,
} from "./process.js";

const HOST = Object.fromEntries(
	Object.entries(process.env).filter(
		(e): e is [string, string] => e[1] !== undefined,
	),
);

describe("createProcessLauncher", () => {
	it("spawns a duplex-stdio child with exactly the env it is handed", async () => {
		const launcher = createProcessLauncher();
		const env = { ...HOST, OPENAI_API_KEY: "byo-key" };
		delete env.HOME;
		const child = launcher.spawn(
			process.execPath,
			["-e", "process.stdout.write(JSON.stringify(process.env))"],
			{ cwd: process.cwd(), env },
		);
		const chunks: Buffer[] = [];
		child.stdout.on("data", (d: Buffer) => chunks.push(d));
		await once(child, "close");
		const childEnv = JSON.parse(Buffer.concat(chunks).toString()) as Record<
			string,
			string
		>;
		expect(childEnv.OPENAI_API_KEY).toBe("byo-key");
		expect(childEnv.HOME).toBeUndefined();
		await launcher.destroy();
	});

	it("destroy() kills children still running inside the boundary", async () => {
		const launcher = createProcessLauncher();
		const child = launcher.spawn(
			process.execPath,
			["-e", "setInterval(() => {}, 1000)"],
			{ cwd: process.cwd(), env: HOST },
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
			{ cwd: process.cwd(), env: HOST, limits: { wallClockMs: 50 } },
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
			env: HOST,
		});
		const [code] = (await once(child, "close")) as [number | null, unknown];
		expect(child.timedOut).toBe(false);
		expect(code).toBe(0);
		await launcher.destroy();
	});
});

describe("wrapWithTreeKill", () => {
	it("falls back to the child's own kill when there is no pid, and marks it killed", () => {
		const kill = vi.fn(() => true);
		const child = { pid: undefined, kill, killed: false };
		wrapWithTreeKill(child, "linux").kill("SIGTERM");
		expect(kill).toHaveBeenCalledWith("SIGTERM");
		expect(child.killed).toBe(true);
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
				{ cwd: process.cwd(), env: HOST, limits: { wallClockMs: 500 } },
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
				{ cwd: process.cwd(), env: HOST },
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
				{ cwd: process.cwd(), env: HOST },
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

		it("reapLiveHarnesses() still kills a harness that ignored an earlier SIGTERM", async () => {
			const child = createProcessLauncher().spawn(
				process.execPath,
				[
					"-e",
					'process.on("SIGTERM", () => {}); process.stdout.write(String(process.pid) + "\\n"); setInterval(()=>{}, 1e3);',
				],
				{ cwd: process.cwd(), env: HOST },
			);
			// The harness names its own pid, as the tree tests above do: HarnessChild has no pid.
			const [chunk] = (await once(child.stdout, "data")) as [Buffer];
			const pid = Number.parseInt(chunk.toString().trim(), 10);
			expect(pid).toBeGreaterThan(0);
			try {
				child.kill("SIGTERM");
				expect(child.killed).toBe(true);
				await new Promise((r) => setTimeout(r, 200));
				expect(() => process.kill(pid, 0)).not.toThrow(); // survived SIGTERM
				const closed = once(child, "close");
				reapLiveHarnesses();
				await closed;
				await pollForEsrch(pid, 2000);
			} finally {
				try {
					process.kill(pid, "SIGKILL");
				} catch {
					// ESRCH if already dead
				}
			}
		});
	},
);
