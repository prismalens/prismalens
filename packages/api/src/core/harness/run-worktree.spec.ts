// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/** Run workspaces under the user's settings (#925), on real git. */
import { execFileSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	symlinkSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import {
	DEFAULT_RUN_WORKSPACE_SETTINGS,
	type RunWorkspaceOverride,
	type RunWorkspaceSettings,
	type WorkspaceRemoval,
} from "@prismalens/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	addRunWorktree,
	bindRun,
	keptWorkspaces,
	releaseWorktreesIn,
	removeKeptWorkspace,
	runWorktreeDir,
	settingsFor,
	setRunWorkspaceSource,
	sweepRunWorktrees,
	unbindRun,
} from "./run-worktree.js";

const GIT_ENV = { ...process.env, GIT_TERMINAL_PROMPT: "0" };
const git = (args: string[], cwd: string) =>
	execFileSync("git", args, { cwd, env: GIT_ENV }).toString().trim();

let tmp: string;
let saved: string | undefined;
let global: RunWorkspaceSettings;
let overrides: Map<string, RunWorkspaceOverride>;
let recorded: WorkspaceRemoval[];

function initRepo(name = "repo"): { dir: string; head: string } {
	const dir = join(tmp, name);
	git(["init", "-q", "-b", "main", dir], tmp);
	writeFileSync(join(dir, "a.txt"), "v1");
	writeFileSync(join(dir, ".gitignore"), "*.log\n.env\n");
	writeFileSync(join(dir, ".env"), "SECRET=1");
	git(["add", "a.txt", ".gitignore"], dir);
	git(
		["-c", "user.email=t@t.local", "-c", "user.name=T", "commit", "-q", "-m", "init"],
		dir,
	);
	return { dir, head: git(["rev-parse", "HEAD"], dir) };
}

/** A run of `service` with one local repo, checked out under the settings. */
async function run(
	id: string,
	repo: { dir: string; head: string },
	service: string | null = "svc",
) {
	await bindRun(id, { incidentId: "inc", serviceName: service });
	const dest = runWorktreeDir(id);
	const added = await addRunWorktree(repo.dir, dest, repo.head, id);
	return { dest, added };
}

async function end(id: string) {
	await releaseWorktreesIn(runWorktreeDir(id));
	unbindRun(id);
}

function sidecar(dir: string): Record<string, string> {
	return JSON.parse(readFileSync(`${dir}.workspace.json`, "utf8"));
}

beforeEach(() => {
	tmp = mkdtempSync(join(tmpdir(), "pl-ws-"));
	saved = process.env.PRISMALENS_WORKSPACE_DIR;
	process.env.PRISMALENS_WORKSPACE_DIR = join(tmp, "app");
	global = { ...DEFAULT_RUN_WORKSPACE_SETTINGS };
	overrides = new Map();
	recorded = [];
	setRunWorkspaceSource({
		global: () => global,
		override: (id) => overrides.get(id),
		locations: () =>
			[...overrides.values()].flatMap((o) => (o.location ? [o.location] : [])),
		serviceIdOf: async (name) => `id-${name}`,
		record: (r) => recorded.push(...r),
	});
});

afterEach(() => {
	setRunWorkspaceSource(null);
	process.env.PRISMALENS_WORKSPACE_DIR = saved;
	rmSync(tmp, { recursive: true, force: true, maxRetries: 3 });
});

describe("precedence", () => {
	it("takes a service's own field over the global one, field by field", () => {
		global = { ...global, keptPerProject: 4, submodules: "recursive" };
		overrides.set("id-svc", { keptPerProject: 2 });
		const s = settingsFor("id-svc");
		expect(s.keptPerProject).toBe(2);
		expect(s.submodules).toBe("recursive");
		expect(settingsFor("id-other").keptPerProject).toBe(4);
	});

	it("puts a run's workspace in its service's location, and finds it there after the run", async () => {
		const own = join(tmp, "svc-runs");
		overrides.set("id-svc", { location: own });
		const { dest } = await run("r1", initRepo());
		expect(dest).toBe(join(own, "pl-r1"));
		unbindRun("r1");
		expect(runWorktreeDir("r1")).toBe(join(own, "pl-r1"));
		await end("r1");
	});
});

describe("retention at run end", () => {
	it("remove-unless-changed removes a clean workspace; ignored files never count", async () => {
		const { dest } = await run("r1", initRepo());
		writeFileSync(join(dest, "debug.log"), "noise");
		await end("r1");
		expect(existsSync(dest)).toBe(false);
		expect(recorded.at(-1)).toMatchObject({ runId: "r1", removed: true, reason: "unchanged" });
	});

	it("remove-unless-changed keeps an uncommitted edit, and lists it as kept", async () => {
		const { dest } = await run("r1", initRepo());
		writeFileSync(join(dest, "a.txt"), "edited");
		await end("r1");
		expect(existsSync(dest)).toBe(true);
		expect(recorded.at(-1)).toMatchObject({ removed: false, reason: "changed" });
		expect(keptWorkspaces("r1").map((w) => w.dir)).toEqual([dest]);
	});

	it("always-remove removes a changed workspace", async () => {
		global = { ...global, retention: { kind: "always-remove" } };
		const { dest } = await run("r1", initRepo());
		writeFileSync(join(dest, "new.txt"), "x");
		await end("r1");
		expect(existsSync(dest)).toBe(false);
	});

	it("keep-days keeps it until the hourly sweep finds it expired", async () => {
		global = { ...global, retention: { kind: "keep-days", days: 2 } };
		const { dest } = await run("r1", initRepo());
		await end("r1");
		await sweepRunWorktrees();
		expect(existsSync(dest)).toBe(true);
		const side = sidecar(dest);
		const old = new Date(Date.now() - 3 * 86_400_000).toISOString();
		writeFileSync(`${dest}.workspace.json`, JSON.stringify({ ...side, keptAt: old }));
		await sweepRunWorktrees();
		expect(existsSync(dest)).toBe(false);
		expect(recorded.at(-1)).toMatchObject({ removed: true, reason: "expired" });
	});

	it("keep-until-resolved keeps it until its incident is resolved", async () => {
		global = { ...global, retention: { kind: "keep-until-resolved" } };
		const { dest } = await run("r1", initRepo());
		await end("r1");
		await sweepRunWorktrees({ isResolved: () => false });
		expect(existsSync(dest)).toBe(true);
		await sweepRunWorktrees({ isResolved: (id) => id === "r1" });
		expect(existsSync(dest)).toBe(false);
		expect(recorded.at(-1)).toMatchObject({ reason: "resolved" });
	});
});

describe("guards", () => {
	it("the hourly sweep never touches a live run's workspace, even an unlisted one bound here", async () => {
		const { dest } = await run("r1", initRepo());
		await sweepRunWorktrees({ isLive: () => false });
		expect(existsSync(dest)).toBe(true);
		unbindRun("r1");
		await sweepRunWorktrees({ isLive: (id) => id === "r1" });
		expect(existsSync(dest)).toBe(true);
		await sweepRunWorktrees({ isLive: () => false });
		expect(existsSync(dest)).toBe(false);
	});

	it("never removes a worktree PrismaLens did not make", async () => {
		const repo = initRepo();
		const root = join(tmp, "app", "worktrees");
		mkdirSync(root, { recursive: true });
		const theirs = join(root, "feature");
		git(["worktree", "add", "-q", "--detach", theirs, "HEAD"], repo.dir);
		await sweepRunWorktrees();
		expect(existsSync(theirs)).toBe(true);
	});
});

describe("the per-service cap", () => {
	it("removes the oldest kept beyond it, across single and multi-repo runs", async () => {
		global = { ...global, retention: { kind: "keep-days", days: 30 }, keptPerProject: 2 };
		const a = initRepo("a");
		const b = initRepo("b");
		const first = await run("r1", a);
		await end("r1");
		// A multi-repo run keeps one folder per repo under its own.
		await bindRun("r2", { incidentId: "inc", serviceName: "svc" });
		const multi = join(runWorktreeDir("r2"), "b");
		await addRunWorktree(b.dir, multi, b.head, "r2");
		await end("r2");
		const third = await run("r3", a);
		await end("r3");
		expect(existsSync(first.dest)).toBe(false);
		expect(existsSync(multi)).toBe(true);
		expect(existsSync(third.dest)).toBe(true);
		expect(recorded.some((r) => r.runId === "r1" && r.reason === "over-cap")).toBe(true);
	});
});

describe("method, branch and copy-in", () => {
	it("clones a local folder, copies ignored files in, and names the branch after the incident and run", async () => {
		global = { ...global, method: "clone", branch: "named", copyIn: [".env"] };
		const { dest } = await run("r1", initRepo());
		expect(existsSync(join(dest, ".git", "HEAD"))).toBe(true);
		expect(readFileSync(join(dest, ".env"), "utf8")).toBe("SECRET=1");
		expect(git(["symbolic-ref", "--short", "HEAD"], dest)).toBe("prismalens/inc-r1");
		await end("r1");
		expect(existsSync(dest)).toBe(false);
	});

	it("returns the setup command's output for the run's log", async () => {
		global = {
			...global,
			setup: { posix: "echo set-up-ran && exit 3", windows: "echo set-up-ran && exit 3" },
		};
		const { added } = await run("r1", initRepo());
		expect(added.setup).toMatchObject({ status: "failed", exitCode: 3 });
		expect(added.setup?.output).toContain("set-up-ran");
		await end("r1");
	});
});

describe("a follow-up and the user's own Remove", () => {
	it("a follow-up takes a kept workspace up again, changes and all", async () => {
		const repo = initRepo();
		const { dest } = await run("r1", repo);
		writeFileSync(join(dest, "a.txt"), "agent's edit");
		await end("r1");
		const again = await addRunWorktree(repo.dir, dest, repo.head, "r1");
		expect(again.lock).toContain("prismalens run r1");
		expect(readFileSync(join(dest, "a.txt"), "utf8")).toBe("agent's edit");
		expect(sidecar(dest).keptAt).toBeUndefined();
		await end("r1");
		expect(existsSync(dest)).toBe(true);
	});

	it("Remove takes a changed workspace away and says the user did it", async () => {
		const repo = initRepo();
		const { dest } = await run("r1", repo);
		writeFileSync(join(dest, "a.txt"), "edited");
		await end("r1");
		expect(await removeKeptWorkspace(dest)).toEqual({ removed: true, reason: "removed-by-user" });
		expect(existsSync(dest)).toBe(false);
		expect(git(["worktree", "list", "--porcelain"], repo.dir)).not.toContain(basename(dest));
		expect(keptWorkspaces("r1")).toEqual([]);
	});
});

describe("review round 1 (#925)", () => {
	it("the cap never removes a kept workspace whose run is live again", async () => {
		global = { ...global, retention: { kind: "keep-days", days: 30 }, keptPerProject: 1 };
		const repo = initRepo();
		const first = await run("r1", repo);
		await end("r1");
		await bindRun("r1", { incidentId: "inc", serviceName: "svc" });
		const second = await run("r2", repo);
		await end("r2");
		await sweepRunWorktrees({ isLive: (id) => id === "r1" });
		expect(existsSync(first.dest)).toBe(true);
		expect(existsSync(second.dest)).toBe(true);
		unbindRun("r1");
	});

	it("a multi-repo run's folder stays while a clone in it has other worktrees hanging off it", async () => {
		const parent = join(tmp, "app", "worktrees", "pl-r9");
		const clone = join(parent, "api");
		mkdirSync(parent, { recursive: true });
		const repo = initRepo();
		git(["clone", "-q", repo.dir, clone], tmp);
		git(["worktree", "add", "-q", "--detach", join(tmp, "theirs"), "HEAD"], clone);
		await sweepRunWorktrees();
		expect(existsSync(join(clone, ".git"))).toBe(true);
	});

	it("a follow-up keeps its recorded folder in a location the settings no longer name", async () => {
		const old = join(tmp, "old-runs");
		global = { ...global, location: old };
		const { dest } = await run("r1", initRepo());
		await end("r1");
		global = { ...global, location: join(tmp, "new-runs") };
		overrides.set("id-past", { location: old });
		const bound = await bindRun("r1", { incidentId: "inc", serviceName: null, recorded: dest });
		expect(bound.root).toBe(old);
		unbindRun("r1");
	});

	it("lists a workspace a guard kept, not only those with a kept clock", async () => {
		global = { ...global, method: "clone", retention: { kind: "always-remove" } };
		const { dest } = await run("r1", initRepo());
		// A worktree of the clone itself: removing the clone would break it.
		git(["worktree", "add", "-q", "--detach", join(tmp, "hang"), "HEAD"], dest);
		await end("r1");
		expect(existsSync(dest)).toBe(true);
		expect(keptWorkspaces("r1")).toEqual([]);
		expect(keptWorkspaces("r1", true).map((w) => w.dir)).toEqual([dest]);
	});
});

describe("review round 2 (#925)", () => {
	it("a multi-repo run's folder stays at run end and in a sweep while a clone in it holds a set-up checkout", async () => {
		const parent = join(tmp, "app", "worktrees", "pl-r8");
		const clone = join(parent, "api");
		mkdirSync(parent, { recursive: true });
		const repo = initRepo();
		git(["clone", "-q", repo.dir, clone], tmp);
		git(["clone", "-q", repo.dir, join(clone, "vendor", "inner")], tmp);
		await releaseWorktreesIn(parent);
		await sweepRunWorktrees();
		expect(existsSync(join(clone, "vendor", "inner", ".git"))).toBe(true);
	});

	it("lists a kept workspace reached through a link", async () => {
		global = { ...global, retention: { kind: "keep-days", days: 3 } };
		const { dest } = await run("r1", initRepo());
		await end("r1");
		const link = join(tmp, "app", "worktrees", "pl-r7");
		symlinkSync(dest, link, "junction");
		writeFileSync(`${link}.workspace.json`, readFileSync(`${dest}.workspace.json`));
		expect(keptWorkspaces("r7", true).map((w) => w.dir)).toEqual([link]);
	});

	it("a rebuild's leftover discard never caps the run's kept siblings", async () => {
		global = { ...global, retention: { kind: "keep-days", days: 30 }, keptPerProject: 1 };
		const a = initRepo("a");
		const older = await run("r0", a);
		await end("r0");
		await bindRun("r1", { incidentId: "inc", serviceName: "svc" });
		const sibling = join(runWorktreeDir("r1"), "b");
		await addRunWorktree(a.dir, sibling, a.head, "r1");
		await end("r1");
		expect(existsSync(older.dest)).toBe(false);
		await bindRun("r1", { incidentId: "inc", serviceName: "svc" });
		await addRunWorktree(a.dir, join(runWorktreeDir("r1"), "c"), a.head, "r1");
		expect(existsSync(sibling)).toBe(true);
		unbindRun("r1");
	});
});
