// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { execFileSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	createWorkspace,
	releaseWorkspace,
	resolveWorkspacePolicy,
	runHook,
	sweepWorkspaces,
	type WorkspaceOwner,
	type WorkspacePolicy,
} from "./index.js";

const GIT_ENV = {
	...process.env,
	GIT_AUTHOR_NAME: "t",
	GIT_AUTHOR_EMAIL: "t@example.com",
	GIT_COMMITTER_NAME: "t",
	GIT_COMMITTER_EMAIL: "t@example.com",
};
const sh = (cwd: string, ...args: string[]) =>
	execFileSync("git", ["-c", "commit.gpgsign=false", ...args], { cwd, env: GIT_ENV, encoding: "utf8" }).trim();

/** A node one-liner, so the same hook runs under sh and cmd.exe. */
const nodeCmd = (code: string) => `"${process.execPath}" -e "${code}"`;
const both = (cmd: string) => ({ posix: cmd, windows: cmd });

const POLICY: WorkspacePolicy = {
	method: "worktree",
	retention: { kind: "remove-unless-changed" },
};

let root: string;
let repo: string;
let commit: string;
let owner: WorkspaceOwner;

beforeEach(() => {
	root = realpathSync(mkdtempSync(join(tmpdir(), "ah-ws-")));
	repo = join(root, "repo");
	mkdirSync(repo);
	sh(repo, "init", "-q", "-b", "main");
	sh(repo, "config", "core.autocrlf", "false");
	writeFileSync(join(repo, "a.txt"), "a\n");
	writeFileSync(join(repo, ".gitignore"), ".env\nbuild/\n");
	writeFileSync(join(repo, ".env"), "SECRET=1\n");
	sh(repo, "add", ".");
	sh(repo, "commit", "-q", "-m", "one");
	commit = sh(repo, "rev-parse", "HEAD");
	owner = { parentDir: join(root, "ws"), prefix: "pl-", lockPrefix: "prismalens run " };
});
afterEach(() => {
	rmSync(root, { recursive: true, force: true, maxRetries: 3 });
});

const create = (id: string, policy: WorkspacePolicy = POLICY, project = "p1") =>
	createWorkspace({ ...owner, id, project, policy, source: { kind: "local", repo, commit } });

describe("createWorkspace", () => {
	it("adds a detached, locked worktree at the exact commit", async () => {
		const ws = await create("r1");
		expect(ws.dir).toBe(join(owner.parentDir, "pl-r1"));
		expect(readFileSync(join(ws.dir, "a.txt"), "utf8")).toBe("a\n");
		expect(sh(ws.dir, "rev-parse", "HEAD")).toBe(commit);
		expect(sh(ws.dir, "rev-parse", "--abbrev-ref", "HEAD")).toBe("HEAD");
		const list = sh(repo, "worktree", "list", "--porcelain");
		expect(list).toContain("locked prismalens run r1");
	}, 60_000);

	it("clones, copies named ignored files in, and checks out a named branch", async () => {
		const ws = await create("r2", {
			...POLICY,
			method: "clone",
			copyIn: [".env", "missing.txt"],
			branch: { kind: "named", name: "prismalens/inc-1-r2" },
		});
		expect(ws.method).toBe("clone");
		expect(ws.copied).toEqual([".env"]);
		expect(readFileSync(join(ws.dir, ".env"), "utf8")).toBe("SECRET=1\n");
		expect(sh(ws.dir, "symbolic-ref", "--short", "HEAD")).toBe("prismalens/inc-1-r2");
		await expect(create("r3", { ...POLICY, copyIn: ["../outside"] })).rejects.toThrow(/inside the repo/);
		await expect(create("r3", { ...POLICY, copyIn: ["."] })).rejects.toThrow(/inside the repo/);
		await expect(create("r3", { ...POLICY, copyIn: [".git/hooks"] })).rejects.toThrow(/inside the repo/);
	}, 60_000);

	it("refuses a copy-in that leaves the repo through a symlinked directory", async () => {
		const elsewhere = join(root, "elsewhere");
		mkdirSync(elsewhere);
		writeFileSync(join(elsewhere, "x"), "outside");
		try {
			symlinkSync(elsewhere, join(repo, "link"), "junction");
		} catch {
			return; // symlinks need a privilege this machine lacks
		}
		await expect(create("r7", { ...POLICY, copyIn: ["link/x"] })).rejects.toThrow(/inside the repo/);
	}, 60_000);

	it("fetches exact head and base SHAs at depth 1 and never writes the credential to .git/config", async () => {
		writeFileSync(join(repo, "b.txt"), "b\n");
		sh(repo, "add", ".");
		sh(repo, "commit", "-q", "-m", "two");
		const head = sh(repo, "rev-parse", "HEAD");
		const ws = await createWorkspace({
			...owner,
			id: "r4",
			policy: POLICY,
			source: {
				kind: "remote",
				url: pathToFileURL(repo).href,
				head,
				base: commit,
				credential: { header: "Authorization: Basic c2VjcmV0LXRva2Vu", scope: "https://github.com" },
			},
		});
		expect(ws.method).toBe("clone");
		expect(sh(ws.dir, "rev-parse", "HEAD")).toBe(head);
		expect(sh(ws.dir, "show", `${commit}:a.txt`)).toBe("a");
		expect(sh(ws.dir, "diff", "--name-only", commit, head)).toBe("b.txt");
		const config = readFileSync(join(ws.dir, ".git", "config"), "utf8");
		expect(config).not.toContain("c2VjcmV0LXRva2Vu");
		expect(config).not.toContain("extraheader");
		expect(existsSync(join(ws.dir, ".git", "shallow"))).toBe(true);
	}, 60_000);

	it("cancels a setup after its silence window, with its output kept", async () => {
		const silent = await createWorkspace({
			...owner,
			id: "r6",
			policy: { ...POLICY, setup: both(nodeCmd("console.log('hello');setTimeout(()=>{},20000)")) },
			source: { kind: "local", repo, commit },
			setupSilenceMs: 1_500,
		});
		expect(silent.setup?.status).toBe("silent");
		expect(silent.setup?.output).toContain("hello");
	}, 60_000);

	it("stops a setup when the caller aborts, and removes the workspace", async () => {
		const ctl = new AbortController();
		const run = createWorkspace({
			...owner,
			id: "r8",
			policy: { ...POLICY, setup: both(nodeCmd("console.log('go');setTimeout(()=>{},20000)")) },
			source: { kind: "local", repo, commit },
			signal: ctl.signal,
			onOutput: () => ctl.abort(),
		});
		await expect(run).rejects.toThrow();
		expect(existsSync(join(owner.parentDir, "pl-r8"))).toBe(false);
	}, 60_000);
});

describe("hooks", () => {
	it("cuts a teardown off at its cap even while it talks", async () => {
		const started = Date.now();
		const r = await runHook(nodeCmd("setInterval(()=>console.log('x'),100)"), {
			cwd: root,
			env: process.env as Record<string, string>,
			capMs: 1_500,
		});
		expect(r.status).toBe("capped");
		expect(Date.now() - started).toBeLessThan(10_000);
	}, 30_000);
});

describe("releaseWorkspace retention", () => {
	it("remove-unless-changed removes a clean workspace, and ignored files do not count", async () => {
		const ws = await create("c1");
		writeFileSync(join(ws.dir, ".env"), "ignored\n");
		const [rec] = await releaseWorkspace({ ...owner, id: "c1", policy: POLICY });
		expect(rec).toMatchObject({ removed: true, reason: "unchanged", project: "p1" });
		expect(existsSync(ws.dir)).toBe(false);
		expect(sh(repo, "worktree", "list")).not.toContain("pl-c1");
	}, 60_000);

	it("remove-unless-changed keeps an untracked file and an uncommitted edit", async () => {
		const a = await create("c2");
		writeFileSync(join(a.dir, "new.txt"), "x");
		const b = await create("c3");
		writeFileSync(join(b.dir, "a.txt"), "edited");
		expect((await releaseWorkspace({ ...owner, id: "c2", policy: POLICY }))[0]).toMatchObject({
			removed: false,
			reason: "changed",
		});
		expect((await releaseWorkspace({ ...owner, id: "c3", policy: POLICY }))[0]).toMatchObject({
			removed: false,
			reason: "changed",
		});
		expect(existsSync(a.dir) && existsSync(b.dir)).toBe(true);
	}, 60_000);

	it("always-remove removes a changed workspace", async () => {
		const ws = await create("c4", { ...POLICY, retention: { kind: "always-remove" } });
		writeFileSync(join(ws.dir, "new.txt"), "x");
		const [rec] = await releaseWorkspace({ ...owner, id: "c4", policy: { ...POLICY, retention: { kind: "always-remove" } } });
		expect(rec).toMatchObject({ removed: true, reason: "always-remove" });
	}, 60_000);

	it("keep-days keeps until the sweep finds it expired", async () => {
		const policy: WorkspacePolicy = { ...POLICY, retention: { kind: "keep-days", days: 2 } };
		const ws = await create("c5", policy);
		expect((await releaseWorkspace({ ...owner, id: "c5", policy }))[0]).toMatchObject({ removed: false, reason: "keep-days" });
		const soon = await sweepWorkspaces({ ...owner, policy, isLive: () => false, now: new Date(Date.now() + 86_400_000) });
		expect(soon[0]).toMatchObject({ removed: false, reason: "keep-days" });
		const later = await sweepWorkspaces({ ...owner, policy, isLive: () => false, now: new Date(Date.now() + 3 * 86_400_000) });
		expect(later[0]).toMatchObject({ removed: true, reason: "expired" });
		expect(existsSync(ws.dir)).toBe(false);
	}, 60_000);

	it("keep-until-resolved keeps until the incident is resolved", async () => {
		const policy: WorkspacePolicy = { ...POLICY, retention: { kind: "keep-until-resolved" } };
		await create("c6", policy);
		await releaseWorkspace({ ...owner, id: "c6", policy });
		const open = await sweepWorkspaces({ ...owner, policy, isLive: () => false, isResolved: () => false });
		expect(open[0]).toMatchObject({ removed: false, reason: "keep-until-resolved" });
		const done = await sweepWorkspaces({ ...owner, policy, isLive: () => false, isResolved: () => true });
		expect(done[0]).toMatchObject({ removed: true, reason: "resolved" });
	}, 60_000);

	it("removes the oldest kept workspaces beyond the per-project cap", async () => {
		const policy: WorkspacePolicy = { ...POLICY, method: "clone", retention: { kind: "keep-until-resolved" }, keptPerProject: 2 };
		for (const id of ["k1", "k2", "k3"]) {
			await create(id, policy);
			await releaseWorkspace({ ...owner, id, policy });
			await new Promise((r) => setTimeout(r, 20));
		}
		await create("other", policy, "p2");
		const recs = await releaseWorkspace({ ...owner, id: "other", policy });
		expect(recs).toHaveLength(1);
		expect(existsSync(join(owner.parentDir, "pl-k1"))).toBe(false);
		expect(existsSync(join(owner.parentDir, "pl-k2"))).toBe(true);
		expect(existsSync(join(owner.parentDir, "pl-k3"))).toBe(true);
	}, 90_000);

	it("re-checks changes after teardown, and keeps what the teardown left", async () => {
		const policy: WorkspacePolicy = {
			...POLICY,
			teardown: both(nodeCmd("require('fs').writeFileSync('left.txt','x')")),
		};
		await create("t1", policy);
		const [rec] = await releaseWorkspace({ ...owner, id: "t1", policy });
		expect(rec).toMatchObject({ removed: false, reason: "changed" });
		expect(rec?.teardown?.status).toBe("ok");
	}, 60_000);

	it("never re-runs the teardown of a workspace already kept for its changes", async () => {
		const policy: WorkspacePolicy = {
			...POLICY,
			teardown: both(nodeCmd("require('fs').writeFileSync('left.txt','x')")),
		};
		await create("t3", policy);
		await releaseWorkspace({ ...owner, id: "t3", policy });
		const recs = await sweepWorkspaces({ ...owner, policy, isLive: () => false });
		expect(recs[0]).toMatchObject({ removed: false, reason: "changed" });
		expect(recs[0]?.teardown).toBeUndefined();
	}, 60_000);

	it("goes ahead with removal after a teardown hits its cap", async () => {
		const policy: WorkspacePolicy = { ...POLICY, teardown: both(nodeCmd("setTimeout(()=>{},20000)")) };
		await create("t2", policy);
		const [rec] = await releaseWorkspace({ ...owner, id: "t2", policy, teardownCapMs: 1_000 });
		expect(rec).toMatchObject({ removed: true, reason: "unchanged" });
		expect(rec?.teardown?.status).toBe("capped");
	}, 60_000);
});

describe("guards", () => {
	const always: WorkspacePolicy = { ...POLICY, retention: { kind: "always-remove" } };

	it("never removes a workspace locked by someone else", async () => {
		const ws = await create("g1", always);
		sh(repo, "worktree", "unlock", ws.dir);
		sh(repo, "worktree", "lock", "--reason", "someone else", ws.dir);
		const [rec] = await releaseWorkspace({ ...owner, id: "g1", policy: always });
		expect(rec).toMatchObject({ removed: false, reason: "locked-by-other" });
		expect(existsSync(ws.dir)).toBe(true);
	}, 60_000);

	it("never removes a live run's workspace in a sweep", async () => {
		const ws = await create("g2", always);
		const recs = await sweepWorkspaces({ ...owner, policy: always, isLive: (id) => id === "g2" });
		expect(recs[0]).toMatchObject({ removed: false, reason: "live" });
		expect(existsSync(ws.dir)).toBe(true);
	}, 60_000);

	it("never removes one with a nested initialised checkout", async () => {
		const ws = await create("g3", always);
		sh(join(ws.dir), "init", "-q", "nested");
		const [rec] = await releaseWorkspace({ ...owner, id: "g3", policy: always });
		expect(rec).toMatchObject({ removed: false, reason: "nested-checkout" });
	}, 60_000);

	it("never removes a shared one that other worktrees hang off", async () => {
		const ws = await create("g4", { ...always, method: "clone" });
		sh(ws.dir, "worktree", "add", "-q", "--detach", join(root, "hanger"));
		const [rec] = await releaseWorkspace({ ...owner, id: "g4", policy: always });
		expect(rec).toMatchObject({ removed: false, reason: "shared" });
	}, 60_000);

	it("never removes a symlinked entry", async () => {
		const target = join(root, "elsewhere");
		mkdirSync(target);
		writeFileSync(join(target, "keep.txt"), "x");
		mkdirSync(owner.parentDir, { recursive: true });
		try {
			symlinkSync(target, join(owner.parentDir, "pl-g5"), "junction");
		} catch {
			return; // symlinks need a privilege this machine lacks
		}
		const recs = await sweepWorkspaces({ ...owner, policy: always, isLive: () => false });
		expect(recs[0]).toMatchObject({ removed: false, reason: "symlinked" });
		expect(existsSync(join(target, "keep.txt"))).toBe(true);
	}, 60_000);

	it("sweeps only the owned prefix, never another product's entries", async () => {
		await create("dead", always);
		mkdirSync(join(owner.parentDir, "as-theirs"), { recursive: true });
		const theirs = await createWorkspace({
			parentDir: owner.parentDir,
			prefix: "as-",
			lockPrefix: "assayer ",
			id: "x",
			policy: always,
			source: { kind: "local", repo, commit },
		}).catch(() => null);
		const recs = await sweepWorkspaces({ ...owner, policy: always, isLive: () => false });
		expect(recs.map((r) => r.id)).toEqual(["dead"]);
		expect(recs[0]).toMatchObject({ removed: true });
		expect(readdirSync(owner.parentDir)).toContain("as-theirs");
		if (theirs) expect(existsSync(theirs.dir)).toBe(true);
	}, 60_000);
});

describe("policy precedence", () => {
	it("takes a project's own field over the global one, field by field", () => {
		const global: WorkspacePolicy = { method: "worktree", retention: { kind: "remove-unless-changed" }, keptPerProject: 10, submodules: "skip" };
		const { policy, inherited } = resolveWorkspacePolicy(global, { method: "clone", keptPerProject: undefined });
		expect(policy).toEqual({ method: "clone", retention: { kind: "remove-unless-changed" }, keptPerProject: 10, submodules: "skip" });
		expect(inherited.sort()).toEqual(["keptPerProject", "retention", "submodules"]);
	});

	it("lets the sweep apply each project's own policy", async () => {
		await create("pp1", POLICY, "keep-me");
		await create("pp2", POLICY, "drop-me");
		const recs = await sweepWorkspaces({
			...owner,
			isLive: () => false,
			policy: (project) =>
				project === "keep-me" ? { ...POLICY, retention: { kind: "keep-until-resolved" } } : { ...POLICY, retention: { kind: "always-remove" } },
		});
		const byId = Object.fromEntries(recs.map((r) => [r.id, r]));
		expect(byId.pp1).toMatchObject({ removed: false, reason: "keep-until-resolved" });
		expect(byId.pp2).toMatchObject({ removed: true, reason: "always-remove" });
	}, 60_000);
});

describe("attempts and late releases (#918)", () => {
	const always: WorkspacePolicy = { ...POLICY, retention: { kind: "always-remove" } };
	const list = () => sh(repo, "worktree", "list", "--porcelain");

	it("names the lock after the product's run and the attempt", async () => {
		const ws = await createWorkspace({ ...owner, id: "a1", lockLabel: "run-1", policy: always, source: { kind: "local", repo, commit } });
		expect(ws.lock).toMatch(/^prismalens run run-1 [0-9a-f]{8}$/);
		expect(list()).toContain(`locked ${ws.lock}`);
	}, 60_000);

	it("a late release of an earlier attempt leaves the workspace a later attempt re-added", async () => {
		const first = await create("a2", always);
		await releaseWorkspace({ ...owner, id: "a2", policy: always });
		const again = await create("a2", always);
		expect(again.lock).not.toBe(first.lock);

		const [late] = await releaseWorkspace({ ...owner, id: "a2", policy: always, onlyLock: first.lock });
		expect(late).toMatchObject({ removed: false, reason: "superseded" });
		expect(existsSync(again.dir)).toBe(true);
		expect(list()).toContain(`locked ${again.lock}`);

		const [own] = await releaseWorkspace({ ...owner, id: "a2", policy: always, onlyLock: again.lock });
		expect(own).toMatchObject({ removed: true });
		expect(list()).not.toContain("prismalens run");
	}, 60_000);

	it("re-adds a worktree a crash left registered and locked, at the same path", async () => {
		const first = await create("a3", always);
		rmSync(first.dir, { recursive: true, force: true });
		rmSync(`${first.dir}.workspace.json`, { force: true });
		const again = await create("a3", always);
		expect(readFileSync(join(again.dir, "a.txt"), "utf8")).toBe("a\n");
		expect(list().match(/prismalens run a3/g)).toHaveLength(1);
	}, 60_000);

	it("names a commit git confirms missing, and keeps git's own error otherwise", async () => {
		const missing = "0123456789abcdef0123456789abcdef01234567";
		await expect(
			createWorkspace({ ...owner, id: "a4", policy: always, source: { kind: "local", repo, commit: missing } }),
		).rejects.toMatchObject({ code: "commit-missing", message: `Commit ${missing} could not be checked out from this source` });
		expect(existsSync(join(owner.parentDir, "pl-a4"))).toBe(false);
		const notRepo = join(root, "not-a-repo");
		mkdirSync(notRepo);
		await expect(
			createWorkspace({ ...owner, id: "a5", policy: always, source: { kind: "local", repo: notRepo, commit: missing } }),
		).rejects.toMatchObject({ code: "git-failed" });
	}, 60_000);

	it("a checkout cut off at any point leaves no directory and no registration behind", async () => {
		for (const [i, delay] of [0, 5, 15, 40, 80, 160].entries()) {
			const ac = new AbortController();
			setTimeout(() => ac.abort(), delay);
			const id = `k${i}`;
			const ws = await createWorkspace({ ...owner, id, policy: always, source: { kind: "local", repo, commit }, signal: ac.signal }).catch(() => null);
			if (ws) await releaseWorkspace({ ...owner, id, policy: always });
			sh(repo, "worktree", "prune");
			expect(existsSync(join(owner.parentDir, `pl-${id}`))).toBe(false);
			expect(list()).not.toMatch(/prismalens run|initializing/);
		}
	}, 120_000);

	it("one entry that cannot be removed is recorded and the sweep goes on", async () => {
		await create("s1", always);
		await create("s2", always);
		const recs = await sweepWorkspaces({
			...owner,
			policy: always,
			isLive: (id) => {
				if (id === "s1") throw Object.assign(new Error("EBUSY"), { code: "EBUSY" });
				return false;
			},
		});
		const byId = Object.fromEntries(recs.map((r) => [r.id, r]));
		expect(byId.s1).toMatchObject({ removed: false, reason: "remove-failed" });
		expect(byId.s2).toMatchObject({ removed: true });
	}, 60_000);
});
