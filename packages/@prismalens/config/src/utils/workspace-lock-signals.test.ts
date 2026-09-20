// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Signal handling for the workspace lock (#605 edge 5), in real child
 * processes.
 *
 * These cannot be unit tests. The defect they guard against is that Node does
 * not run `exit` listeners for a signal-terminated process, which is only
 * observable by actually signalling one — an in-process test would pass while
 * every Ctrl-C leaked a lock file, which is exactly what happened.
 */

import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { WORKSPACE_LOCK_FILE } from "./workspace-lock.js";

const here = dirname(fileURLToPath(import.meta.url));
const HOLDER = join(here, "__fixtures__", "lock-holder.mjs");
const PACKAGE_ROOT = resolve(here, "..", "..");
/**
 * The holder imports the **built** module, the way a real consumer does. Node
 * cannot strip this package's TypeScript (it has runtime enums), and the built
 * artifact is the thing that actually ships, so it is the better subject.
 */
const ENTRY = join(PACKAGE_ROOT, "dist", "utils", "workspace-lock.js");

const isWindows = process.platform === "win32";

/**
 * `turbo test` depends on `^build`, which builds this package's dependencies
 * but not this package, so `dist` may be absent on a cold checkout. Building it
 * here keeps the suite self-contained instead of silently skipping.
 */
beforeAll(() => {
	if (existsSync(ENTRY)) return;
	execFileSync("pnpm", ["run", "build"], {
		cwd: PACKAGE_ROOT,
		stdio: "inherit",
	});
}, 180_000);

interface Holder {
	pid: number;
	lockPath: string;
	workspace: string;
	stop: (signal: NodeJS.Signals) => void;
	exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
}

async function startHolder(flags: string[] = []): Promise<Holder> {
	const workspace = mkdtempSync(join(tmpdir(), "pl-lock-sig-"));
	const child = spawn(process.execPath, [HOLDER, ENTRY, workspace, ...flags], {
		stdio: ["ignore", "pipe", "pipe"],
	});
	const exited = new Promise<{
		code: number | null;
		signal: NodeJS.Signals | null;
	}>((res) => {
		child.on("exit", (code, signal) => res({ code, signal }));
	});
	let stderr = "";
	child.stderr.on("data", (c) => {
		stderr += String(c);
	});
	await new Promise<void>((res, rej) => {
		const timer = setTimeout(
			() => rej(new Error(`holder never signalled ready: ${stderr}`)),
			20_000,
		);
		child.stdout.on("data", (c) => {
			if (String(c).startsWith("ready")) {
				clearTimeout(timer);
				res();
			}
		});
		child.on("exit", () => {
			clearTimeout(timer);
			rej(new Error(`holder exited early: ${stderr}`));
		});
	});
	return {
		pid: child.pid as number,
		workspace,
		lockPath: join(workspace, WORKSPACE_LOCK_FILE),
		stop: (signal) => child.kill(signal),
		exited,
	};
}

describe("releasing the workspace lock on an ordinary stop", () => {
	/**
	 * `SIGTERM` is not deliverable on Windows — Node accepts a listener for it
	 * but the OS never raises it — so this case is Linux and macOS only. The
	 * `SIGINT` case below covers Windows.
	 */
	it.skipIf(isWindows)(
		"SIGTERM releases the lock and exits 143",
		async () => {
			const holder = await startHolder();
			expect(existsSync(holder.lockPath)).toBe(true);

			holder.stop("SIGTERM");
			const { code, signal } = await holder.exited;

			expect(existsSync(holder.lockPath)).toBe(false);
			// Re-raised with no listener, so the process dies *of* the signal.
			// Node reports that as signal="SIGTERM"; a shell would see 143.
			expect(signal ?? (code as number)).toBe(signal ? "SIGTERM" : 143);
		},
		30_000,
	);

	it(
		"SIGINT releases the lock",
		async () => {
			const holder = await startHolder();
			expect(existsSync(holder.lockPath)).toBe(true);

			holder.stop("SIGINT");
			await holder.exited;

			expect(existsSync(holder.lockPath)).toBe(false);
		},
		30_000,
	);

	it(
		"a second signal forces an exit when the shutdown hangs",
		async () => {
			const holder = await startHolder(["--hang"]);
			holder.stop("SIGTERM");
			// The first is swallowed by the hung shutdown; the second must not be.
			await new Promise((r) => setTimeout(r, 300));
			expect(existsSync(holder.lockPath)).toBe(true);

			holder.stop("SIGTERM");
			const { code, signal } = await holder.exited;

			// 128 + SIGTERM(15). The lock is deliberately NOT released here: a
			// forced exit is an abandonment, and the next boot reclaims it stale.
			expect(code ?? signal).toBe(isWindows ? code : 143);
		},
		30_000,
	);
});

describe("a lock owned by someone else", () => {
	it("is left alone when this process releases", async () => {
		const holder = await startHolder();
		// Between our shutdown starting and the release running, the file is
		// replaced by another process's lock. Ours must not delete it.
		const foreign = JSON.stringify({
			pid: process.pid,
			port: 3001,
			startedAt: new Date().toISOString(),
		});
		writeFileSync(holder.lockPath, foreign);

		holder.stop("SIGINT");
		await holder.exited;

		expect(existsSync(holder.lockPath)).toBe(true);
		expect(readFileSync(holder.lockPath, "utf8")).toBe(foreign);
	}, 30_000);
});
