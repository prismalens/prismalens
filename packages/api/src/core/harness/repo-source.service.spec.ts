// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * RepoSourceService puts the investigated repo under the app-data dir so the
 * harness cwd is never the user's own checkout: a folder as a locked worktree of
 * it, a URL as a clone of its mirror (ADR 0004 §2, #629, #918). Real git throughout, no `execFile` mock: every
 * fixture is a working `mkdtemp` repo or a local bare "remote", and every
 * assertion is on what git actually produced, not on the argv we built.
 * `PRISMALENS_WORKSPACE_DIR` is stubbed per test so `mirrorPathFor`'s default
 * root (under `getAppDataDir()`) lands in a throwaway dir.
 */
import { execFileSync } from "node:child_process";
import {
	chmodSync,
	existsSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { Logger } from "@nestjs/common";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	type GitHttpServer,
	startGitHttpServer,
} from "./__fixtures__/git-http-server.js";
import { GitCredential } from "./git-credential.js";
import { gitEnv } from "./git-env.js";
import { GitFailure, scrubGitStderr } from "./git-failure.js";
import {
	classifySource,
	displayNameFor,
	mirrorPathFor,
	tokenUsernameFor,
	RepoSourceService,
} from "./repo-source.service.js";
import {
	releaseWorktreesIn,
	runWorktreeDir,
	sweepRunWorktrees,
	worktreeRoot,
} from "./run-worktree.js";

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

/** Runs a git call expected to fail and returns its stderr. */
function gitFails(args: string[], cwd: string): string {
	try {
		execFileSync("git", args, { cwd, env: GIT_ENV, stdio: "pipe" });
	} catch (err) {
		return String((err as { stderr?: Buffer }).stderr ?? "");
	}
	throw new Error(`git ${args.join(" ")} succeeded`);
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

	describe("classifySource query and fragment (#848)", () => {
		it.each([
			"https://github.com/acme/api.git?token=sentinel",
			"https://github.com/acme/api.git#sentinel",
			"ssh://git@example.com/acme/api.git?x=1",
			"https://host/repo.git#x",
		])("refuses %s", (input) => {
			expect(() => classifySource(input)).toThrow(/query string or fragment/);
		});

		it("refuses an scp remote's query, which would be echoed back as a credential", () => {
			expect(() =>
				classifySource("git@host:acme/api.git?token=sentinel"),
			).toThrow(/query string/);
		});

		it("accepts an scp path's #, a path character", () => {
			const input = "git@example.com:acme/repo#archive.git";
			expect(classifySource(input)).toEqual({ kind: "url", source: input });
		});
	});

	describe("a failed remote (#848)", () => {
		it("puts the URL's query in neither the error nor the log", async () => {
			vi.stubEnv("HOME", tmp("pl-home-"));
			const service = new RepoSourceService();
			const warn = vi
				.spyOn((service as unknown as { logger: Logger }).logger, "warn")
				.mockImplementation(() => {});
			const down = createServer((_req, res) => res.writeHead(500).end());
			await new Promise<void>((ok) => down.listen(0, "127.0.0.1", ok));
			const { port } = down.address() as AddressInfo;
			const source = `http://127.0.0.1:${port}/org/repo.git?api_key=sentinel`;
			const failure = await service
				.validate({ kind: "url", source })
				.catch((err: unknown) => err);
			down.close();
			expect(failure).toBeInstanceOf(GitFailure);
			expect((failure as GitFailure).message).not.toContain("sentinel");
			expect(warn).toHaveBeenCalled();
			const logged = warn.mock.calls.map(([m]) => String(m)).join(" | ");
			expect(logged).toContain(`127.0.0.1:${port}/org/repo`);
			expect(logged).not.toContain("sentinel");
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

	describe("GitCredential header", () => {
		const token = (host = "github.com") =>
			new GitCredential(
				{ source: "connection", label: "token A", via: "git-host-token" },
				"tok",
				{ host },
			);

		it("carries an https token as a config-env header scoped to its host, never in argv", () => {
			const env = gitEnv({
				...token().envInput("https://github.com/acme/api.git"),
				parent: {},
				wsl: false,
			});
			expect(env.GIT_CONFIG_KEY_0).toBe("credential.helper");
			expect(env.GIT_CONFIG_KEY_2).toBe("http.https://github.com/.extraheader");
			expect(env.GIT_CONFIG_VALUE_2).toBe(
				`Authorization: Basic ${Buffer.from("x-access-token:tok").toString("base64")}`,
			);
		});

		it("sends each host's own token username (#634)", () => {
			const header = (source: string) =>
				token(new URL(source).host).authHeader(source);
			const basic = (user: string) =>
				`Authorization: Basic ${Buffer.from(`${user}:tok`).toString("base64")}`;
			expect(header("https://gitlab.com/acme/api.git")).toBe(basic("oauth2"));
			expect(header("https://gitlab.acme.internal/team/api.git")).toBe(basic("oauth2"));
			expect(header("https://bitbucket.org/acme/api.git")).toBe(basic("x-token-auth"));
			expect(header("https://github.com/acme/api.git")).toBe(basic("x-access-token"));
		});

		it("does not read a host that merely contains 'gitlab' as GitLab", () => {
			expect(tokenUsernameFor("notgitlab.example.com")).toBe("x-access-token");
			expect(tokenUsernameFor("GitLab.com")).toBe("oauth2");
		});

		it("sends nothing for ssh remotes, another host, or without a token", () => {
			expect(token().authHeader("ssh://git@github.com/acme/api.git")).toBeUndefined();
			expect(token().authHeader("https://gitlab.com/acme/api.git")).toBeUndefined();
			expect(
				new GitCredential({ source: "none", label: "public", via: "none" }).authHeader(
					"https://github.com/acme/api.git",
				),
			).toBeUndefined();
		});

		it("never sends a token over plain http", () => {
			expect(token("git.example").authHeader("http://git.example/acme/api.git")).toBeUndefined();
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

		it("snapshot() with an aborted signal rejects with its reason and clones nothing (#605 edge 23)", async () => {
			const src = tmp("pl-src-");
			initRepo(src);
			const controller = new AbortController();
			controller.abort(new Error("cancelled"));

			const service = new RepoSourceService();
			const dest = join(tmp("pl-dest-"), "repo");
			await expect(
				service.snapshot({ kind: "folder", source: src }, dest, controller.signal),
			).rejects.toThrow("cancelled");
			expect(existsSync(dest)).toBe(false);
		});

		it("snapshot() keeps repo-supplied agent config at any depth, nothing stripped (#817)", async () => {
			const src = tmp("pl-src-");
			initRepo(src);
			for (const [path, body] of [
				[".opencode/plugin/evil.js", "x"],
				["opencode.json", "{}"],
				[".claude/settings.json", "{}"],
				[".mcp.json", "{}"],
				["AGENTS.md", "instructions"],
				["AGENTS.override.md", "override"],
				["CLAUDE.md", "instructions"],
				["GEMINI.md", "instructions"],
				[".cursorrules", "rules"],
				["services/api/.opencode/plugin/evil.js", "x"],
				["services/api/AGENTS.md", "nested instructions"],
				["services/api/CLAUDE.md", "nested instructions"],
				["services/api/GEMINI.md", "nested instructions"],
				["services/api/.cursorrules", "nested rules"],
				["services/api/src/app.js", "code"],
			]) {
				mkdirSync(join(src, path, ".."), { recursive: true });
				writeFileSync(join(src, path), body);
			}
			git(["add", "-A"], src);
			git(["-c", "user.email=t@t", "-c", "user.name=T", "commit", "-q", "-m", "agent config"], src);

			const dest = join(tmp("pl-dest-"), "repo");
			await new RepoSourceService().snapshot({ kind: "folder", source: src }, dest);

			for (const kept of [
				".opencode",
				"opencode.json",
				".claude",
				".mcp.json",
				"AGENTS.md",
				"AGENTS.override.md",
				"CLAUDE.md",
				"GEMINI.md",
				".cursorrules",
				"services/api/.opencode",
				"services/api/AGENTS.md",
				"services/api/CLAUDE.md",
				"services/api/GEMINI.md",
				"services/api/.cursorrules",
			]) {
				expect(existsSync(join(dest, kept)), kept).toBe(true);
			}
			expect(readFileSync(join(dest, "services/api/src/app.js"), "utf8")).toBe("code");
		});

		it("a folder snapshot is a detached worktree of the source, locked for its run, and writes no config into it (#918)", async () => {
			const src = tmp("pl-src-");
			const head = initRepo(src);
			const configBefore = readFileSync(join(src, ".git", "config"), "utf8");

			const dest = runWorktreeDir("run1");
			await new RepoSourceService().snapshot({ kind: "folder", source: src }, dest, undefined, undefined, "run1");

			expect(lstatSync(join(dest, ".git")).isFile()).toBe(true);
			const list = git(["worktree", "list", "--porcelain"], src);
			expect(list).toContain(`HEAD ${head}\ndetached\nlocked prismalens run run1`);
			expect(realpathSync(git(["rev-parse", "--show-toplevel"], dest))).toBe(realpathSync(dest));
			expect(readFileSync(join(src, ".git", "config"), "utf8")).toBe(configBefore);
		});

		it("the user's post-checkout hook does not fire when the worktree is made (#918)", async () => {
			const src = tmp("pl-src-");
			initRepo(src);
			const fired = join(tmp("pl-hook-"), "fired");
			const hook = join(src, ".git", "hooks", "post-checkout");
			mkdirSync(join(hook, ".."), { recursive: true });
			writeFileSync(hook, `#!/bin/sh\necho fired > '${fired.replaceAll("\\", "/")}'\n`);
			chmodSync(hook, 0o755);
			// The hook is live: a plain `worktree add` runs it.
			git(["worktree", "add", "-q", "--detach", join(tmp("pl-plain-"), "wt"), "HEAD"], src);
			expect(existsSync(fired)).toBe(true);
			rmSync(fired);

			await new RepoSourceService().snapshot({ kind: "folder", source: src }, runWorktreeDir("run2"), undefined, undefined, "run2");

			expect(existsSync(fired)).toBe(false);
			expect(readFileSync(join(runWorktreeDir("run2"), "a.txt"), "utf8")).toBe("v1");
		});

		it("when the run ends its worktree is unlocked, removed and pruned (#918)", async () => {
			const src = tmp("pl-src-");
			initRepo(src);
			const dest = runWorktreeDir("run3");
			await new RepoSourceService().snapshot({ kind: "folder", source: src }, dest, undefined, undefined, "run3");

			await releaseWorktreesIn(dest);

			expect(existsSync(dest)).toBe(false);
			expect(git(["worktree", "list", "--porcelain"], src)).not.toContain("run3");
			expect(existsSync(join(src, ".git", "worktrees", "pl-run3"))).toBe(false);
		});

		it("the boot sweep removes a dead run's worktree and never touches the user's own (#918)", async () => {
			const src = tmp("pl-src-");
			initRepo(src);
			const own = join(tmp("pl-user-"), "feature");
			const ownLocked = join(tmp("pl-user-"), "pinned");
			git(["worktree", "add", "-q", "-b", "feature", own], src);
			git(["worktree", "add", "-q", "--detach", ownLocked, "HEAD"], src);
			git(["worktree", "lock", "--reason", "mine", ownLocked], src);
			// Even one the user named pl-* under our root, if they locked it themselves.
			const squatter = join(worktreeRoot(), "pl-theirs");
			git(["worktree", "add", "-q", "--detach", squatter, "HEAD"], src);
			git(["worktree", "lock", "--reason", "mine", squatter], src);
			const dead = runWorktreeDir("crashed");
			await new RepoSourceService().snapshot({ kind: "folder", source: src }, dead, undefined, undefined, "crashed");

			expect(await sweepRunWorktrees()).toEqual(expect.arrayContaining(["crashed"]));

			expect(existsSync(dead)).toBe(false);
			const list = git(["worktree", "list", "--porcelain"], src);
			expect(list).not.toContain("prismalens run crashed");
			expect(list).toContain("branch refs/heads/feature");
			expect(list).toContain("locked mine");
			expect(existsSync(join(own, "a.txt"))).toBe(true);
			expect(existsSync(join(ownLocked, "a.txt"))).toBe(true);
			expect(existsSync(join(squatter, "a.txt"))).toBe(true);
		});

		it("a follow-up re-adds the worktree at the same path and the recorded commit, even after a crash left it registered (#918, #747)", async () => {
			const src = tmp("pl-src-");
			const first = initRepo(src);
			const service = new RepoSourceService();
			const dest = runWorktreeDir("run4");
			await service.snapshot({ kind: "folder", source: src }, dest, undefined, undefined, "run4");
			writeFileSync(join(src, "a.txt"), "v2");
			git(["-c", "user.email=t@t", "-c", "user.name=T", "commit", "-qam", "v2"], src);
			// A crash: the directory is gone, the locked entry is still in the user's repo.
			rmSync(dest, { recursive: true, force: true });

			const again = await service.snapshot({ kind: "folder", source: src }, dest, undefined, first, "run4");

			expect(again.path).toBe(dest);
			expect(again.head).toBe(first);
			expect(readFileSync(join(dest, "a.txt"), "utf8")).toBe("v1");
			expect(git(["worktree", "list", "--porcelain"], src).match(/prismalens run run4/g)).toHaveLength(1);
		});

		it("three folders of one git repo check out at once, as the run's budget does, while another run is released (#918)", async () => {
			const src = tmp("pl-src-");
			initRepo(src);
			for (const sub of ["services/api", "services/worker"]) {
				mkdirSync(join(src, sub), { recursive: true });
				writeFileSync(join(src, sub, "x.txt"), sub);
			}
			git(["add", "-A"], src);
			git(["-c", "user.email=t@t", "-c", "user.name=T", "commit", "-q", "-m", "services"], src);
			const head = headOf(src);
			const service = new RepoSourceService();
			const sources = [src, join(src, "services", "api"), join(src, "services", "worker")];
			for (let round = 0; round < 5; round++) {
				const other = runWorktreeDir(`other${round}`);
				await service.snapshot({ kind: "folder", source: src }, other, undefined, undefined, `other${round}`);
				const dests = ["mono", "api", "worker"].map((n) => join(runWorktreeDir(`run6r${round}`), n));

				const [snaps] = await Promise.all([
					Promise.all(
						sources.map((source, i) =>
							service.snapshot({ kind: "folder", source }, dests[i] as string, undefined, undefined, `run6r${round}`),
						),
					),
					releaseWorktreesIn(other),
				]);

				expect(snaps.map((s) => s.head)).toEqual([head, head, head]);
				for (const d of dests) expect(readFileSync(join(d, "services", "api", "x.txt"), "utf8")).toBe("services/api");
				expect(git(["worktree", "list", "--porcelain"], src).match(new RegExp(`prismalens run run6r${round}`, "g"))).toHaveLength(3);
				await releaseWorktreesIn(runWorktreeDir(`run6r${round}`));
			}
			expect(git(["worktree", "list", "--porcelain"], src)).not.toContain("prismalens run");
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

		it("snapshot() pinned to an earlier commit checks that commit out, and a commit the source lacks fails naming it (#747)", async () => {
			const { bareDir, work } = makeBareRemote();
			const first = commitAndPush(work, "a.txt", "v1");
			commitAndPush(work, "a.txt", "v2");
			const src = { kind: "url" as const, source: `file://${bareDir}`, defaultBranch: "main" };
			const service = new RepoSourceService();

			const dest = join(tmp("pl-dest-"), "repo");
			const pinned = await service.snapshot(src, dest, undefined, first);
			expect(pinned.head).toBe(first);
			expect(readFileSync(join(dest, "a.txt"), "utf8")).toBe("v1");

			await expect(
				service.snapshot(src, join(tmp("pl-dest-"), "repo"), undefined, "0123456789abcdef0123456789abcdef01234567"),
			).rejects.toThrow(/Commit 0123456789abcdef0123456789abcdef01234567 could not be checked out/);
		});

		it("a URL source is still a clone of the bare mirror, not a worktree of it (#918)", async () => {
			const { bareDir, work } = makeBareRemote();
			commitAndPush(work, "a.txt", "v1");
			const url = `file://${bareDir}`;

			const dest = join(tmp("pl-dest-"), "repo");
			await new RepoSourceService().snapshot({ kind: "url", source: url }, dest, undefined, undefined, "run5");

			expect(lstatSync(join(dest, ".git")).isDirectory()).toBe(true);
			expect(git(["worktree", "list"], mirrorPathFor(url)).split("\n")).toHaveLength(1);
		});

		it("the snapshot can't push to the mirror it was cloned from (#676)", async () => {
			const { bareDir, work } = makeBareRemote();
			commitAndPush(work, "a.txt", "v1");
			const url = `file://${bareDir}`;

			const dest = join(tmp("pl-dest-"), "repo");
			await new RepoSourceService().snapshot(
				{ kind: "url", source: url, defaultBranch: "main" },
				dest,
			);

			expect(gitFails(["push", "origin", "HEAD:refs/heads/x"], dest)).toContain(
				"transport 'file' not allowed",
			);
			expect(git(["branch", "--list", "x"], mirrorPathFor(url))).toBe("");
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

		it("a bad URL surfaces a fixed sentence, not git's stderr (#848)", async () => {
			const service = new RepoSourceService();
			const badUrl = `file://${join(tmpdir(), "pl-no-such-remote-xyz.git")}`;

			await expect(
				service.validate({ kind: "url", source: badUrl }),
			).rejects.toMatchObject({ code: "other", message: /^git could not read /i });
		});
	});

	describe("against Git HTTP server fixture", () => {
		let server: GitHttpServer;
		let tempHome: string;

		beforeEach(async () => {
			server = await startGitHttpServer({ tls: true });
			tempHome = tmp("pl-home-");
			vi.stubEnv("HOME", tempHome);
			writeFileSync(
				join(tempHome, ".gitconfig"),
				`[http]\n\tsslCAInfo = ${server.caFile}\n`,
			);
		});

		afterEach(async () => {
			await server.close();
		});

		it("T9: parent GIT_ASKPASS and SSH_ASKPASS point at scripts that touch a file; validate with source none fails in < 5 s with no-credential, files untouched", async () => {
			const touchedAskpass = join(tempHome, "touched-git-askpass");
			const touchedSshAskpass = join(tempHome, "touched-ssh-askpass");
			const gitAskpassScript = join(tempHome, "git-askpass.sh");
			const sshAskpassScript = join(tempHome, "ssh-askpass.sh");

			writeFileSync(
				gitAskpassScript,
				`#!/bin/sh\ntouch "${touchedAskpass}"\nsleep 10\nexit 1\n`,
				{ mode: 0o755 },
			);
			writeFileSync(
				sshAskpassScript,
				`#!/bin/sh\ntouch "${touchedSshAskpass}"\nsleep 10\nexit 1\n`,
				{ mode: 0o755 },
			);

			vi.stubEnv("GIT_ASKPASS", gitAskpassScript);
			vi.stubEnv("SSH_ASKPASS", sshAskpassScript);

			const repoUrl = server.addRepo("reject-repo", { kind: "reject-401" });
			const service = new RepoSourceService();

			const start = Date.now();
			let failure: unknown;
			try {
				await service.validate({
					kind: "url",
					source: repoUrl,
					credential: new GitCredential({
						source: "none",
						label: "public",
						via: "none",
					}),
				});
			} catch (err) {
				failure = err;
			}
			const durationMs = Date.now() - start;

			expect(durationMs).toBeLessThan(5000);
			expect(failure).toBeInstanceOf(GitFailure);
			expect((failure as GitFailure).code).toBe("no-credential");
			expect(existsSync(touchedAskpass)).toBe(false);
			expect(existsSync(touchedSshAskpass)).toBe(false);
		});

		it("T9c: source connection, helper configured, reject-401 -> token-rejected, HELPER_LOG empty, server saw exactly one Authorization header", async () => {
			const helperLog = join(tempHome, "helper.log");
			const helperScript = join(tempHome, "helper.sh");
			writeFileSync(
				helperScript,
				`#!/bin/sh\necho "$1" >> "${helperLog}"\nif [ "$1" = "get" ]; then\necho "username=u"\necho "password=p"\nfi\n`,
				{ mode: 0o755 },
			);

			// Configure helper in user's gitconfig
			writeFileSync(
				join(tempHome, ".gitconfig"),
				`[http]\n\tsslCAInfo = ${server.caFile}\n[credential]\n\thelper = "${helperScript}"\n`,
			);

			const repoUrl = server.addRepo("token-reject-repo", {
				kind: "reject-401",
			});
			const u = new URL(repoUrl);
			const service = new RepoSourceService();
			const tokenCred = new GitCredential(
				{
					source: "connection",
					label: "token A",
					via: "git-host-token",
					fingerprint: "11223344",
				},
				"my-secret-token",
				{ host: u.host },
			);

			let failure: unknown;
			try {
				await service.validate({
					kind: "url",
					source: repoUrl,
					credential: tokenCred,
				});
			} catch (err) {
				failure = err;
			}

			expect(failure).toBeInstanceOf(GitFailure);
			expect((failure as GitFailure).code).toBe("token-rejected");
			expect(existsSync(helperLog)).toBe(false);

			const authHeaders = server.headerValues("authorization");
			expect(authHeaders.length).toBe(1);
			expect(authHeaders[0]).toBe(
				`Basic ${Buffer.from("x-access-token:my-secret-token").toString("base64")}`,
			);
		});

		it("T9d: source machine, helper configured, reject-401 -> machine-rejected", async () => {
			const helperScript = join(tempHome, "helper.sh");
			writeFileSync(
				helperScript,
				'#!/bin/sh\nif [ "$1" = "get" ]; then\necho "username=u"\necho "password=p"\nfi\n',
				{ mode: 0o755 },
			);

			writeFileSync(
				join(tempHome, ".gitconfig"),
				`[http]\n\tsslCAInfo = ${server.caFile}\n[credential]\n\thelper = "${helperScript}"\n`,
			);

			const repoUrl = server.addRepo("machine-reject-repo", {
				kind: "reject-401",
			});
			const service = new RepoSourceService();
			const machineCred = new GitCredential({
				source: "machine",
				label: "machine git (helper.sh, u)",
				via: helperScript,
			});

			let failure: unknown;
			try {
				await service.validate({
					kind: "url",
					source: repoUrl,
					credential: machineCred,
				});
			} catch (err) {
				failure = err;
			}

			expect(failure).toBeInstanceOf(GitFailure);
			expect((failure as GitFailure).code).toBe("machine-rejected");
		});

		it("T9e: user [http] extraHeader = X-Test: 1 in .gitconfig, source connection -> server saw no X-Test", async () => {
			writeFileSync(
				join(tempHome, ".gitconfig"),
				`[http]\n\tsslCAInfo = ${server.caFile}\n\textraHeader = X-Test: 1\n`,
			);

			const repoUrl = server.addRepo("anon-repo", { kind: "anonymous" });
			const u = new URL(repoUrl);
			const service = new RepoSourceService();
			const tokenCred = new GitCredential(
				{
					source: "connection",
					label: "token A",
					via: "git-host-token",
				},
				"tok",
				{ host: u.host },
			);

			await service.validate({
				kind: "url",
				source: repoUrl,
				credential: tokenCred,
			});

			expect(server.headerValues("x-test")).toEqual([]);
		});

		it("T11: inFlight keyed by credential (two concurrent ensureMirror with different credentials -> two fetches)", async () => {
			const repoUrl = server.addRepo("concurrent-repo", {
				kind: "anonymous",
			});
			const u = new URL(repoUrl);
			const service = new RepoSourceService();

			// Initial validate creates the bare mirror once
			await service.validate({ kind: "url", source: repoUrl });
			server.requests.length = 0;

			const cred1 = new GitCredential(
				{
					source: "connection",
					label: "token 1",
					via: "git-host-token",
					connectionId: "conn-1",
				},
				"tok1",
				{ host: u.host },
			);
			const cred2 = new GitCredential(
				{
					source: "connection",
					label: "token 2",
					via: "git-host-token",
					connectionId: "conn-2",
				},
				"tok2",
				{ host: u.host },
			);

			// Two concurrent calls on existing mirror with different credentials
			const [res1, res2] = await Promise.all([
				service.validate({ kind: "url", source: repoUrl, credential: cred1 }),
				service.validate({ kind: "url", source: repoUrl, credential: cred2 }),
			]);

			expect(res1.head).toBeDefined();
			expect(res2.head).toBeDefined();
			expect(res1.head).toBe(res2.head);

			// The server should have received fetches with both tokens
			const authHeaders = server.headerValues("authorization");
			expect(authHeaders).toContain(
				`Basic ${Buffer.from("x-access-token:tok1").toString("base64")}`,
			);
			expect(authHeaders).toContain(
				`Basic ${Buffer.from("x-access-token:tok2").toString("base64")}`,
			);
		});

		it("T11b: two credentials racing on a mirror not yet cloned run one after the other, both succeed (#810)", async () => {
			const repoUrl = server.addRepo("cold-race-repo", { kind: "anonymous" });
			const u = new URL(repoUrl);
			const cred = (n: number) =>
				new GitCredential(
					{ source: "connection", label: `token ${n}`, via: "git-host-token", connectionId: `conn-${n}` },
					`tok${n}`,
					{ host: u.host },
				);
			const service = new RepoSourceService();
			const [a, b] = await Promise.all([
				service.validate({ kind: "url", source: repoUrl, credential: cred(1) }),
				service.validate({ kind: "url", source: repoUrl, credential: cred(2) }),
			]);
			expect(a.head).toBe(server.headOf("cold-race-repo"));
			expect(b.head).toBe(a.head);
		});

		it("T12: scrubbing removes an Authorization: Basic ... fragment and ://u:p@", () => {
			const raw =
				"error: Authorization: Basic dXNlcjpzZWNyZXQ= failed\nfatal: unable to access 'https://user:password@github.com/org/repo.git': 401";
			const scrubbed = scrubGitStderr(raw);
			expect(scrubbed).not.toContain("Basic dXNlcjpzZWNyZXQ=");
			expect(scrubbed).not.toContain("user:password");
			expect(scrubbed).toContain("Authorization: ***");
			expect(scrubbed).toContain("https://***@github.com/org/repo.git");
		});
	});
});
