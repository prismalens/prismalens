// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GATEWAY_RUN_FILE } from "@prismalens/config/harness";
import { DEFAULT_RUN_WORKSPACE_SETTINGS } from "@prismalens/contracts";
import {
	addRunWorktree,
	bindRun,
	releaseWorktreesIn,
	runWorktreeDir,
	setRunWorkspaceSource,
	unbindRun,
} from "../../core/harness/run-worktree.js";
import { sweepRunWorkspaces } from "./investigation-run.js";

// A path that refuses deletion, as Windows does with EBUSY for a held file.
const stuck = vi.hoisted(() => ({ name: "" }));
vi.mock("node:fs", async (importOriginal) => {
	const fs = await importOriginal<typeof import("node:fs")>();
	return {
		...fs,
		rmSync: (path: Parameters<typeof fs.rmSync>[0], opts?: Parameters<typeof fs.rmSync>[1]) => {
			if (stuck.name && String(path).endsWith(stuck.name))
				throw Object.assign(new Error(`EBUSY: resource busy or locked, rmdir '${path}'`), { code: "EBUSY" });
			return fs.rmSync(path, opts);
		},
	};
});

describe("sweepRunWorkspaces (#743)", () => {
	let dir: string;
	const saved = process.env.PRISMALENS_WORKSPACE_DIR;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "pl-sweep-"));
		process.env.PRISMALENS_WORKSPACE_DIR = dir;
	});
	afterEach(() => {
		process.env.PRISMALENS_WORKSPACE_DIR = saved;
		rmSync(dir, { recursive: true, force: true });
	});

	it("removes the clone and harness home a crashed run left, and keeps its transcript", async () => {
		const crashed = join(dir, "runs", "run-a");
		mkdirSync(join(crashed, "repo", "src"), { recursive: true });
		mkdirSync(join(crashed, "home"), { recursive: true });
		writeFileSync(join(crashed, "transcript.jsonl"), "{}\n");
		const clean = join(dir, "runs", "run-b");
		mkdirSync(clean, { recursive: true });
		writeFileSync(join(clean, "transcript.jsonl"), "{}\n");

		expect(await sweepRunWorkspaces()).toBe(1);
		expect(existsSync(join(crashed, "repo"))).toBe(false);
		expect(existsSync(join(crashed, "home"))).toBe(false);
		expect(existsSync(join(crashed, "transcript.jsonl"))).toBe(true);
		expect(existsSync(join(clean, "transcript.jsonl"))).toBe(true);
	});

	it("sweeps the repos/ a crashed multi-repo run left (#747)", async () => {
		const crashed = join(dir, "runs", "run-c");
		mkdirSync(join(crashed, "repos", "api"), { recursive: true });

		expect(await sweepRunWorkspaces()).toBe(1);
		expect(existsSync(join(crashed, "repos"))).toBe(false);
	});

	it("sweeps the worktree dir a crashed run left, counting the run once (#918)", async () => {
		mkdirSync(join(dir, "runs", "run-d", "home"), { recursive: true });
		mkdirSync(join(dir, "worktrees", "pl-run-d", "api"), { recursive: true });
		mkdirSync(join(dir, "worktrees", "not-ours"), { recursive: true });

		expect(await sweepRunWorkspaces()).toBe(1);
		expect(existsSync(join(dir, "worktrees", "pl-run-d"))).toBe(false);
		expect(existsSync(join(dir, "worktrees", "not-ours"))).toBe(true);
	});

	it("removes the gateway run file holding a run's bearer, and keeps the rest of config (#848, OBJ-029)", async () => {
		const config = join(dir, "runs", "run-d", "config");
		mkdirSync(config, { recursive: true });
		writeFileSync(join(config, GATEWAY_RUN_FILE), "{}");
		writeFileSync(join(config, "other.json"), "{}");

		expect(await sweepRunWorkspaces()).toBe(1);
		expect(existsSync(join(config, GATEWAY_RUN_FILE))).toBe(false);
		expect(existsSync(join(config, "other.json"))).toBe(true);
	});

	it("a worktree entry that cannot be removed is logged and skipped; the other entries and runs/ are still swept (#918)", async () => {
		mkdirSync(join(dir, "worktrees", "pl-run-stuck"), { recursive: true });
		mkdirSync(join(dir, "worktrees", "pl-run-ok"), { recursive: true });
		const config = join(dir, "runs", "run-e", "config");
		mkdirSync(config, { recursive: true });
		writeFileSync(join(config, GATEWAY_RUN_FILE), "{}");
		stuck.name = "pl-run-stuck";
		try {
			expect(await sweepRunWorkspaces()).toBe(2);
		} finally {
			stuck.name = "";
		}
		expect(existsSync(join(dir, "worktrees", "pl-run-stuck"))).toBe(true);
		expect(existsSync(join(dir, "worktrees", "pl-run-ok"))).toBe(false);
		expect(existsSync(join(config, GATEWAY_RUN_FILE))).toBe(false);
	});

	it("leaves everything a run a restart interrupted left, until it is resumed (#981)", async () => {
		const cut = join(dir, "runs", "run-cut");
		mkdirSync(join(cut, "repo", "src"), { recursive: true });
		mkdirSync(join(cut, "home"), { recursive: true });
		mkdirSync(join(dir, "worktrees", "pl-run-cut", "api"), { recursive: true });
		mkdirSync(join(dir, "runs", "run-done", "home"), { recursive: true });

		expect(await sweepRunWorkspaces({ isInterrupted: (id) => id === "run-cut" })).toBe(1);
		expect(existsSync(join(cut, "repo", "src"))).toBe(true);
		expect(existsSync(join(cut, "home"))).toBe(true);
		expect(existsSync(join(dir, "worktrees", "pl-run-cut", "api"))).toBe(true);
		expect(existsSync(join(dir, "runs", "run-done", "home"))).toBe(false);
	});

	it("keeps a pending follow-up's expired keep-days workspace and run dir at boot", async () => {
		const settings = { ...DEFAULT_RUN_WORKSPACE_SETTINGS, retention: { kind: "keep-days", days: 2 } as const };
		setRunWorkspaceSource({
			global: () => settings,
			override: () => undefined,
			locations: () => [],
			serviceIdOf: async () => null,
			record: () => {},
		});
		try {
			const repo = join(dir, "repo");
			const git = (args: string[], cwd: string) => execFileSync("git", args, { cwd, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
			git(["init", "-q", "-b", "main", repo], dir);
			writeFileSync(join(repo, "a.txt"), "v1");
			git(["add", "a.txt"], repo);
			git(["-c", "user.email=t@t.local", "-c", "user.name=T", "commit", "-q", "-m", "init"], repo);
			const head = git(["rev-parse", "HEAD"], repo).toString().trim();
			await bindRun("run-next", { incidentId: "inc", serviceName: null });
			const dest = runWorktreeDir("run-next");
			await addRunWorktree(repo, dest, head, "run-next");
			await releaseWorktreesIn(dest);
			unbindRun("run-next");
			const side = JSON.parse(readFileSync(`${dest}.workspace.json`, "utf8"));
			const old = new Date(Date.now() - 3 * 86_400_000).toISOString();
			writeFileSync(`${dest}.workspace.json`, JSON.stringify({ ...side, keptAt: old }));
			mkdirSync(join(dir, "runs", "run-next", "home"), { recursive: true });

			expect(await sweepRunWorkspaces({ isLive: (id) => id === "run-next" })).toBe(0);
			expect(existsSync(join(dest, "a.txt"))).toBe(true);
			expect(existsSync(join(dir, "runs", "run-next", "home"))).toBe(true);
			// Once it is no longer pending, its own expiry applies.
			expect(await sweepRunWorkspaces()).toBe(1);
			expect(existsSync(dest)).toBe(false);
		} finally {
			setRunWorkspaceSource(null);
		}
	});

	it("does nothing before any run exists", async () => {
		expect(await sweepRunWorkspaces()).toBe(0);
	});
});
