// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { execFileSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	realpathSync,
	renameSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const who = vi.hoisted(() => ({
	name: "Ada",
	email: "ada@example.com",
	excludes: "",
}));
vi.mock("../../core/harness/git-spawn.js", async (orig) => {
	const real =
		await orig<typeof import("../../core/harness/git-spawn.js")>();
	return {
		...real,
		gitConfigRead: async (args: string[]) => {
			const key = args.at(-1);
			const value =
				key === "user.name"
					? who.name
					: key === "user.email"
						? who.email
						: key === "core.excludesFile"
							? who.excludes
							: "";
			if (!value) throw new Error("unset");
			return { stdout: `${value}\n`, stderr: "" };
		},
	};
});

const { startGit, StartGitRefused } = await import("./start-git.js");

let folder: string;
let home: string;
const globalConfig = (body: string) =>
	writeFileSync(join(home, ".gitconfig"), body);
beforeEach(() => {
	// The real path, as a project stores it: macOS tmpdir() goes through /var -> /private/var.
	folder = realpathSync.native(mkdtempSync(join(tmpdir(), "pl-startgit-")));
	who.name = "Ada";
	who.email = "ada@example.com";
	who.excludes = "";
	// No global config or ignore file from the machine running the tests; git reads HOME
	// first and USERPROFILE only without it, so the two differ here on purpose.
	home = realpathSync.native(mkdtempSync(join(tmpdir(), "pl-home-")));
	vi.stubEnv("HOME", home);
	vi.stubEnv("USERPROFILE", realpathSync.native(mkdtempSync(join(tmpdir(), "pl-profile-"))));
	vi.stubEnv("XDG_CONFIG_HOME", mkdtempSync(join(tmpdir(), "pl-xdg-")));
});
afterEach(() => {
	vi.unstubAllEnvs();
	rmSync(folder, { recursive: true, force: true });
});

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

	it("a lowercase git_dir or git_work_tree in the server's env never steers it elsewhere (#1020)", async () => {
		const outside = mkdtempSync(join(tmpdir(), "pl-outside-repo-"));
		execFileSync("git", ["init", "-q"], { cwd: outside });
		const before = execFileSync("git", ["rev-parse", "--git-path", "index"], { cwd: outside, encoding: "utf8" });
		const saved = { ...process.env };
		try {
			Object.assign(process.env, {
				git_dir: join(outside, ".git"),
				Git_Work_Tree: outside,
				git_index_file: join(outside, ".git", "index"),
			});
			writeFileSync(join(folder, "app.js"), "1");
			await startGit(folder);
		} finally {
			for (const k of ["git_dir", "Git_Work_Tree", "git_index_file"]) delete process.env[k];
			Object.assign(process.env, saved);
		}
		expect(existsSync(join(folder, ".git"))).toBe(true);
		expect(git("ls-files")).toBe("app.js");
		expect(existsSync(join(outside, ".git", "index"))).toBe(false);
		expect(() => execFileSync("git", ["rev-parse", "HEAD"], { cwd: outside, stdio: "pipe" })).toThrow();
		expect(before).toBeTruthy();
		rmSync(outside, { recursive: true, force: true });
	});

	it("keeps the user's own global ignore rules: a secret they ignore everywhere is not committed (#1020)", async () => {
		writeFileSync(join(home, "my-ignore"), "credentials.env\n");
		// `~` is git's: under HOME, which is not USERPROFILE here.
		globalConfig("[core]\n\texcludesFile = ~/my-ignore\n");
		writeFileSync(join(folder, "credentials.env"), "TOKEN=x");
		writeFileSync(join(folder, "app.js"), "1");
		await startGit(folder);
		expect(git("ls-files")).toBe("app.js");
	});

	it("refuses, and makes no .git, when the global ignore file set cannot be read", async () => {
		globalConfig("[core]\n\texcludesFile = ~/missing-ignore\n");
		writeFileSync(join(folder, "credentials.env"), "TOKEN=x");
		await expect(startGit(folder)).rejects.toThrow(/ignore file/);
		expect(existsSync(join(folder, ".git"))).toBe(false);
	});

	it("reads an ignore file set in a config the global one includes (#1020, CP3 r3 OBJ-007)", async () => {
		writeFileSync(join(home, "my-ignore"), "credentials.env\n");
		writeFileSync(join(home, "extra.gitconfig"), "[core]\n\texcludesFile = ~/my-ignore\n");
		globalConfig("[include]\n\tpath = ~/extra.gitconfig\n");
		writeFileSync(join(folder, "credentials.env"), "TOKEN=x");
		writeFileSync(join(folder, "app.js"), "1");
		await startGit(folder);
		expect(git("ls-files")).toBe("app.js");
	});

	it("refuses, and makes no .git, when the default ignore file is there but cannot be read (CP3 r3 OBJ-007)", async () => {
		const xdg = process.env.XDG_CONFIG_HOME as string;
		// A folder in the file's place exists and cannot be read as a file on every platform.
		mkdirSync(join(xdg, "git", "ignore"), { recursive: true });
		writeFileSync(join(folder, "credentials.env"), "TOKEN=x");
		await expect(startGit(folder)).rejects.toThrow(/ignore file/);
		expect(existsSync(join(folder, ".git"))).toBe(false);
	});

	it("the default global ignore file counts too when none is set", async () => {
		const xdg = process.env.XDG_CONFIG_HOME as string;
		mkdirSync(join(xdg, "git"), { recursive: true });
		writeFileSync(join(xdg, "git", "ignore"), "*.pem\n");
		writeFileSync(join(folder, "key.pem"), "k");
		writeFileSync(join(folder, "app.js"), "1");
		await startGit(folder);
		expect(git("ls-files")).toBe("app.js");
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

	it("a folder swapped for a link after init never has another repo's .git removed (#1020)", async () => {
		const other = mkdtempSync(join(tmpdir(), "pl-other-repo-"));
		execFileSync("git", ["init", "-q"], { cwd: other });
		for (const n of ["a", "b", "c"]) writeFileSync(join(folder, n), n);
		const moved = `${folder}-moved`;
		try {
			await expect(
				startGit(folder, {
					maxFiles: 2,
					afterInit: () => {
						renameSync(folder, moved);
						symlinkSync(other, folder, process.platform === "win32" ? "junction" : "dir");
					},
				}),
			).rejects.toBeInstanceOf(StartGitRefused);
			expect(existsSync(join(other, ".git", "HEAD"))).toBe(true);
		} finally {
			rmSync(folder, { recursive: true, force: true });
			renameSync(moved, folder);
			rmSync(other, { recursive: true, force: true });
		}
	});

	it("two starts on one folder: exactly one makes the repo, and nothing it made is removed", async () => {
		writeFileSync(join(folder, "app.js"), "1");
		const out = await Promise.allSettled([startGit(folder), startGit(folder)]);
		expect(out.filter((o) => o.status === "fulfilled")).toHaveLength(1);
		expect(git("ls-files")).toBe("app.js");
		expect(git("log", "-1", "--format=%s")).toBe("Initial commit");
	});

	it("refuses a folder reached through a linked parent (#1020)", async () => {
		const base = mkdtempSync(join(tmpdir(), "pl-startgit-alias-"));
		try {
			mkdirSync(join(base, "real", "notes"), { recursive: true });
			symlinkSync(join(base, "real"), join(base, "alias"), process.platform === "win32" ? "junction" : "dir");
			await expect(startGit(join(base, "alias", "notes"))).rejects.toThrow(/link/);
			expect(existsSync(join(base, "real", "notes", ".git"))).toBe(false);
		} finally {
			rmSync(base, { recursive: true, force: true });
		}
	});

	it("refuses a folder that already has git", async () => {
		mkdirSync(join(folder, ".git"));
		await expect(startGit(folder)).rejects.toThrow(/already has git/);
	});
});
