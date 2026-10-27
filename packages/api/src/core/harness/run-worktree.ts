// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * A local-folder run works in a `git worktree` (or a clone) of the user's repo under
 * `<location>/pl-<run>`, so the trust the user gave that repo in their agent covers
 * the run (#918, ADR 0004 §2). The checkout is agent-host's workspace (#916), made and
 * released under the user's run workspace settings (#925): global, overridden per service.
 */
import {
	existsSync,
	lstatSync,
	readdirSync,
	readFileSync,
	rmSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { Logger } from "@nestjs/common";
import {
	createWorkspace,
	type HookResult,
	protectedBy,
	type RemovalRecord,
	releaseWorkspace,
	resumeWorkspace,
	sweepWorkspaces,
	type WorkspaceInfo,
	type WorkspaceOwner,
	type WorkspacePolicy,
	workspaceInfo,
} from "@prismalens/agent-host";
import { getAppDataDir } from "@prismalens/config";
import {
	DEFAULT_RUN_WORKSPACE_SETTINGS,
	type RunWorkspaceOverride,
	type RunWorkspaceSettings,
	resolveRunWorkspaceSettings,
	type WorkspaceRemoval,
} from "@prismalens/contracts";

const logger = new Logger("RunWorktree");

export const WORKTREE_PREFIX = "pl-";
const LOCK_PREFIX = "prismalens run ";

/** Where the settings come from and where decisions go; the Nest service sets it at boot. */
export interface RunWorkspaceSource {
	global(): RunWorkspaceSettings;
	override(serviceId: string): RunWorkspaceOverride | undefined;
	/** Every location a service names or any setting ever named, so a sweep still finds their workspaces. */
	locations(): string[];
	serviceIdOf(serviceName: string): Promise<string | null>;
	record(removals: WorkspaceRemoval[]): void;
}

const NO_SOURCE: RunWorkspaceSource = {
	global: () => DEFAULT_RUN_WORKSPACE_SETTINGS,
	override: () => undefined,
	locations: () => [],
	serviceIdOf: async () => null,
	record: () => {},
};
let source: RunWorkspaceSource = NO_SOURCE;

export function setRunWorkspaceSource(next: RunWorkspaceSource | null): void {
	source = next ?? NO_SOURCE;
}

export function settingsFor(serviceId?: string | null): RunWorkspaceSettings {
	return resolveRunWorkspaceSettings(
		source.global(),
		serviceId ? source.override(serviceId) : undefined,
	).effective;
}

export function defaultWorktreeRoot(): string {
	return resolve(getAppDataDir(), "worktrees");
}

function rootOf(location: string | null): string {
	if (!location) return defaultWorktreeRoot();
	return resolve(location.replace(/^~(?=$|[\\/])/, homedir()));
}

/** Every folder a run's workspace can be under: the default, the global location, each override's. */
export function worktreeRoots(): string[] {
	const roots = [
		defaultWorktreeRoot(),
		rootOf(source.global().location),
		...source.locations().map(rootOf),
	];
	return [...new Set(roots)];
}

interface RunBinding {
	serviceId: string | null;
	settings: RunWorkspaceSettings;
	root: string;
	branch: string;
}
const runs = new Map<string, RunBinding>();

/**
 * Fixes a run's settings before its checkouts: those of its incident's service, or the
 * global ones. A follow-up whose workspace is still on disk keeps that workspace's folder.
 */
export async function bindRun(
	runId: string,
	opts: {
		serviceName?: string | null;
		incidentId: string;
		/** A follow-up's recorded workspace path: its folder stays the run's even after the location changed. */
		recorded?: string;
	},
): Promise<RunBinding> {
	const serviceId = opts.serviceName
		? await source.serviceIdOf(opts.serviceName).catch(() => null)
		: null;
	const settings = settingsFor(serviceId);
	const binding: RunBinding = {
		serviceId,
		settings,
		root:
			existingRootOf(runId) ??
			recordedRootOf(runId, opts.recorded) ??
			rootOf(settings.location),
		branch: `prismalens/${opts.incidentId}-${runId}`,
	};
	runs.set(runId, binding);
	return binding;
}

export function unbindRun(runId: string): void {
	runs.delete(runId);
}

/** The known location a recorded path sits in as `<root>/pl-<run>/...`; never one no setting named. */
function recordedRootOf(runId: string, recorded?: string): string | null {
	if (!recorded) return null;
	const roots = worktreeRoots();
	for (let dir = resolve(recorded); dirname(dir) !== dir; dir = dirname(dir))
		if (basename(dir) === `${WORKTREE_PREFIX}${runId}`)
			return roots.find((r) => samePath(r, dirname(dir))) ?? null;
	return null;
}

const samePath = (a: string, b: string) =>
	process.platform === "win32"
		? resolve(a).toLowerCase() === resolve(b).toLowerCase()
		: resolve(a) === resolve(b);

function existingRootOf(runId: string): string | null {
	return (
		worktreeRoots().find((root) =>
			existsSync(join(root, `${WORKTREE_PREFIX}${runId}`)),
		) ?? null
	);
}

/** The run's location: the bound one, the one already holding its workspace, else the global one. */
export function worktreeRoot(runId?: string): string {
	return (
		(runId && (runs.get(runId)?.root ?? existingRootOf(runId))) ||
		rootOf(source.global().location)
	);
}

/** A run's repos: the worktree itself for one local repo, the parent of each repo's folder for several. */
export function runWorktreeDir(runId: string): string {
	return join(worktreeRoot(runId), `${WORKTREE_PREFIX}${runId}`);
}

export function toPolicy(
	s: RunWorkspaceSettings,
	branch?: string,
): WorkspacePolicy {
	return {
		method: s.method,
		retention: s.retention,
		// The engine's own cap knows no live runs; enforceCap applies the setting across locations.
		keptPerProject: Number.MAX_SAFE_INTEGER,
		setup: s.setup,
		teardown: s.teardown,
		copyIn: s.copyIn,
		submodules: s.submodules,
		branch:
			s.branch === "named" && branch
				? { kind: "named", name: branch }
				: { kind: "detached" },
	};
}

/** A path as a workspace: owned by its parent folder with no prefix, so a multi-repo run's folders fit too. */
function asWorkspace(dir: string): WorkspaceOwner & { id: string } {
	return {
		parentDir: dirname(dir),
		prefix: "",
		lockPrefix: LOCK_PREFIX,
		id: basename(dir),
	};
}

function isLinkedWorktree(dir: string): boolean {
	try {
		return /^gitdir:/m.test(readFileSync(join(dir, ".git"), "utf8"));
	} catch {
		return false;
	}
}

/** A worktree, or a clone this product made: either way its sidecar or `.git` file says so. */
function isWorkspace(dir: string): boolean {
	return isLinkedWorktree(dir) || existsSync(`${dir}.workspace.json`);
}

/** A folder in a multi-repo run's folder that deleting the folder must not take: a workspace, a link, or a clone others hang off. */
function mustStay(dir: string): boolean {
	try {
		return isWorkspace(dir) || protectedBy(dir, LOCK_PREFIX) !== null;
	} catch {
		return true;
	}
}

/** The `pl-<run>` a multi-repo folder sits in, else `pl-<run>` itself: a repo may be named `pl-*` too. */
function runIdOf(dir: string): string | null {
	for (const name of [basename(dirname(dir)), basename(dir)])
		if (name.startsWith(WORKTREE_PREFIX))
			return name.slice(WORKTREE_PREFIX.length);
	return null;
}

function policyForDir(dir: string): WorkspacePolicy {
	return toPolicy(settingsFor(workspaceInfo(dir)?.project));
}

function toRemoval(r: RemovalRecord, reason?: string): WorkspaceRemoval {
	return {
		runId: runIdOf(r.dir),
		dir: r.dir,
		serviceId: r.project ?? null,
		removed: r.removed,
		reason: reason ?? r.reason,
		at: r.at,
		teardown: r.teardown ?? null,
	};
}

function report(records: RemovalRecord[], sweep: boolean): void {
	const kept = records.filter((r) => !r.removed && r.reason !== "superseded");
	for (const r of kept)
		if (
			r.reason !== "live" &&
			r.reason !== "keep-days" &&
			r.reason !== "keep-until-resolved"
		)
			logger.warn(`Kept the run workspace ${r.dir}: ${r.reason}`);
	// A sweep repeats every kept workspace's standing hourly; only what changed is worth a line.
	const worth = records.filter(
		(r) =>
			r.reason !== "superseded" &&
			(r.removed || !sweep || r.reason === "remove-failed") &&
			!(r.removed && r.reason === "gone"),
	);
	if (worth.length) source.record(worth.map((r) => toRemoval(r)));
}

export interface AddedWorktree {
	lock: string;
	setup?: HookResult;
}

/**
 * Checks `commit` out at `dest` under the run's settings, after releasing whatever an earlier
 * attempt left there; a workspace kept from an earlier turn of the run is taken up again as is.
 */
export async function addRunWorktree(
	repo: string,
	dest: string,
	commit: string,
	runId: string,
	signal?: AbortSignal,
	opts: {
		onOutput?: (chunk: string) => void;
		/** `repo` is a URL's shared mirror: a branch in it would be pruned by its next fetch. */
		mirror?: boolean;
	} = {},
): Promise<AddedWorktree> {
	// A cap or Remove already deciding on this folder finishes first; a follow-up never resumes mid-removal.
	await removing.get(dest);
	const resumed = await resumeWorkspace({
		...asWorkspace(dest),
		lockLabel: runId,
	});
	if (resumed) return resumed;
	await releaseWorktree(dest, undefined, true);
	const binding = runs.get(runId);
	const settings = binding?.settings ?? settingsFor(null);
	const workspace = await createWorkspace({
		...asWorkspace(dest),
		lockLabel: runId,
		...(binding?.serviceId ? { project: binding.serviceId } : {}),
		source: { kind: "local", repo, commit },
		policy: toPolicy(
			settings,
			opts.mirror && settings.method === "worktree"
				? undefined
				: binding?.branch,
		),
		...(signal ? { signal } : {}),
		...(opts.onOutput ? { onOutput: opts.onOutput } : {}),
	});
	return {
		lock: workspace.lock,
		...(workspace.setup ? { setup: workspace.setup } : {}),
	};
}

/**
 * Applies the workspace's retention rule at `dir`: removed unless a guard or the rule keeps it,
 * or, with `onlyLock`, a later attempt re-added it. `discard` removes an unfinished attempt's
 * leftover whatever the rule. True when it is gone.
 */
export async function releaseWorktree(
	dir: string,
	onlyLock?: string,
	discard = false,
): Promise<boolean> {
	const policy = policyForDir(dir);
	const records = await releaseWorkspace({
		...asWorkspace(dir),
		policy: discard
			? { ...policy, retention: { kind: "always-remove" } }
			: policy,
		...(onlyLock !== undefined ? { onlyLock } : {}),
	});
	report(records, discard);
	// A rebuild's leftover discard is not the run's end: its kept siblings stay out of the cap.
	if (!discard) await enforceCap(undefined, runIdOf(dir));
	return records[0]?.removed === true;
}

/**
 * Releases `dir` if it is a workspace, else every workspace directly inside it,
 * then deletes what is left. A kept or someone else's workspace keeps `dir`.
 */
export async function releaseWorktreesIn(
	dir: string,
	onlyLock?: string,
): Promise<void> {
	if (!existsSync(dir)) return;
	let kept = false;
	if (isWorkspace(dir)) kept = !(await releaseWorktree(dir, onlyLock));
	else {
		for (const entry of readdirSync(dir, { withFileTypes: true }))
			if (entry.isDirectory() && isWorkspace(join(dir, entry.name)))
				kept =
					!(await releaseWorktree(join(dir, entry.name), onlyLock)) || kept;
		kept ||= readdirSync(dir).some((name) => mustStay(join(dir, name)));
	}
	if (!kept) rmSync(dir, { recursive: true, force: true });
}

export interface SweepOptions {
	isLive?: (runId: string) => boolean;
	isResolved?: (runId: string) => boolean;
}

async function sweepIn(
	parentDir: string,
	prefix: string,
	opts: SweepOptions,
): Promise<RemovalRecord[]> {
	const runOf = (id: string) => (prefix ? id : (runIdOf(parentDir) ?? id));
	const records = await sweepWorkspaces({
		parentDir,
		prefix,
		lockPrefix: LOCK_PREFIX,
		policy: (project) => toPolicy(settingsFor(project)),
		// A run bound in this process is live even if it started after the caller looked.
		isLive: (id) => runs.has(runOf(id)) || (opts.isLive?.(runOf(id)) ?? false),
		isResolved: (id) => opts.isResolved?.(runOf(id)) ?? false,
	});
	return records;
}

/**
 * At boot nothing is running, so a `pl-*` entry is a dead run's, even when its lock
 * outlived the process; hourly, `isLive` names the runs still going. Each workspace gets
 * its own retention rule. Answers the run ids whose workspaces are gone.
 */
export async function sweepRunWorktrees(
	opts: SweepOptions = {},
): Promise<string[]> {
	const gone: string[] = [];
	for (const root of worktreeRoots()) {
		if (!existsSync(root)) continue;
		// A multi-repo run's folder holds a workspace per repo; it goes once none is left in it.
		for (const entry of readdirSync(root, { withFileTypes: true })) {
			const dir = join(root, entry.name);
			const runId = entry.name.slice(WORKTREE_PREFIX.length);
			if (
				!entry.isDirectory() ||
				!entry.name.startsWith(WORKTREE_PREFIX) ||
				isWorkspace(dir) ||
				runs.has(runId) ||
				opts.isLive?.(runId)
			)
				continue;
			report(await sweepIn(dir, "", opts), true);
			if (readdirSync(dir).some((name) => mustStay(join(dir, name)))) continue;
			try {
				rmSync(dir, { recursive: true, force: true });
				gone.push(runId);
			} catch (e) {
				logger.warn(`Could not sweep the run folder ${dir}`, e);
			}
		}
		const records = await sweepIn(root, WORKTREE_PREFIX, opts);
		report(
			records.filter((r) => isWorkspace(r.dir) || r.removed),
			true,
		);
		gone.push(...records.filter((r) => r.removed).map((r) => r.id));
	}
	await enforceCap(opts.isLive);
	return gone;
}

/**
 * Every kept workspace under every location, single or inside a multi-repo run's folder;
 * with `any`, also those a guard kept without starting their kept clock.
 */
export function keptWorkspaces(runId?: string, any = false): WorkspaceInfo[] {
	const out: WorkspaceInfo[] = [];
	const take = (dir: string) => {
		const info = workspaceInfo(dir);
		if (info && (any || info.keptAt)) out.push(info);
	};
	for (const root of worktreeRoots()) {
		if (!existsSync(root)) continue;
		for (const entry of readdirSync(root, { withFileTypes: true })) {
			if (
				!(entry.isDirectory() || entry.isSymbolicLink()) ||
				!entry.name.startsWith(WORKTREE_PREFIX)
			)
				continue;
			if (runId && entry.name !== `${WORKTREE_PREFIX}${runId}`) continue;
			const dir = join(root, entry.name);
			if (isWorkspace(dir)) take(dir);
			else
				for (const inner of readdirSync(dir, { withFileTypes: true }))
					if (inner.isDirectory() || inner.isSymbolicLink())
						take(join(dir, inner.name));
		}
	}
	return out;
}

/** The per-service cap across every location and layout: the oldest kept beyond it go. */
async function enforceCap(
	isLive?: (runId: string) => boolean,
	ending?: string | null,
): Promise<void> {
	const live = (dir: string) => {
		const run = runIdOf(dir);
		return !!run && run !== ending && (runs.has(run) || !!isLive?.(run));
	};
	const byProject = new Map<string, WorkspaceInfo[]>();
	for (const w of keptWorkspaces())
		if (w.project && !live(w.dir))
			byProject.set(w.project, [...(byProject.get(w.project) ?? []), w]);
	for (const [project, kept] of byProject) {
		const cap = settingsFor(project).keptPerProject;
		if (kept.length <= cap) continue;
		kept.sort((a, b) => (b.keptAt ?? "").localeCompare(a.keptAt ?? ""));
		for (const w of kept.slice(cap)) {
			// Checked again right before: a follow-up may have resumed it since the selection.
			if (live(w.dir) || !workspaceInfo(w.dir)?.keptAt) continue;
			const [r] = await whileRemoving(
				w.dir,
				releaseWorkspace({
					...asWorkspace(w.dir),
					policy: {
						...toPolicy(settingsFor(project)),
						retention: { kind: "always-remove" },
					},
				}),
			);
			if (r) source.record([toRemoval(r, r.removed ? "over-cap" : r.reason)]);
		}
	}
}

const removing = new Map<string, Promise<unknown>>();

/** Marks `dir` as being removed until `work` settles, so a follow-up waits instead of resuming it. */
function whileRemoving<T>(dir: string, work: Promise<T>): Promise<T> {
	const done = work.finally(() => removing.delete(dir));
	removing.set(
		dir,
		done.catch(() => {}),
	);
	return done;
}

/** The user's own Remove on the run page: changes and all; the other guards still hold. */
export async function removeKeptWorkspace(
	dir: string,
): Promise<{ removed: boolean; reason: string }> {
	const run = runIdOf(dir);
	if (run && runs.has(run)) return { removed: false, reason: "live" };
	const [r] = await whileRemoving(
		dir,
		releaseWorkspace({
			...asWorkspace(dir),
			policy: {
				...policyForDir(dir),
				retention: { kind: "always-remove" },
			},
		}),
	);
	if (!r) return { removed: false, reason: "gone" };
	const reason = r.removed ? "removed-by-user" : r.reason;
	source.record([toRemoval(r, reason)]);
	const parent = dirname(dir);
	if (r.removed && runIdOf(parent) && readdirSync(parent).length === 0)
		rmSync(parent, { recursive: true, force: true });
	return { removed: r.removed, reason };
}
