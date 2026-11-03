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

// Lets a test act between the reader's checks and its open, as a racing agent would.
const fsHooks = vi.hoisted(() => ({
	beforeOpen: null as null | ((path: string) => void),
	opened: 0,
}));
vi.mock("node:fs/promises", async (importOriginal) => {
	const real = await importOriginal<typeof import("node:fs/promises")>();
	return {
		...real,
		open: (...args: Parameters<typeof real.open>) => {
			fsHooks.opened++;
			const hook = fsHooks.beforeOpen;
			fsHooks.beforeOpen = null;
			hook?.(String(args[0]));
			return real.open(...args);
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
	fsHooks.beforeOpen = null;
	fsHooks.opened = 0;
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
		expect(byPath["src/staged.ts"]).toMatchObject({ status: "added", additions: 1 });
		expect(byPath["src/committed.ts"]).toMatchObject({ status: "added", additions: 1 });
		expect(repo.patch).toContain("+export const backoff = 2;");
		expect(repo.patch).toContain("+++ b/src/staged.ts");
		expect(readFileSync(indexFile).equals(before)).toBe(true);
		expect(statSync(indexFile).mtimeMs).toBe(mtime);
	});

	it("lists binary files without their bytes", async () => {
		write(run, { "logo.bin": Buffer.from([0, 9, 9, 9]), "new.bin": Buffer.from([1, 0, 2]) });
		const repo = await changes();
		const byPath = Object.fromEntries(repo.files.map((f) => [f.path, f]));
		expect(byPath["logo.bin"]).toMatchObject({ status: "modified", additions: null, deletions: null });
		expect(byPath["new.bin"]).toMatchObject({ status: "added", additions: null });
		expect(repo.patch).toContain("Binary files /dev/null and b/new.bin differ");
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

	it("binds an untracked file's read to the file it checked: a hard link swapped in before open", async () => {
		write(root, { "outside/secret.txt": "TOP-SECRET\n" });
		write(run, { "new.txt": "fine\n" });
		fsHooks.beforeOpen = () => {
			rmSync(join(run, "new.txt"));
			linkSync(join(root, "outside", "secret.txt"), join(run, "new.txt"));
		};

		const repo = await changes();

		expect(repo.patch ?? "").not.toContain("TOP-SECRET");
		expect(repo.files.find((f) => f.path === "new.txt")).toMatchObject({ status: "link" });
	});

	it("binds an untracked file's read to the file it checked: a symlink swapped in before open", async () => {
		write(root, { "outside/secret.txt": "TOP-SECRET\n" });
		write(run, { "new.txt": "fine\n" });
		// A file symlink needs a privilege Windows rarely grants; the hard link case covers it there.
		try {
			symlinkSync(join(root, "outside", "secret.txt"), join(root, "probe"), "file");
		} catch {
			return;
		}
		fsHooks.beforeOpen = () => {
			rmSync(join(run, "new.txt"));
			symlinkSync(join(root, "outside", "secret.txt"), join(run, "new.txt"), "file");
		};

		const repo = await changes();

		expect(repo.patch ?? "").not.toContain("TOP-SECRET");
		expect(repo.files.find((f) => f.path === "new.txt")).toMatchObject({ status: "link" });
	});

	it("binds an untracked file's read to the file it checked: its folder swapped for a junction before open", async () => {
		write(root, { "outside/new.txt": "TOP-SECRET\n" });
		write(run, { "sub/new.txt": "fine\n" });
		fsHooks.beforeOpen = () => {
			renameSync(join(run, "sub"), join(run, "sub-moved"));
			symlinkSync(join(root, "outside"), join(run, "sub"), "junction");
		};

		const repo = await changes();

		expect(repo.patch ?? "").not.toContain("TOP-SECRET");
		expect(repo.files.find((f) => f.path === "sub/new.txt")).toMatchObject({ status: "link" });
	});

	it("says not a workspace when a folder above the recorded workspace became a junction", async () => {
		const loc = join(root, "loc");
		mkdirSync(loc);
		const deep = join(loc, "pl-deep");
		git(["worktree", "add", "-q", "--detach", deep, base], src);
		// Somewhere else holding a repository with the same layout and a secret in it.
		const evil = join(root, "evil");
		git(["init", "-q", "-b", "main", join(evil, "pl-deep")], root);
		write(join(evil, "pl-deep"), { "secret.txt": "TOP-SECRET\n" });
		renameSync(loc, join(root, "loc-moved"));
		symlinkSync(evil, loc, "junction");

		const out = await read(ws(deep));

		expect(out.repos[0]).toMatchObject({ state: "unavailable", reason: "not-a-workspace" });
		expect(JSON.stringify(out)).not.toContain("TOP-SECRET");
	});

	it("never reads outside when a folder above the workspace is swapped while a read is paused", async () => {
		const loc = join(root, "loc");
		mkdirSync(loc);
		const deep = join(loc, "pl-deep");
		git(["worktree", "add", "-q", "--detach", deep, base], src);
		write(deep, { "a.txt": "fine\n" });
		write(root, { "evil/pl-deep/a.txt": "TOP-SECRET\n" });
		fsHooks.beforeOpen = () => {
			renameSync(loc, join(root, "loc-moved"));
			symlinkSync(join(root, "evil"), loc, "junction");
		};

		const out = await read(ws(deep));

		expect(JSON.stringify(out)).not.toContain("TOP-SECRET");
	});

	it("stops reading untracked files at the patch budget, before building the oversized patch", async () => {
		const body = "x\n".repeat(128 * 1024);
		for (let i = 0; i < 12; i++) write(run, { [`gen/f${String(i).padStart(2, "0")}.txt`]: body });

		const repo = await changes();

		expect(repo.patch).toBeNull();
		expect(repo.omitted).toBe("too-large");
		expect(repo.files.filter((f) => f.path.startsWith("gen/"))).toHaveLength(12);
		// Each patch is about 384 KiB, so the 2 MiB budget holds five; the rest stay unread.
		expect(fsHooks.opened).toBeLessThanOrEqual(6);
		expect(repo.files.filter((f) => f.additions === null).length).toBeGreaterThanOrEqual(6);
	});

	it("stops reading untracked files at the deadline", async () => {
		write(run, { "late.txt": "late\n" });

		const out = await read(ws(), { deadlineMs: 0 });
		const repo = out.repos[0];

		expect(fsHooks.opened).toBe(0);
		expect(repo).toMatchObject({ state: "ok", patch: null, omitted: "too-large" });
		if (repo?.state === "ok")
			expect(repo.files).toContainEqual({ path: "late.txt", status: "added", additions: null, deletions: null });
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
			expect(byPath["hidden.txt"]).toMatchObject({ status: "added", additions: 1 });
		} finally {
			for (const k of ["HOME", "USERPROFILE", "XDG_CONFIG_HOME", "GIT_CONFIG_GLOBAL"])
				if (saved[k] === undefined) delete process.env[k];
				else process.env[k] = saved[k];
		}
	});
});
