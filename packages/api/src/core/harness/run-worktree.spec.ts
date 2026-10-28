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
	// Most cases read Remove unless changed; the default has its own case.
	global = { ...DEFAULT_RUN_WORKSPACE_SETTINGS, retention: { kind: "remove-unless-changed" } };
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
		global = { ...global, method: "worktree", submodules: "recursive" };
		overrides.set("id-svc", { method: "clone" });
		const s = settingsFor("id-svc");
		expect(s.method).toBe("clone");
		expect(s.submodules).toBe("recursive");
		expect(settingsFor("id-other").method).toBe("worktree");
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
	it("by default keeps even a clean workspace until its incident is resolved", async () => {
		global = { ...DEFAULT_RUN_WORKSPACE_SETTINGS };
		const { dest } = await run("r1", initRepo());
		await end("r1");
		await sweepRunWorktrees({ isResolved: () => false });
		expect(existsSync(dest)).toBe(true);
		expect(recorded.at(-1)).toMatchObject({ removed: false, reason: "keep-until-resolved" });
	});

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

	it("the hourly sweep keeps a pending follow-up's kept workspace past its keep-days", async () => {
		global = { ...global, retention: { kind: "keep-days", days: 2 } };
		const { dest } = await run("r1", initRepo());
		await end("r1");
		const old = new Date(Date.now() - 3 * 86_400_000).toISOString();
		writeFileSync(`${dest}.workspace.json`, JSON.stringify({ ...sidecar(dest), keptAt: old }));
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

describe("no automatic cap (#925)", () => {
	it("never removes a kept workspace for count alone, past 10 for one service", async () => {
		global = { ...global, retention: { kind: "keep-days", days: 30 } };
		const repo = initRepo();
		const dests: string[] = [];
		for (let i = 0; i < 11; i++) {
			dests.push((await run(`r${i}`, repo)).dest);
			await end(`r${i}`);
		}
		await sweepRunWorktrees({ isLive: () => false });
		expect(dests.filter((d) => existsSync(d))).toHaveLength(11);
		expect(keptWorkspaces()).toHaveLength(11);
		expect(recorded.filter((r) => r.removed)).toEqual([]);
	});
});

describe("a run a restart interrupted (#981)", () => {
	/** The process died mid-run: the run's own end never released its workspace. */
	async function cutOff(id: string) {
		const { dest } = await run(id, initRepo());
		writeFileSync(join(dest, "a.txt"), "agent's edit");
		unbindRun(id);
		return dest;
	}

	it("its workspace survives the boot sweep and the hourly one until it is resumed", async () => {
		global = { ...global, retention: { kind: "always-remove" } };
		const dest = await cutOff("r1");
		await sweepRunWorktrees({ isInterrupted: (id) => id === "r1" });
		expect(readFileSync(join(dest, "a.txt"), "utf8")).toBe("agent's edit");
		await sweepRunWorktrees({ isLive: () => false, isInterrupted: (id) => id === "r1" });
		expect(existsSync(dest)).toBe(true);
		// Resumed (or, with #987, skipped): its own rule applies again.
		await sweepRunWorktrees({ isInterrupted: () => false });
		expect(existsSync(dest)).toBe(false);
	});

	it("a multi-repo run's folder survives the boot sweep too", async () => {
		global = { ...global, retention: { kind: "always-remove" } };
		const repo = initRepo();
		await bindRun("r2", { incidentId: "inc", serviceName: "svc" });
		const child = join(runWorktreeDir("r2"), "api");
		await addRunWorktree(repo.dir, child, repo.head, "r2");
		unbindRun("r2");
		await sweepRunWorktrees({ isInterrupted: (id) => id === "r2" });
		expect(existsSync(join(child, "a.txt"))).toBe(true);
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

describe("Codex pass (#925)", () => {
	it("never follows a linked multi-repo run folder into its target", async () => {
		const target = join(tmp, "moved");
		const repo = initRepo();
		await bindRun("r9", { incidentId: "inc", serviceName: "svc" });
		await addRunWorktree(repo.dir, join(target, "api"), repo.head, "r9");
		unbindRun("r9");
		const link = join(tmp, "app", "worktrees", "pl-r9");
		mkdirSync(join(tmp, "app", "worktrees"), { recursive: true });
		symlinkSync(target, link, "junction");
		await releaseWorktreesIn(link);
		expect(existsSync(join(target, "api", "a.txt"))).toBe(true);
	});

	it("an earlier version's plain clone stays while it holds changes, and goes once clean", async () => {
		const repo = initRepo();
		const clone = join(tmp, "runs", "r5", "repo");
		git(["clone", "-q", repo.dir, clone], tmp);
		writeFileSync(join(clone, "a.txt"), "edited");
		await releaseWorktreesIn(clone);
		expect(readFileSync(join(clone, "a.txt"), "utf8")).toBe("edited");
		git(["checkout", "--", "a.txt"], clone);
		await releaseWorktreesIn(clone);
		expect(existsSync(clone)).toBe(false);
	});
});

describe("review round 3 (#925)", () => {
	/** A multi-repo run folder holding PrismaLens's own checkout and a worktree the user added by hand. */
	async function runFolderWithForeign() {
		global = { ...global, retention: { kind: "always-remove" } };
		const repo = initRepo();
		const folder = join(tmp, "app", "worktrees", "pl-r11");
		await bindRun("r11", { incidentId: "inc", serviceName: "svc" });
		await addRunWorktree(repo.dir, join(folder, "api"), repo.head, "r11");
		unbindRun("r11");
		const foreign = join(folder, "personal");
		git(["worktree", "add", "--detach", foreign, repo.head], repo.dir);
		return { folder, foreign, ours: join(folder, "api") };
	}

	it("run-end cleanup removes its own checkout and leaves a worktree someone else added in the run folder", async () => {
		const { folder, foreign, ours } = await runFolderWithForeign();
		await releaseWorktreesIn(folder);
		expect(existsSync(ours)).toBe(false);
		expect(existsSync(join(foreign, "a.txt"))).toBe(true);
	});

	it("a sweep leaves a worktree someone else added in the run folder", async () => {
		const { foreign, ours } = await runFolderWithForeign();
		await sweepRunWorktrees();
		expect(existsSync(ours)).toBe(false);
		expect(existsSync(join(foreign, "a.txt"))).toBe(true);
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
});
