// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/** The row's commit count (#1020): real git on mkdtemp repos, a clone cut from its source's main. */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RunWorkspace } from "@prismalens/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { workspaceCommits } from "./branch-commits.js";

vi.setConfig({ testTimeout: 20_000 });

const git = (cwd: string, ...args: string[]) =>
	execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
const commit = (cwd: string, file: string) => {
	writeFileSync(join(cwd, file), file);
	git(cwd, "add", file);
	git(cwd, "commit", "-q", "-m", file);
};

let root = "";
let source = "";
let clone = "";
let clock = 0;
const ws = (from: string | undefined, dir = clone): RunWorkspace => ({
	layout: "single",
	cwd: dir,
	repos: [
			{
				name: "repo",
				dir,
				sourceKind: "folder",
				url: source,
				subPath: null,
				connectionId: null,
				head: git(dir, "rev-parse", "HEAD"),
				branch: "fix",
				...(from ? { from } : {}),
				services: [],
			},
		],
});
// Each read is a fresh moment, so the few-second cache never answers for an earlier state.
const read = (w: RunWorkspace | null) => workspaceCommits(w, (clock += 60_000));

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "pl-commits-"));
	source = join(root, "source");
	clone = join(root, "clone");
	execFileSync("git", ["init", "-q", "-b", "main", source]);
	for (const d of [source]) {
		git(d, "config", "user.email", "t@example.com");
		git(d, "config", "user.name", "t");
	}
	commit(source, "a");
	execFileSync("git", ["clone", "-q", source, clone]);
	git(clone, "config", "user.email", "t@example.com");
	git(clone, "config", "user.name", "t");
	git(clone, "switch", "-q", "-c", "fix");
	commit(clone, "b");
	commit(clone, "c");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("workspaceCommits", () => {
	it("counts the branch's own commits since its base", async () => {
		expect(await read(ws("main"))).toBe(2);
	});

	it("keeps the count when the base moves on", async () => {
		commit(source, "d");
		git(clone, "fetch", "-q");
		expect(await read(ws("main"))).toBe(2);
	});

	it("keeps the count when the moved base is merged into the branch, reading the base's upstream over a stale local copy", async () => {
		commit(source, "d");
		git(clone, "fetch", "-q");
		git(clone, "merge", "-q", "--no-edit", "origin/main");
		expect(git(clone, "rev-list", "--count", "main..HEAD")).toBe("4");
		expect(await read(ws("main"))).toBe(2);
	});

	it("is null without a recorded base, a base git cannot resolve, or a workspace", async () => {
		expect(await read(ws(undefined))).toBeNull();
		expect(await read(ws("no-such-branch"))).toBeNull();
		expect(await read(null)).toBeNull();
	});
});
