// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Run workspaces (#918, #925). Policy is passed in and nothing is stored, except a
 * sidecar `<dir>.workspace.json` outside the checkout: project, lock, when kept.
 */
import {
	cpSync,
	existsSync,
	lstatSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, normalize, resolve, sep } from "node:path";
import { AgentHostError } from "../errors.js";
import { type FetchCredential, git, gitEnv, gitOk } from "./git.js";
import {
	commandFor,
	type HookResult,
	type OsCommands,
	runHook,
	SETUP_SILENCE_MS,
	TEARDOWN_CAP_MS,
} from "./hooks.js";

export { type FetchCredential, gitEnv } from "./git.js";
export {
	commandFor,
	type HookResult,
	type HookStatus,
	type OsCommands,
	runHook,
	SETUP_SILENCE_MS,
	TEARDOWN_CAP_MS,
} from "./hooks.js";

export type Retention =
	| { kind: "remove-unless-changed" }
	| { kind: "always-remove" }
	| { kind: "keep-days"; days: number }
	| { kind: "keep-until-resolved" };

export interface WorkspacePolicy {
	/** For a local repo; a remote source is always fetched into a fresh repository. */
	method: "worktree" | "clone";
	retention: Retention;
	/** Kept workspaces per project; the oldest beyond it are removed. Default 10. */
	keptPerProject?: number;
	setup?: OsCommands;
	teardown?: OsCommands;
	/** Paths relative to the repo root, typically ignored files such as `.env`, copied in from a local source. */
	copyIn?: readonly string[];
	submodules?: "skip" | "top-level" | "recursive";
	branch?: { kind: "detached" } | { kind: "named"; name: string };
}

export const DEFAULT_KEPT_PER_PROJECT = 10;

export type WorkspaceSource =
	| { kind: "local"; repo: string; commit: string }
	| {
			kind: "remote";
			url: string;
			head: string;
			/** Fetched too, so `git diff base head` and `git show base:path` work. */
			base?: string;
			/** Used only on the fetch's process env, never written to `.git/config`. */
			credential?: FetchCredential;
	  };

export interface WorkspaceOwner {
	parentDir: string;
	/** Entries this product owns start with it, e.g. `pl-`. */
	prefix: string;
	/** Lock reasons this product writes start with it, e.g. `prismalens run `. */
	lockPrefix: string;
}

export interface CreateWorkspaceInput extends WorkspaceOwner {
	id: string;
	project?: string;
	source: WorkspaceSource;
	policy: WorkspacePolicy;
	/** The env git and the hooks inherit; the host's by default. */
	env?: Readonly<Record<string, string | undefined>>;
	signal?: AbortSignal;
	onOutput?: (chunk: string) => void;
	setupSilenceMs?: number;
}

export interface Workspace {
	id: string;
	dir: string;
	method: "worktree" | "clone";
	head: string;
	base?: string;
	copied: string[];
	setup?: HookResult;
}

interface Sidecar {
	id: string;
	project?: string;
	method: "worktree" | "clone";
	createdAt: string;
	lock?: string;
	keptAt?: string;
}

export const REMOVED_REASONS = [
	"unchanged",
	"always-remove",
	"expired",
	"resolved",
	"over-cap",
	"gone",
] as const;
export const KEPT_REASONS = [
	"changed",
	"keep-days",
	"keep-until-resolved",
	"live",
	"locked-by-other",
	"symlinked",
	"shared",
	"nested-checkout",
	"remove-failed",
] as const;
export type RemovalReason =
	| (typeof REMOVED_REASONS)[number]
	| (typeof KEPT_REASONS)[number];

/** One decision on one workspace, for each product's history list. */
export interface RemovalRecord {
	id: string;
	dir: string;
	project?: string;
	removed: boolean;
	reason: RemovalReason;
	at: string;
	teardown?: HookResult;
}

const sidecarPath = (dir: string) => `${dir}.workspace.json`;

function readSidecar(dir: string): Sidecar | null {
	try {
		return JSON.parse(readFileSync(sidecarPath(dir), "utf8")) as Sidecar;
	} catch {
		return null;
	}
}

function writeSidecar(dir: string, data: Sidecar): void {
	writeFileSync(sidecarPath(dir), JSON.stringify(data, null, 2));
}

export function workspaceDir(owner: WorkspaceOwner, id: string): string {
	return join(resolve(owner.parentDir), `${owner.prefix}${id}`);
}

/** The admin dir a linked worktree's `.git` file points at, or null. */
function linkedGitDir(dir: string): string | null {
	try {
		const m = /^gitdir:\s*(.+)$/m.exec(readFileSync(join(dir, ".git"), "utf8"));
		return m?.[1] ? resolve(dir, m[1].trim()) : null;
	} catch {
		return null;
	}
}

function commonDirOf(admin: string): string | null {
	try {
		return resolve(
			admin,
			readFileSync(join(admin, "commondir"), "utf8").trim(),
		);
	} catch {
		return null;
	}
}

function lockOf(dir: string, side: Sidecar | null): string | null {
	const admin = linkedGitDir(dir);
	const lockFile = admin ? join(admin, "locked") : null;
	if (lockFile && existsSync(lockFile))
		return readFileSync(lockFile, "utf8").trim();
	return side?.lock ?? null;
}

/** Uncommitted tracked changes or untracked non-ignored files; ignored files never count (#925). */
export async function isChanged(
	dir: string,
	env: Record<string, string>,
): Promise<boolean> {
	const out = await git(["status", "--porcelain", "--untracked-files=all"], {
		cwd: dir,
		env,
	});
	return out.trim().length > 0;
}

function isInside(child: string, parent: string): boolean {
	const rel = normalize(child) + sep;
	return rel.startsWith(normalize(parent) + sep);
}

/** A `.git` below the top that is not one of this workspace's own submodules. */
function hasNestedCheckout(dir: string): boolean {
	const own = [join(dir, ".git")];
	const admin = linkedGitDir(dir);
	if (admin) {
		own.push(admin);
		const common = commonDirOf(admin);
		if (common) own.push(join(common, "modules"));
	}
	const walk = (at: string): boolean => {
		let entries: import("node:fs").Dirent[];
		try {
			entries = readdirSync(at, { withFileTypes: true });
		} catch {
			return false;
		}
		for (const entry of entries) {
			const path = join(at, entry.name);
			if (entry.name === ".git") {
				if (at === dir) continue;
				if (entry.isDirectory()) return true;
				const target = linkedGitDir(at);
				if (!target || !own.some((o) => isInside(target, o))) return true;
				continue;
			}
			if (entry.isDirectory() && !entry.isSymbolicLink() && walk(path))
				return true;
		}
		return false;
	};
	return walk(dir);
}

/** A clone other worktrees hang off, so removing it would break them. */
function isShared(dir: string): boolean {
	const worktrees = join(dir, ".git", "worktrees");
	try {
		return readdirSync(worktrees).length > 0;
	} catch {
		return false;
	}
}

interface Judge {
	owner: WorkspaceOwner;
	env: Record<string, string>;
	isLive?: (id: string) => boolean;
}

/** The guard that keeps `dir`, or null when nothing does. */
function guard(
	dir: string,
	id: string,
	side: Sidecar | null,
	judge: Judge,
): RemovalReason | null {
	if (lstatSync(dir).isSymbolicLink()) return "symlinked";
	if (judge.isLive?.(id)) return "live";
	const lock = lockOf(dir, side);
	if (lock !== null && !lock.startsWith(judge.owner.lockPrefix))
		return "locked-by-other";
	if (isShared(dir)) return "shared";
	if (hasNestedCheckout(dir)) return "nested-checkout";
	return null;
}

async function removeDir(
	dir: string,
	env: Record<string, string>,
): Promise<void> {
	const admin = linkedGitDir(dir);
	const common = admin ? commonDirOf(admin) : null;
	if (admin && common && existsSync(common)) {
		// Run from the common dir: Windows refuses to delete a directory that is git's cwd.
		const opts = { cwd: common, env };
		if (existsSync(join(admin, "locked")))
			await gitOk(["worktree", "unlock", dir], opts);
		await gitOk(["worktree", "remove", "--force", "--force", dir], opts);
		rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
		await gitOk(["worktree", "prune"], opts);
	} else {
		rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
	}
	rmSync(sidecarPath(dir), { force: true });
}

function record(
	dir: string,
	id: string,
	side: Sidecar | null,
	removed: boolean,
	reason: RemovalReason,
	teardown?: HookResult,
): RemovalRecord {
	return {
		id,
		dir,
		...(side?.project ? { project: side.project } : {}),
		removed,
		reason,
		at: new Date().toISOString(),
		...(teardown ? { teardown } : {}),
	};
}

/**
 * Removes `dir` for `reason` unless a guard keeps it. Teardown runs first, capped,
 * then the guards and, when `keepIfChanged`, the change check are run again.
 */
async function removeGuarded(
	dir: string,
	id: string,
	reason: RemovalReason,
	keepIfChanged: boolean,
	policy: WorkspacePolicy,
	judge: Judge,
	teardownCapMs: number,
): Promise<RemovalRecord> {
	const side = readSidecar(dir);
	if (!existsSync(dir)) {
		rmSync(sidecarPath(dir), { force: true });
		return record(dir, id, side, true, "gone");
	}
	const blocked = guard(dir, id, side, judge);
	if (blocked) return record(dir, id, side, false, blocked);
	const cmd = commandFor(policy.teardown);
	const teardown = cmd
		? await runHook(cmd, { cwd: dir, env: judge.env, capMs: teardownCapMs })
		: undefined;
	const after = guard(dir, id, side, judge);
	if (after) return record(dir, id, side, false, after, teardown);
	if (keepIfChanged && (await isChanged(dir, judge.env).catch(() => true)))
		return record(dir, id, side, false, "changed", teardown);
	await removeDir(dir, judge.env);
	return existsSync(dir)
		? record(dir, id, side, false, "remove-failed", teardown)
		: record(dir, id, side, true, reason, teardown);
}

function unsafeCopy(rel: string): AgentHostError {
	return new AgentHostError(
		"unsafe-copy-path",
		`copy-in path must stay inside the repo: ${rel}`,
	);
}

function assertSafeRel(rel: string): void {
	const norm = normalize(rel);
	const first = norm.split(sep)[0];
	if (isAbsolute(rel) || first === "." || first === ".." || first === ".git")
		throw unsafeCopy(rel);
}

/** The text check cannot see symlinks: resolve the deepest existing parent and keep it under `root`. */
function assertRealInside(root: string, rel: string): void {
	let parent = dirname(join(root, rel));
	while (!existsSync(parent)) parent = dirname(parent);
	if (!isInside(realpathSync(parent), realpathSync(root)))
		throw unsafeCopy(rel);
}

async function pointHead(
	dir: string,
	commit: string,
	branch: WorkspacePolicy["branch"],
	env: Record<string, string>,
	signal?: AbortSignal,
): Promise<void> {
	const opts = { cwd: dir, env, ...(signal ? { signal } : {}) };
	if (branch?.kind === "named") {
		await git(["branch", "-f", branch.name, commit], opts);
		await git(["symbolic-ref", "HEAD", `refs/heads/${branch.name}`], opts);
	} else {
		await git(["update-ref", "--no-deref", "HEAD", commit], opts);
	}
	// core.longpaths: Git for Windows refuses paths past MAX_PATH without it.
	await git(
		["-c", "core.longpaths=true", "reset", "--hard", "--quiet", commit],
		opts,
	);
}

/** Checks the source out at `<parentDir>/<prefix><id>`, locked until `releaseWorkspace`. */
export async function createWorkspace(
	input: CreateWorkspaceInput,
): Promise<Workspace> {
	const dir = workspaceDir(input, input.id);
	if (existsSync(dir) || existsSync(sidecarPath(dir)))
		throw new AgentHostError(
			"workspace-exists",
			`${dir} already exists; sweep it first`,
		);
	mkdirSync(dirname(dir), { recursive: true });
	const env = gitEnv(input.env ?? process.env);
	const signal = input.signal;
	const sig = signal ? { signal } : {};
	const { policy, source } = input;
	const lock = `${input.lockPrefix}${input.id}`;
	const method = source.kind === "remote" ? "clone" : policy.method;
	const side: Sidecar = {
		id: input.id,
		...(input.project ? { project: input.project } : {}),
		method,
		createdAt: new Date().toISOString(),
	};
	let fetchEnv = env;
	try {
		if (source.kind === "local" && method === "worktree") {
			const branchArgs =
				policy.branch?.kind === "named"
					? ["-B", policy.branch.name]
					: ["--detach"];
			// --no-checkout then reset keeps the user's post-checkout hook from firing (#918).
			await git(
				["worktree", "add", ...branchArgs, "--no-checkout", dir, source.commit],
				{ cwd: source.repo, env, ...sig },
			);
			await git(
				[
					"-c",
					"core.longpaths=true",
					"reset",
					"--hard",
					"--quiet",
					source.commit,
				],
				{ cwd: dir, env, ...sig },
			);
			await git(["worktree", "lock", "--reason", lock, dir], {
				cwd: source.repo,
				env,
				...sig,
			});
		} else if (source.kind === "local") {
			await git(["clone", "--no-checkout", "--quiet", source.repo, dir], {
				cwd: dirname(dir),
				env,
				...sig,
			});
			const opts = { cwd: dir, env, ...sig };
			if (!(await gitOk(["cat-file", "-e", `${source.commit}^{commit}`], opts)))
				await git(["fetch", "--quiet", "origin", source.commit], opts);
			await pointHead(dir, source.commit, policy.branch, env, signal);
			side.lock = lock;
		} else {
			mkdirSync(dir, { recursive: true });
			await git(["init", "--quiet"], { cwd: dir, env, ...sig });
			await git(["remote", "add", "origin", source.url], {
				cwd: dir,
				env,
				...sig,
			});
			fetchEnv = gitEnv(input.env ?? process.env, source.credential);
			const shas = [source.head, ...(source.base ? [source.base] : [])];
			await git(
				["fetch", "--depth", "1", "--no-tags", "--quiet", "origin", ...shas],
				{
					cwd: dir,
					env: fetchEnv,
					...sig,
				},
			);
			for (const sha of shas)
				await git(["cat-file", "-e", `${sha}^{commit}`], {
					cwd: dir,
					env,
					...sig,
				});
			await pointHead(dir, source.head, policy.branch, env, signal);
			side.lock = lock;
		}
		writeSidecar(dir, side);

		const submodules = policy.submodules ?? "skip";
		if (submodules !== "skip")
			await git(
				[
					"submodule",
					"update",
					"--init",
					...(submodules === "recursive" ? ["--recursive"] : []),
				],
				{ cwd: dir, env: fetchEnv, ...sig },
			);

		const copied: string[] = [];
		if (source.kind === "local")
			for (const rel of policy.copyIn ?? []) {
				assertSafeRel(rel);
				const from = join(source.repo, rel);
				if (!existsSync(from)) continue;
				assertRealInside(source.repo, rel);
				assertRealInside(dir, rel);
				const to = join(dir, rel);
				if (existsSync(to) && lstatSync(to).isSymbolicLink())
					throw unsafeCopy(rel);
				cpSync(from, to, {
					recursive: true,
					force: true,
					verbatimSymlinks: true,
				});
				copied.push(rel);
			}

		const head = source.kind === "local" ? source.commit : source.head;
		const workspace: Workspace = {
			id: input.id,
			dir,
			method,
			head,
			...(source.kind === "remote" && source.base ? { base: source.base } : {}),
			copied,
		};
		const cmd = commandFor(policy.setup);
		if (cmd)
			workspace.setup = await runHook(cmd, {
				cwd: dir,
				env,
				silenceMs: input.setupSilenceMs ?? SETUP_SILENCE_MS,
				...(input.onOutput ? { onOutput: input.onOutput } : {}),
				...sig,
			});
		signal?.throwIfAborted();
		return workspace;
	} catch (err) {
		await removeDir(dir, env).catch(() => {});
		throw err;
	}
}

export interface ReleaseInput extends WorkspaceOwner {
	id: string;
	policy: WorkspacePolicy;
	env?: Readonly<Record<string, string | undefined>>;
	teardownCapMs?: number;
}

function unlock(
	dir: string,
	side: Sidecar | null,
	lockPrefix: string,
): boolean {
	const admin = linkedGitDir(dir);
	if (side?.lock?.startsWith(lockPrefix)) {
		const { lock: _drop, ...rest } = side;
		writeSidecar(dir, rest);
	}
	const lockFile = admin ? join(admin, "locked") : null;
	if (!lockFile || !existsSync(lockFile)) return true;
	if (!readFileSync(lockFile, "utf8").trim().startsWith(lockPrefix))
		return false;
	rmSync(lockFile, { force: true });
	return true;
}

async function evictOverCap(
	owner: WorkspaceOwner,
	project: string | undefined,
	policy: WorkspacePolicy,
	judge: Judge,
	teardownCapMs: number,
): Promise<RemovalRecord[]> {
	if (!project) return [];
	const cap = policy.keptPerProject ?? DEFAULT_KEPT_PER_PROJECT;
	const kept = ownedEntries(owner)
		.map(({ id, dir }) => ({ id, dir, side: readSidecar(dir) }))
		.filter((e) => e.side?.project === project && e.side.keptAt)
		.sort((a, b) => (b.side?.keptAt ?? "").localeCompare(a.side?.keptAt ?? ""));
	const out: RemovalRecord[] = [];
	for (const e of kept.slice(cap))
		out.push(
			await removeGuarded(
				e.dir,
				e.id,
				"over-cap",
				false,
				policy,
				judge,
				teardownCapMs,
			),
		);
	return out;
}

/** What a retention rule decides at run end: remove (and why), or keep (and why). */
function atRunEnd(r: Retention): {
	remove: RemovalReason | null;
	keepIfChanged: boolean;
	kept: RemovalReason;
} {
	switch (r.kind) {
		case "always-remove":
			return {
				remove: "always-remove",
				keepIfChanged: false,
				kept: "always-remove",
			};
		case "remove-unless-changed":
			return { remove: "unchanged", keepIfChanged: true, kept: "changed" };
		case "keep-days":
			return { remove: null, keepIfChanged: false, kept: "keep-days" };
		case "keep-until-resolved":
			return {
				remove: null,
				keepIfChanged: false,
				kept: "keep-until-resolved",
			};
	}
}

async function keep(
	dir: string,
	id: string,
	reason: RemovalReason,
): Promise<RemovalRecord> {
	const side = readSidecar(dir);
	if (side)
		writeSidecar(dir, {
			...side,
			keptAt: side.keptAt ?? new Date().toISOString(),
		});
	return record(dir, id, side, false, reason);
}

/** A run-end removal that a change or a failed delete stopped starts the kept clock, so the cap counts it. */
async function keptIfNotRemoved(r: RemovalRecord): Promise<RemovalRecord> {
	if (r.removed || (r.reason !== "changed" && r.reason !== "remove-failed"))
		return r;
	const kept = await keep(r.dir, r.id, r.reason);
	return r.teardown ? { ...kept, teardown: r.teardown } : kept;
}

/**
 * At run end: unlocks the workspace, applies the retention rule, then the per-project
 * cap. The first record is this workspace's; any after it are cap evictions.
 */
export async function releaseWorkspace(
	input: ReleaseInput,
): Promise<RemovalRecord[]> {
	const dir = workspaceDir(input, input.id);
	const env = gitEnv(input.env ?? process.env);
	const judge: Judge = { owner: input, env };
	const cap = input.teardownCapMs ?? TEARDOWN_CAP_MS;
	const side = readSidecar(dir);
	if (!existsSync(dir)) {
		rmSync(sidecarPath(dir), { force: true });
		return [record(dir, input.id, side, true, "gone")];
	}
	if (!lstatSync(dir).isSymbolicLink() && !unlock(dir, side, input.lockPrefix))
		return [record(dir, input.id, side, false, "locked-by-other")];
	const rule = atRunEnd(input.policy.retention);
	const first = rule.remove
		? await keptIfNotRemoved(
				await removeGuarded(
					dir,
					input.id,
					rule.remove,
					rule.keepIfChanged,
					input.policy,
					judge,
					cap,
				),
			)
		: await keep(dir, input.id, rule.kept);
	return [
		first,
		...(await evictOverCap(input, side?.project, input.policy, judge, cap)),
	];
}

function ownedEntries(owner: WorkspaceOwner): { id: string; dir: string }[] {
	const root = resolve(owner.parentDir);
	if (!existsSync(root)) return [];
	return readdirSync(root, { withFileTypes: true })
		.filter(
			(e) =>
				e.name.startsWith(owner.prefix) &&
				!e.name.endsWith(".workspace.json") &&
				(e.isDirectory() || e.isSymbolicLink()),
		)
		.map((e) => ({
			id: e.name.slice(owner.prefix.length),
			dir: join(root, e.name),
		}));
}

export interface SweepInput extends WorkspaceOwner {
	/** One policy, or the policy for a workspace's project (a per-project override). */
	policy: WorkspacePolicy | ((project: string | undefined) => WorkspacePolicy);
	/** A workspace whose run is still going is never touched. */
	isLive: (id: string) => boolean;
	/** For `keep-until-resolved`. */
	isResolved?: (id: string) => boolean;
	env?: Readonly<Record<string, string | undefined>>;
	now?: Date;
	teardownCapMs?: number;
}

/**
 * At startup and hourly: every owned entry under `parentDir`, never another
 * product's. A dead run's workspace gets its run-end rule; a kept one its expiry.
 */
export async function sweepWorkspaces(
	input: SweepInput,
): Promise<RemovalRecord[]> {
	const env = gitEnv(input.env ?? process.env);
	const judge: Judge = { owner: input, env, isLive: input.isLive };
	const cap = input.teardownCapMs ?? TEARDOWN_CAP_MS;
	const now = (input.now ?? new Date()).getTime();
	const policyOf = (project: string | undefined) =>
		typeof input.policy === "function" ? input.policy(project) : input.policy;
	const out: RemovalRecord[] = [];
	const projects = new Set<string>();
	for (const { id, dir } of ownedEntries(input)) {
		const side = readSidecar(dir);
		if (side?.project) projects.add(side.project);
		const policy = policyOf(side?.project);
		const r = policy.retention;
		if (!side?.keptAt) {
			const rule = atRunEnd(r);
			if (input.isLive(id)) {
				out.push(record(dir, id, side, false, "live"));
				continue;
			}
			if (!rule.remove) {
				// A dead run with a keep rule: unlock our own lock and start its clock now.
				if (!lstatSync(dir).isSymbolicLink())
					unlock(dir, side, input.lockPrefix);
				out.push(await keep(dir, id, rule.kept));
				continue;
			}
			out.push(
				await keptIfNotRemoved(
					await removeGuarded(
						dir,
						id,
						rule.remove,
						rule.keepIfChanged,
						policy,
						judge,
						cap,
					),
				),
			);
			continue;
		}
		const age = now - Date.parse(side.keptAt);
		if (r.kind === "keep-days" && age < r.days * 86_400_000) {
			out.push(record(dir, id, side, false, "keep-days"));
		} else if (r.kind === "keep-until-resolved" && !input.isResolved?.(id)) {
			out.push(record(dir, id, side, false, "keep-until-resolved"));
		} else {
			const reason: RemovalReason =
				r.kind === "keep-days"
					? "expired"
					: r.kind === "keep-until-resolved"
						? "resolved"
						: r.kind === "always-remove"
							? "always-remove"
							: "unchanged";
			out.push(
				await removeGuarded(
					dir,
					id,
					reason,
					r.kind === "remove-unless-changed",
					policy,
					judge,
					cap,
				),
			);
		}
	}
	for (const project of projects)
		out.push(
			...(await evictOverCap(input, project, policyOf(project), judge, cap)),
		);
	return out;
}

/** Field by field: a project's own value wins, else the global one; `inherited` names the fields that read "From global settings" (#925). */
export function resolveWorkspacePolicy(
	global: WorkspacePolicy,
	project: Partial<WorkspacePolicy> = {},
): { policy: WorkspacePolicy; inherited: (keyof WorkspacePolicy)[] } {
	const keys = new Set([
		...Object.keys(global),
		...Object.keys(project),
	]) as Set<keyof WorkspacePolicy>;
	const inherited = [...keys].filter((k) => project[k] === undefined);
	return {
		policy: {
			...global,
			...Object.fromEntries(
				Object.entries(project).filter(([, v]) => v !== undefined),
			),
		},
		inherited,
	};
}
