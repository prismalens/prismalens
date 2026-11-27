// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { withCodexAppServer } from "./codex-app-server.js";

const FAKE = join(dirname(fileURLToPath(import.meta.url)), "__fixtures__", "fake-codex-app-server.mjs");
const dirs: string[] = [];
afterEach(() => {
	for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const alive = (pid: number) => {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
};

describe("withCodexAppServer (#1180)", () => {
	it("leaves none of its timers pending once an app-server that exits at once is gone", async () => {
		const dir = mkdtempSync(join(tmpdir(), "pl-codex-quick-"));
		dirs.push(dir);
		const made: NodeJS.Timeout[] = [];
		const real = globalThis.setTimeout;
		const spy = vi.spyOn(globalThis, "setTimeout").mockImplementation(((fn: () => void, ms?: number) => {
			const t = real(fn, ms);
			made.push(t);
			return t;
		}) as typeof setTimeout);
		let out: boolean | null;
		try {
			out = await withCodexAppServer(
				{ command: process.execPath, args: [FAKE], cwd: dir, env: { PATH: process.env.PATH ?? "" } },
				[],
				5_000,
				async (call) => (await call("account/read", {})) !== undefined,
			);
		} finally {
			spy.mockRestore();
		}
		const pending = made.filter((t) => !(t as unknown as { _destroyed: boolean })._destroyed);
		expect([out, pending.length]).toEqual([true, 0]);
	});

	// Windows ends the tree with taskkill /F at once, so no SIGTERM is there to outlive.
	it.skipIf(process.platform === "win32")(
		"kills an app-server that outlives SIGTERM once the grace passes (skipped on Windows: taskkill /F kills at once)",
		async () => {
			const dir = mkdtempSync(join(tmpdir(), "pl-codex-term-"));
			dirs.push(dir);
			const pidFile = join(dir, "pid");
			const out = await withCodexAppServer(
				{
					command: process.execPath,
					args: [FAKE],
					cwd: dir,
					env: { PATH: process.env.PATH ?? "", FAKE_CODEX_IGNORE_TERM: "1", FAKE_CODEX_HOLD: "x/held", FAKE_CODEX_PID: pidFile },
				},
				[],
				200,
				(call) => call("x/held", {}),
			);
			expect([out, alive(Number(readFileSync(pidFile, "utf8")))]).toEqual([null, false]);
		},
		10_000,
	);
});
