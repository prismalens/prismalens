// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { execFileSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { adminKey, git } from "./git.js";

describe("git() fsmonitor override (#1066)", () => {
	let dir: string;
	let markerFile: string;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "ah-git-test-"));
		execFileSync("git", ["init", "-q"], { cwd: dir });
		markerFile = join(dir, "marker.txt");
		const hookFile = join(dir, "hook.js");
		writeFileSync(
			hookFile,
			`const fs = typeof require === "function" ? require("node:fs") : (await import("node:fs")).default;\nfs.writeFileSync(${JSON.stringify(markerFile)}, "triggered");\n`,
		);
		const hookCmd = `node "${hookFile.replace(/\\/g, "/")}"`;
		execFileSync("git", ["config", "core.fsmonitor", hookCmd], { cwd: dir });
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
	});

	it("ignores core.fsmonitor configured in worktree and never invokes it", async () => {
		await git(["status", "--porcelain"], {
			cwd: dir,
			env: process.env as Record<string, string>,
		});
		expect(existsSync(markerFile)).toBe(false);
	});
});

describe("adminKey (#1157)", () => {
	let root: string;

	beforeEach(() => {
		root = realpathSync(mkdtempSync(join(tmpdir(), "ah-adminkey-")));
	});

	afterEach(() => {
		rmSync(root, { recursive: true, force: true, maxRetries: 3 });
	});

	it("keys a separate-git-dir repo and its linked worktree on the one git dir", () => {
		const gitDir = join(root, "store.git");
		const repo = join(root, "repo");
		mkdirSync(repo);
		execFileSync("git", ["init", "-q", "-b", "main", `--separate-git-dir=${gitDir}`], { cwd: repo });
		execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", "commit", "-q", "--allow-empty", "-m", "one"], { cwd: repo });
		const linked = join(root, "linked");
		execFileSync("git", ["worktree", "add", "-q", "--detach", linked], { cwd: repo });
		expect(existsSync(join(repo, ".git"))).toBe(true);
		expect(adminKey(repo)).toBe(realpathSync(gitDir));
		expect(adminKey(linked)).toBe(adminKey(repo));
	});
});
