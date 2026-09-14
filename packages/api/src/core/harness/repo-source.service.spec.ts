// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * RepoSourceService puts the investigated repo under the app-data dir so the
 * harness cwd is never the user's own checkout and never a `git worktree` linked
 * into it (ADR 0004 §2, #629). Real git throughout, no `execFile` mock: every
 * fixture is a working `mkdtemp` repo or a local bare "remote", and every
 * assertion is on what git actually produced, not on the argv we built.
 * `PRISMALENS_WORKSPACE_DIR` is stubbed per test so `mirrorPathFor`'s default
 * root (under `getAppDataDir()`) lands in a throwaway dir.
 */
import { execFileSync } from "node:child_process";
import {
	existsSync,
	lstatSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	classifySource,
	displayNameFor,
	gitAuthEnv,
	mirrorPathFor,
	RepoSourceService,
} from "./repo-source.service.js";

const GIT_ENV = { ...process.env, GIT_TERMINAL_PROMPT: "0" };

function git(args: string[], cwd: string): string {
	return execFileSync("git", args, { cwd, env: GIT_ENV }).toString().trim();
}

/** A non-bare repo with one commit on `main`, `name` committed with `content`. */
function initRepo(dir: string, name = "a.txt", content = "v1"): string {
	git(["init", "-q", "-b", "main", dir], tmpdir());
	writeFileSync(join(dir, name), content);
	git(["add", name], dir);
	git(
		["-c", "user.email=test@test.local", "-c", "user.name=Test", "commit", "-q", "-m", "init"],
		dir,
	);
	return git(["rev-parse", "HEAD"], dir);
}

function headOf(dir: string): string {
	return git(["rev-parse", "HEAD"], dir);
}

describe("repo-source.service", () => {
	let workspace: string;
	const dirs: string[] = [];

	function tmp(prefix: string): string {
		const d = mkdtempSync(join(tmpdir(), prefix));
		dirs.push(d);
		return d;
	}

	beforeEach(() => {
		workspace = tmp("pl-workspace-");
		vi.stubEnv("PRISMALENS_WORKSPACE_DIR", workspace);
	});

	afterEach(() => {
		vi.unstubAllEnvs();
		for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
	});

	describe("classifySource", () => {
		it("classifies an absolute path as a folder, resolved", () => {
			expect(classifySource("/abs/path")).toEqual({
				kind: "folder",
				source: "/abs/path",
			});
		});

		it("expands ~/ to the home directory as a folder", () => {
			expect(classifySource("~/x")).toEqual({
				kind: "folder",
				source: join(homedir(), "x"),
			});
		});

		it("classifies an https URL", () => {
			expect(classifySource("https://github.com/acme/widgets")).toEqual({
				kind: "url",
				source: "https://github.com/acme/widgets",
			});
		});

		it("classifies an ssh:// URL", () => {
			expect(classifySource("ssh://git@example.com/acme/widgets.git")).toEqual(
				{ kind: "url", source: "ssh://git@example.com/acme/widgets.git" },
			);
		});

		it("classifies an scp-style git@host:owner/repo remote", () => {
			expect(classifySource("git@github.com:acme/widgets.git")).toEqual({
				kind: "url",
				source: "git@github.com:acme/widgets.git",
			});
		});

		it("throws on a relative path", () => {
			expect(() => classifySource("relative/path")).toThrow(
				/absolute folder path or a git URL/,
			);
		});

		// URL_LIKE has no file:// alternative; classifySource refuses it (it is
		// neither an absolute path nor URL-like). This is a form limitation, not
		// a bug — do not widen the regex to work around it. `validate`/`snapshot`
		// below exercise file:// directly with `kind: "url"`.
		it("refuses a file:// URL — not accepted by the form", () => {
			expect(() => classifySource("file:///tmp/some-repo.git")).toThrow(
				/absolute folder path or a git URL/,
			);
		});

		it("refuses a leading dash, which git would read as an option", () => {
			expect(() => classifySource("-uevil@host:owner/repo")).toThrow(
				/must not start with '-'/,
			);
		});

		it("refuses credentials in a URL but keeps an ssh username", () => {
			expect(() =>
				classifySource("https://user:tok@github.com/acme/api.git"),
			).toThrow(/must not carry credentials/);
			expect(() => classifySource("https://tok@github.com/acme/api.git")).toThrow(
				/must not carry credentials/,
			);
			expect(classifySource("ssh://git@example.com/acme/api.git").kind).toBe(
				"url",
			);
		});
	});

	describe("mirrorPathFor", () => {
		it("gives remotes that differ only by port their own mirror", () => {
			const a = mirrorPathFor("https://git.example:8443/acme/api.git", "/r");
			const b = mirrorPathFor("https://git.example:9443/acme/api.git", "/r");
			expect(a).not.toBe(b);
		});
	});

	describe("displayNameFor", () => {
		it("names a folder by its basename and a URL by owner/repo", () => {
			expect(displayNameFor("folder", "/home/u/code/api")).toBe("api");
			expect(displayNameFor("url", "https://github.com/acme/api.git")).toBe(
				"acme/api",
			);
			expect(displayNameFor("url", "git@github.com:acme/api.git")).toBe(
				"acme/api",
			);
		});
	});

	describe("gitAuthEnv", () => {
		it("carries an https token as a config-env header, never in argv", () => {
			const env = gitAuthEnv({
				kind: "url",
				source: "https://github.com/acme/api.git",
				token: "tok",
			});
			expect(env.GIT_CONFIG_KEY_0).toBe("http.extraheader");
			expect(env.GIT_CONFIG_VALUE_0).toBe(
				`Authorization: Basic ${Buffer.from("x-access-token:tok").toString("base64")}`,
			);
		});

		it("sends nothing for ssh remotes or without a token", () => {
			expect(
				gitAuthEnv({ kind: "url", source: "git@github.com:acme/api.git", token: "tok" }),
			).toEqual({});
			expect(
				gitAuthEnv({ kind: "url", source: "https://github.com/acme/api.git" }),
			).toEqual({});
		});

		it("never sends a token over plain http", () => {
			expect(
				gitAuthEnv({ kind: "url", source: "http://git.example/acme/api.git", token: "tok" }),
			).toEqual({});
		});
	});

	describe("folder source", () => {
		it("snapshot() clones the committed HEAD; an uncommitted edit is not in the snapshot", async () => {
			const src = tmp("pl-src-");
			const head = initRepo(src);
			writeFileSync(join(src, "a.txt"), "v2-uncommitted");

			const service = new RepoSourceService();
			const dest = join(tmp("pl-dest-"), "repo");
			const snap = await service.snapshot({ kind: "folder", source: src }, dest);

			expect(snap.head).toBe(head);
			expect(readFileSync(join(dest, "a.txt"), "utf8")).toBe("v1");
		});

		it("the snapshot's .git is its own directory, not a `gitdir:` worktree link", async () => {
			const src = tmp("pl-src-");
			initRepo(src);

			const service = new RepoSourceService();
			const dest = join(tmp("pl-dest-"), "repo");
			await service.snapshot({ kind: "folder", source: src }, dest);

			const gitPath = join(dest, ".git");
			expect(lstatSync(gitPath).isDirectory()).toBe(true);
		});

		it("checkFolder() on a subdirectory returns the top level as root and the subdir as prefix", async () => {
			const src = tmp("pl-src-");
			initRepo(src);
			const subdir = join(src, "sub", "dir");
			execFileSync("mkdir", ["-p", subdir]);
			writeFileSync(join(subdir, "b.txt"), "nested");
			git(["add", "."], src);
			git(
				["-c", "user.email=test@test.local", "-c", "user.name=Test", "commit", "-q", "-m", "nested"],
				src,
			);

			const service = new RepoSourceService();
			const check = await service.checkFolder(subdir);

			expect(realpathSync(check.root)).toBe(realpathSync(src));
			expect(check.prefix).toBe("sub/dir");
		});

		it("a bad folder path surfaces our own verbatim message", async () => {
			const service = new RepoSourceService();
			const missing = join(tmpdir(), "pl-does-not-exist-xyz");

			await expect(service.checkFolder(missing)).rejects.toThrow(
				new RegExp(`No such folder: ${missing}`),
			);
		});

		it("snapshot() into a dest that already exists succeeds (retry case)", async () => {
			const src = tmp("pl-src-");
			const head = initRepo(src);
			const dest = join(tmp("pl-dest-"), "repo");

			const service = new RepoSourceService();
			await service.snapshot({ kind: "folder", source: src }, dest);
			const second = await service.snapshot({ kind: "folder", source: src }, dest);

			expect(second.head).toBe(head);
			expect(existsSync(join(dest, "a.txt"))).toBe(true);
		});

		it("two concurrent snapshot() calls for one folder source into two dests both succeed with the same head", async () => {
			const src = tmp("pl-src-");
			const head = initRepo(src);
			const destA = join(tmp("pl-dest-"), "repo");
			const destB = join(tmp("pl-dest-"), "repo");

			const service = new RepoSourceService();
			const [a, b] = await Promise.all([
				service.snapshot({ kind: "folder", source: src }, destA),
				service.snapshot({ kind: "folder", source: src }, destB),
			]);

			expect(a.head).toBe(head);
			expect(b.head).toBe(head);
		});
	});

	describe("URL source via a local bare remote", () => {
		function makeBareRemote(): { bareDir: string; work: string } {
			const bareDir = join(tmp("pl-bare-"), "remote.git");
			git(["init", "-q", "--bare", "-b", "main", bareDir], tmpdir());
			const work = tmp("pl-work-");
			git(["init", "-q", "-b", "main", work], tmpdir());
			git(["remote", "add", "origin", bareDir], work);
			return { bareDir, work };
		}

		function commitAndPush(work: string, name: string, content: string): string {
			writeFileSync(join(work, name), content);
			git(["add", name], work);
			git(
				["-c", "user.email=test@test.local", "-c", "user.name=Test", "commit", "-q", "-m", name],
				work,
			);
			git(["push", "-q", "origin", "main"], work);
			return headOf(work);
		}

		it("validate() creates the mirror at mirrorPathFor(url) and returns branch and head", async () => {
			const { bareDir, work } = makeBareRemote();
			const head = commitAndPush(work, "a.txt", "v1");
			const url = `file://${bareDir}`;

			const service = new RepoSourceService();
			const check = await service.validate({ kind: "url", source: url });

			expect(check.branch).toBe("main");
			expect(check.head).toBe(head);
			const mirror = mirrorPathFor(url);
			expect(existsSync(join(mirror, "HEAD"))).toBe(true);
		});

		it("validate() with a default branch reports that branch from the bare mirror", async () => {
			const { bareDir, work } = makeBareRemote();
			const head = commitAndPush(work, "a.txt", "v1");
			const url = `file://${bareDir}`;

			const check = await new RepoSourceService().validate({
				kind: "url",
				source: url,
				defaultBranch: "main",
			});

			expect(check).toEqual({ branch: "main", head });
		});

		it("a second commit pushed to the remote is picked up by the next snapshot()", async () => {
			const { bareDir, work } = makeBareRemote();
			commitAndPush(work, "a.txt", "v1");
			const url = `file://${bareDir}`;
			const service = new RepoSourceService();

			const first = await service.snapshot(
				{ kind: "url", source: url, defaultBranch: "main" },
				join(tmp("pl-dest-"), "repo"),
			);

			const secondHead = commitAndPush(work, "a.txt", "v2");
			const second = await service.snapshot(
				{ kind: "url", source: url, defaultBranch: "main" },
				join(tmp("pl-dest-"), "repo"),
			);

			expect(first.head).not.toBe(second.head);
			expect(second.head).toBe(secondHead);
		});

		it("two concurrent snapshot() calls for one URL source share the mirror and both resolve to the pushed head", async () => {
			const { bareDir, work } = makeBareRemote();
			const head = commitAndPush(work, "a.txt", "v1");
			const url = `file://${bareDir}`;
			const service = new RepoSourceService();

			const [a, b] = await Promise.all([
				service.snapshot(
					{ kind: "url", source: url, defaultBranch: "main" },
					join(tmp("pl-dest-"), "repo"),
				),
				service.snapshot(
					{ kind: "url", source: url, defaultBranch: "main" },
					join(tmp("pl-dest-"), "repo"),
				),
			]);

			expect(a.head).toBe(head);
			expect(b.head).toBe(head);
		});

		it("a bad URL surfaces git's own verbatim error", async () => {
			const service = new RepoSourceService();
			const badUrl = `file://${join(tmpdir(), "pl-no-such-remote-xyz.git")}`;

			await expect(
				service.validate({ kind: "url", source: badUrl }),
			).rejects.toThrow(/does not appear to be a git repository/);
		});
	});
});
