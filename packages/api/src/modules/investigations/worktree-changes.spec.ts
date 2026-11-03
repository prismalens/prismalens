// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The live worktree diff (#1020): real git on mkdtemp repos, so each fence
 * is what git did. The run's workspace is a worktree of a source repo, as a run makes it.
 */
import { execFileSync } from "node:child_process";
import {
	existsSync,
	linkSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	renameSync,
	rmSync,
	statSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RunWorkspace } from "@prismalens/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readWorktreeChanges } from "./worktree-changes.js";

// Counts every content read Node could make, and every git env the reader passes.
const fsHooks = vi.hoisted(() => ({
	opened: 0,
	envs: [] as Record<string, string>[],
	slowLstat: null as null | { match: string; ms: number },
	beforeSpawn: null as null | ((args: string[]) => void),
}));
vi.mock("node:fs/promises", async (importOriginal) => {
	const real = await importOriginal<typeof import("node:fs/promises")>();
	return {
		...real,
		open: (...args: Parameters<typeof real.open>) => {
			fsHooks.opened++;
			return real.open(...args);
		},
		readFile: (...args: Parameters<typeof real.readFile>) => {
			fsHooks.opened++;
			return real.readFile(...args);
		},
		lstat: async (...args: Parameters<typeof real.lstat>) => {
			const slow = fsHooks.slowLstat;
			if (slow && String(args[0]).includes(slow.match))
				await new Promise((r) => setTimeout(r, slow.ms));
			return real.lstat(...args);
		},
	};
});
vi.mock("../../core/harness/git-spawn.js", async (importOriginal) => {
	const real = await importOriginal<typeof import("../../core/harness/git-spawn.js")>();
	return {
		...real,
		spawnGit: (args: string[], opts: Parameters<typeof real.spawnGit>[1]) => {
			fsHooks.envs.push((opts?.env ?? {}) as Record<string, string>);
			fsHooks.beforeSpawn?.(args);
			return real.spawnGit(args, opts);
		},
	};
});

const GIT_ENV = { ...process.env, GIT_TERMINAL_PROMPT: "0" };
const ID = ["-c", "user.email=t@t.local", "-c", "user.name=T"];

function git(args: string[], cwd: string): string {
	return execFileSync("git", [...ID, ...args], { cwd, env: GIT_ENV })
		.toString()
		.trim();
}

function write(dir: string, files: Record<string, string | Buffer>) {
	for (const [p, body] of Object.entries(files)) {
		mkdirSync(join(dir, p, ".."), { recursive: true });
		writeFileSync(join(dir, p), body);
	}
}

let root: string;
let src: string;
let run: string;
let base: string;

function ws(dir = run, head = base): RunWorkspace {
	return {
		layout: "single",
		cwd: dir,
		repos: [
			{
				name: "repo",
				dir,
				sourceKind: "folder",
				url: src,
				subPath: null,
				connectionId: null,
				head,
				branch: "prismalens/shop-run",
				services: [],
			},
		],
	};
}

const read = (w: RunWorkspace | null, opts: { deadlineMs?: number } = {}) =>
	readWorktreeChanges(w, { roots: [root], ...opts });

async function changes(dir = run, head = base) {
	const out = await read(ws(dir, head));
	const repo = out.repos[0];
	if (repo?.state !== "ok") throw new Error(`not ok: ${JSON.stringify(repo)}`);
	return repo;
}

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "pl-changes-spec-"));
	src = join(root, "src");
	git(["init", "-q", "-b", "main", src], root);
	// Line endings as written, whatever the host's git would convert.
	git(["config", "core.autocrlf", "false"], src);
	write(src, {
		"src/retry.ts": "export const retries = 3;\n",
		"README.md": "shop\n",
		"logo.bin": Buffer.from([0, 1, 2, 3]),
	});
	git(["add", "-A"], src);
	git(["commit", "-q", "-m", "one"], src);
	base = git(["rev-parse", "HEAD"], src);
	run = join(root, "pl-run");
	git(["worktree", "add", "-q", "-b", "prismalens/shop-run", run, base], src);
}, 30_000);

afterEach(() => {
	fsHooks.opened = 0;
	fsHooks.slowLstat = null;
	fsHooks.beforeSpawn = null;
	rmSync(root, { recursive: true, force: true });
});

describe("readWorktreeChanges (#1020)", () => {
	it("is empty for an untouched workspace, and names the commit it started at", async () => {
		const repo = await changes();
		expect(repo).toMatchObject({
			base,
			branch: "prismalens/shop-run",
			files: [],
			additions: 0,
			deletions: 0,
			omitted: null,
			truncated: false,
		});
	});

	it("shows edits, deletions and staged changes against the start, never the index", async () => {
		write(run, { "src/retry.ts": "export const retries = 5;\nexport const backoff = 2;\n" });
		rmSync(join(run, "README.md"));
		write(run, { "src/staged.ts": "staged\n" });
		git(["add", "src/staged.ts"], run);
		// A commit the agent made in the worktree still diffs against where the run began.
		write(run, { "src/committed.ts": "kept\n" });
		git(["add", "src/committed.ts"], run);
		git(["commit", "-q", "-m", "agent"], run);
		const indexFile = git(["rev-parse", "--path-format=absolute", "--git-path", "index"], run);
		const before = readFileSync(indexFile);
		const mtime = statSync(indexFile).mtimeMs;

		const repo = await changes();

		const byPath = Object.fromEntries(repo.files.map((f) => [f.path, f]));
		expect(byPath["src/retry.ts"]).toMatchObject({ status: "modified", additions: 2, deletions: 1 });
		expect(byPath["README.md"]).toMatchObject({ status: "deleted", additions: 0, deletions: 1 });
		// New files are entries only: their content is never read (#1020).
		expect(byPath["src/staged.ts"]).toMatchObject({ status: "added", additions: null });
		expect(byPath["src/committed.ts"]).toMatchObject({ status: "added", additions: null });
		expect(repo.patch).toContain("+export const backoff = 2;");
		expect(repo.patch).not.toContain("staged");
		expect(readFileSync(indexFile).equals(before)).toBe(true);
		expect(statSync(indexFile).mtimeMs).toBe(mtime);
	});

	it("lists binary files without their bytes", async () => {
		write(run, { "logo.bin": Buffer.from([0, 9, 9, 9]), "new.bin": Buffer.from([1, 0, 2]) });
		const repo = await changes();
		const byPath = Object.fromEntries(repo.files.map((f) => [f.path, f]));
		expect(byPath["logo.bin"]).toMatchObject({ status: "modified", additions: null, deletions: null });
		expect(byPath["new.bin"]).toMatchObject({ status: "added", additions: null });
		expect(repo.patch ?? "").not.toContain("new.bin");
	});

	it("never runs a program the repo's config or attributes name", async () => {
		const marker = join(root, "pwned");
		const script = join(root, "evil.sh");
		writeFileSync(script, `#!/bin/sh\necho x > "${marker.replaceAll("\\", "/")}"\ncat\n`, { mode: 0o755 });
		const cmd = script.replaceAll("\\", "/");
		for (const [k, v] of [
			["core.fsmonitor", cmd],
			["diff.external", cmd],
			["diff.evil.command", cmd],
			["diff.evil.textconv", cmd],
			["filter.evil.clean", cmd],
			["filter.evil.process", cmd],
			["core.pager", cmd],
		] as const)
			git(["config", k, v], run);
		write(run, { ".gitattributes": "* diff=evil filter=evil\n", "src/retry.ts": "changed\n" });

		const repo = await changes();

		expect(repo.files.map((f) => f.path)).toContain("src/retry.ts");
		expect(existsSync(marker)).toBe(false);
	});

	it("keeps a path that leaves the workspace unread: symlinks, junctions and traversal", async () => {
		const outside = join(root, "outside");
		write(outside, { "secret.txt": "TOP-SECRET\n" });
		// A file symlink needs a privilege Windows rarely grants; the junction below needs none.
		const fileLinks = (() => {
			try {
				symlinkSync(join(outside, "secret.txt"), join(run, "link.txt"), "file");
				return true;
			} catch {
				return false;
			}
		})();
		symlinkSync(outside, join(run, "jumped"), "junction");

		const repo = await changes();

		expect(repo.patch ?? "").not.toContain("TOP-SECRET");
		if (fileLinks)
			expect(repo.files.find((f) => f.path === "link.txt")?.additions ?? null).toBeNull();
		expect(repo.files.some((f) => f.path.startsWith("jumped"))).toBe(true);
		for (const f of repo.files.filter((f) => f.path.startsWith("jumped")))
			expect(f.status).toBe("link");
	});

	it("shows a submodule and a nested repository as entries, never descending into them", async () => {
		const nested = join(run, "vendor", "lib");
		git(["init", "-q", "-b", "main", nested], root);
		write(nested, { "inner.ts": "INNER\n" });

		const repo = await changes();

		expect(repo.files).toContainEqual({
			path: "vendor/lib",
			status: "submodule",
			additions: null,
			deletions: null,
		});
		expect(repo.patch ?? "").not.toContain("INNER");
	});

	it("lists a gitlink of the start commit as a submodule entry", async () => {
		const oid = git(["rev-parse", "HEAD"], src);
		git(["update-index", "--add", "--cacheinfo", `160000,${oid},deps/sub`], src);
		git(["commit", "-q", "-m", "sub"], src);
		const withSub = git(["rev-parse", "HEAD"], src);
		const second = join(root, "pl-run-2");
		git(["worktree", "add", "-q", "--detach", second, withSub], src);

		const repo = await changes(second, withSub);

		expect(repo.files).toContainEqual({
			path: "deps/sub",
			status: "submodule",
			additions: null,
			deletions: null,
		});
	});

	it("says a deleted workspace, a junction in its place or an unknown commit is unavailable", async () => {
		rmSync(run, { recursive: true, force: true });
		expect((await read(ws())).repos[0]).toEqual({
			state: "unavailable",
			repo: "repo",
			reason: "removed",
		});
		const elsewhere = join(root, "elsewhere");
		mkdirSync(elsewhere);
		symlinkSync(elsewhere, run, "junction");
		expect((await read(ws())).repos[0]).toMatchObject({
			reason: "not-a-workspace",
		});
		const fresh = join(root, "pl-run-3");
		git(["worktree", "add", "-q", "--detach", fresh, base], src);
		expect(
			(await read(ws(fresh, "f".repeat(40)))).repos[0],
		).toMatchObject({ reason: "commit-gone" });
		expect((await read(ws("relative/dir"))).repos[0]).toMatchObject({
			reason: "not-a-workspace",
		});
		expect(await read(null)).toEqual({ repos: [] });
	});

	it("says too large rather than sending a patch past the cap, and keeps the counts", async () => {
		const big = Array.from({ length: 60_000 }, (_, i) => `line ${i} ${"x".repeat(40)}`).join("\n");
		write(run, { "src/retry.ts": `${big}\n` });
		const repo = await changes();
		expect(repo.patch).toBeNull();
		expect(repo.omitted).toBe("too-large");
		expect(repo.additions).toBeGreaterThan(0);
	});

	it("never reads an untracked file: links, junctions and new files are names only", async () => {
		write(root, { "outside/secret.txt": "TOP-SECRET\n" });
		write(run, { "new.txt": "TOP-SECRET-TOO\n", "sub/inner.txt": "inner\n" });
		linkSync(join(root, "outside", "secret.txt"), join(run, "hard.txt"));
		symlinkSync(join(root, "outside"), join(run, "jumped"), "junction");
		fsHooks.opened = 0;

		const repo = await changes();

		expect(fsHooks.opened).toBe(0);
		expect(JSON.stringify(repo)).not.toContain("TOP-SECRET");
		const byPath = Object.fromEntries(repo.files.map((f) => [f.path, f]));
		for (const p of ["new.txt", "sub/inner.txt"])
			expect(byPath[p]).toMatchObject({ status: "added", additions: null, deletions: null });
		// A second hard link is shown as linked, as a tracked one is.
		expect(byPath["hard.txt"]).toMatchObject({ status: "link", additions: null });
		const jumped = repo.files.filter((f) => f.path.startsWith("jumped"));
		expect(jumped.length).toBeGreaterThan(0);
		for (const f of jumped) expect(f.status).toBe("link");
	});

	it("says not a workspace when a folder above the recorded workspace became a junction", async () => {
		const loc = join(root, "loc");
		mkdirSync(loc);
		const deep = join(loc, "pl-deep");
		git(["worktree", "add", "-q", "--detach", deep, base], src);
		const evil = join(root, "evil");
		git(["init", "-q", "-b", "main", join(evil, "pl-deep")], root);
		write(join(evil, "pl-deep"), { "secret.txt": "TOP-SECRET\n" });
		renameSync(loc, join(root, "loc-moved"));
		symlinkSync(evil, loc, "junction");

		const out = await read(ws(deep));

		expect(out.repos[0]).toMatchObject({ state: "unavailable", reason: "not-a-workspace" });
		expect(JSON.stringify(out)).not.toContain("secret.txt");
	});

	it("says not a workspace when the configured location itself became a link", async () => {
		const loc = join(root, "loc");
		mkdirSync(loc);
		const deep = join(loc, "pl-deep");
		git(["worktree", "add", "-q", "--detach", deep, base], src);
		const evil = join(root, "evil");
		git(["init", "-q", "-b", "main", join(evil, "pl-deep")], root);
		write(join(evil, "pl-deep"), { "secret.txt": "TOP-SECRET\n" });
		renameSync(loc, join(root, "loc-moved"));
		symlinkSync(evil, loc, "junction");

		const out = await readWorktreeChanges(ws(deep), { roots: [loc] });

		expect(out.repos[0]).toMatchObject({ state: "unavailable", reason: "not-a-workspace" });
		expect(JSON.stringify(out)).not.toContain("secret.txt");
	});

	it("lists untracked files up to the cap without reading one", async () => {
		const many: Record<string, string> = {};
		for (let i = 0; i < 1005; i++) many[`gen/f${i}.txt`] = "x\n";
		write(run, many);
		fsHooks.opened = 0;

		const repo = await changes();

		expect(fsHooks.opened).toBe(0);
		expect(repo.truncated).toBe(true);
		expect(repo.files.filter((f) => f.path.startsWith("gen/"))).toHaveLength(1000);
		expect(repo.patch).toBe("");
	});

	it("stops listing untracked files at the deadline", async () => {
		write(run, { "late.txt": "late\n", "src/retry.ts": "changed\n" });

		const out = await read(ws(), { deadlineMs: 1 });
		const repo = out.repos[0];

		expect(repo).toMatchObject({ state: "ok", truncated: true });
		if (repo?.state === "ok")
			expect(repo.files.some((f) => f.path === "late.txt")).toBe(false);
	});

	it("stops the untracked metadata pass at the deadline and says truncated", async () => {
		const many: Record<string, string> = {};
		for (let i = 0; i < 20; i++) many[`slowgen/f${i}.txt`] = "x\n";
		write(run, many);
		fsHooks.slowLstat = { match: "slowgen", ms: 250 };
		const started = Date.now();
		try {
			const out = await read(ws(), { deadlineMs: 3_000 });
			const repo = out.repos[0];
			expect(Date.now() - started).toBeLessThan(4_500);
			expect(repo).toMatchObject({ state: "ok", truncated: true });
			if (repo?.state === "ok")
				expect(repo.files.filter((f) => f.path.startsWith("slowgen/")).length).toBeLessThan(20);
		} finally {
			fsHooks.slowLstat = null;
		}
	});

	it("never diffs a tracked file swapped for a hard link: it shows as a link", async () => {
		write(root, { "outside/secret.txt": "TOP-SECRET\n" });
		rmSync(join(run, "src", "retry.ts"));
		linkSync(join(root, "outside", "secret.txt"), join(run, "src", "retry.ts"));
		write(run, { "README.md": "shop, edited\n" });

		const repo = await changes();

		expect(JSON.stringify(repo)).not.toContain("TOP-SECRET");
		const byPath = Object.fromEntries(repo.files.map((f) => [f.path, f]));
		expect(byPath["src/retry.ts"]).toMatchObject({ status: "link", additions: null });
		expect(byPath["README.md"]).toMatchObject({ status: "modified", additions: 1 });
		expect(repo.patch).toContain("+shop, edited");
	});

	it("never diffs a tracked file reached through a junction: it shows as a link", async () => {
		write(root, { "outside/retry.ts": "TOP-SECRET\n" });
		renameSync(join(run, "src"), join(root, "src-moved"));
		symlinkSync(join(root, "outside"), join(run, "src"), "junction");

		const out = await read(ws());

		expect(JSON.stringify(out)).not.toContain("TOP-SECRET");
	});

	it("fails closed when the workspace is swapped before the content diff runs", async () => {
		const loc = join(root, "loc");
		mkdirSync(loc);
		const deep = join(loc, "pl-deep");
		git(["worktree", "add", "-q", "--detach", deep, base], src);
		write(deep, { "src/retry.ts": "changed\n" });
		const evil = join(root, "evil", "pl-deep");
		git(["worktree", "add", "-q", "--detach", evil, base], src);
		write(evil, { "src/retry.ts": "TOP-SECRET\n" });
		fsHooks.beforeSpawn = (args) => {
			if (!args.includes("--name-status")) return;
			fsHooks.beforeSpawn = null;
			renameSync(loc, join(root, "loc-moved"));
			symlinkSync(join(root, "evil"), loc, "junction");
		};

		const out = await read(ws(deep));

		expect(out.repos[0]).toMatchObject({ state: "unavailable", reason: "not-a-workspace" });
		expect(JSON.stringify(out)).not.toContain("TOP-SECRET");
	});

	it("runs every git call with no system or global config or attributes", async () => {
		fsHooks.envs = [];
		await changes();
		expect(fsHooks.envs.length).toBeGreaterThan(3);
		for (const env of fsHooks.envs)
			expect(env).toMatchObject({
				GIT_CONFIG_NOSYSTEM: "1",
				GIT_ATTR_NOSYSTEM: "1",
				GIT_CONFIG_GLOBAL: "/dev/null",
			});
	});

	it("ignores the host's global config, attributes and ignore files", async () => {
		const host = join(root, "host");
		write(host, {
			".gitconfig": "[core]\n\tautocrlf = true\n",
			"xdg/git/attributes": "*.ts binary\n",
			"xdg/git/ignore": "hidden.txt\n",
		});
		const saved = { ...process.env };
		process.env.HOME = host;
		process.env.USERPROFILE = host;
		process.env.XDG_CONFIG_HOME = join(host, "xdg");
		process.env.GIT_CONFIG_GLOBAL = join(host, ".gitconfig");
		git(["config", "--unset", "core.autocrlf"], src);
		write(run, { "src/retry.ts": "export const retries = 3;\r\n", "hidden.txt": "seen\n" });
		try {
			const repo = await changes();
			const byPath = Object.fromEntries(repo.files.map((f) => [f.path, f]));
			expect(byPath["src/retry.ts"]).toMatchObject({ status: "modified", additions: 1, deletions: 1 });
			expect(byPath["hidden.txt"]).toMatchObject({ status: "added" });
		} finally {
			for (const k of ["HOME", "USERPROFILE", "XDG_CONFIG_HOME", "GIT_CONFIG_GLOBAL"])
				if (saved[k] === undefined) delete process.env[k];
				else process.env[k] = saved[k];
		}
	});
});
