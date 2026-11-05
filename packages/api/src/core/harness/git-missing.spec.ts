// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GitMissingError, spawnGit } from "./git-spawn.js";
import { RepoSourceService, remoteFailure } from "./repo-source.service.js";

let dir: string;
let path: string | undefined;
beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "pl-nogit-"));
	path = process.env.PATH;
});
afterEach(() => {
	process.env.PATH = path;
	rmSync(dir, { recursive: true, force: true });
});

describe("no git on the PATH (#1024)", () => {
	it("says git isn't installed instead of spawn git ENOENT", async () => {
		await expect(
			spawnGit(["--version"], { cwd: dir, env: { PATH: join(dir, "empty") }, timeoutMs: 5_000 }),
		).rejects.toBeInstanceOf(GitMissingError);
	});

	it("still reports a missing folder as a missing folder", async () => {
		await expect(
			spawnGit(["--version"], { cwd: join(dir, "gone"), env: process.env as Record<string, string>, timeoutMs: 5_000 }),
		).rejects.not.toBeInstanceOf(GitMissingError);
	});

	it("adding a git URL keeps the same words, not a remote diagnosis", () => {
		const err = new GitMissingError();
		expect(remoteFailure(err, { kind: "url", source: "https://github.com/a/b.git" } as never)).toBe(err);
	});

	it("adding a folder says so with a doctor hint", async () => {
		process.env.PATH = join(dir, "empty");
		await expect(new RepoSourceService().checkFolder(dir)).rejects.toThrow(
			/Git isn't installed.*pl doctor/,
		);
	});
});
