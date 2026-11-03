// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { execFileSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const who = vi.hoisted(() => ({ name: "Ada", email: "ada@example.com" }));
vi.mock("../../core/harness/git-spawn.js", async (orig) => {
	const real =
		await orig<typeof import("../../core/harness/git-spawn.js")>();
	return {
		...real,
		gitConfigRead: async (args: string[]) => {
			const key = args.at(-1);
			const value = key === "user.name" ? who.name : who.email;
			if (!value) throw new Error("unset");
			return { stdout: `${value}\n`, stderr: "" };
		},
	};
});

const { startGit, StartGitRefused } = await import("./start-git.js");

let folder: string;
beforeEach(() => {
	folder = mkdtempSync(join(tmpdir(), "pl-startgit-"));
	who.name = "Ada";
	who.email = "ada@example.com";
});
afterEach(() => rmSync(folder, { recursive: true, force: true }));

const git = (...args: string[]) =>
	execFileSync("git", args, { cwd: folder, encoding: "utf8" }).trim();

describe("Start git here (#1020)", () => {
	it("commits only what git does not ignore, as the user", async () => {
		writeFileSync(join(folder, ".gitignore"), "secrets/\n*.log\n");
		writeFileSync(join(folder, "app.js"), "1");
		writeFileSync(join(folder, "debug.log"), "x");
		mkdirSync(join(folder, "secrets"));
		writeFileSync(join(folder, "secrets", "key"), "k");
		await startGit(folder);
		expect(git("ls-files").split("\n").sort()).toEqual([".gitignore", "app.js"]);
		expect(git("log", "-1", "--format=%an <%ae>|%s")).toBe(
			"Ada <ada@example.com>|Initial commit",
		);
	});

	it("refuses with no identity and leaves no .git", async () => {
		who.email = "";
		writeFileSync(join(folder, "a"), "1");
		await expect(startGit(folder)).rejects.toThrow(/user\.name and user\.email/);
		expect(existsSync(join(folder, ".git"))).toBe(false);
	});

	it("refuses over the file cap and removes the .git it made", async () => {
		for (const n of ["a", "b", "c"]) writeFileSync(join(folder, n), n);
		await expect(startGit(folder, { maxFiles: 2 })).rejects.toBeInstanceOf(
			StartGitRefused,
		);
		expect(existsSync(join(folder, ".git"))).toBe(false);
	});

	it("refuses a folder that is gone, and says when git took too long", async () => {
		await expect(startGit(join(folder, "gone"))).rejects.toThrow(/gone or is a link/);
		writeFileSync(join(folder, "a"), "1");
		await expect(startGit(folder, { timeoutMs: 1 })).rejects.toThrow(/took too long/);
		expect(existsSync(join(folder, ".git"))).toBe(false);
	});

	it("refuses a folder that already has git", async () => {
		mkdirSync(join(folder, ".git"));
		await expect(startGit(folder)).rejects.toThrow(/already has git/);
	});
});
