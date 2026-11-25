#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// Decides what a `CI` run has to run (#1052, #1053), so a push that needs nothing starts no runner:
//   skip    "true": the PR head tree already passed `CI`, or the PR changes only docs. Only `CI gate` runs.
//   code    "false": only CI-only paths changed, so build, unit tests, the tarball and its smoke are skipped.
//   e2e     "false": neither the frontend nor the api, nor anything they depend on, changed.
//   intake  "false": nothing the packed tarball (the `prismalens` package) is built from changed.
//   full    "true": a release PR, a change to the CLI itself, or a path the release proofs read; `proofs.yml` runs its OS, service and upgrade-chain proofs.
//   agents  "true": the engine, agent-host or agent-adapters closure changed; the qualification legs run (`proofs.yml`).
//   defer   "true": a draft release PR; nothing runs and `CI gate` stays red until it is marked ready.
//   installer "true": `full` is on (any `scripts/install/` change turns it on), or a push or merge group; the Windows installer test runs.
//   draft   "true": a draft PR runs the fast tier only (lint, build, ubuntu unit tests); e2e, intake, full, agents and installer are off.
//           The `changes` job is then named `Plan (draft)`, and no later run accepts a draft run as proof (`countsAsProof`).
// Package paths are decided by turbo's graph (`turbo ls --affected`: the changed packages and their dependents).
// A path outside every package is looked up in OUTSIDE; one it does not name turns every tier on.
// A renamed file counts under both its names. A push to main or a merge group runs the PR tiers; the proofs run on the PR and nightly (#1023).
// ci.yml's `CI gate` allows a skip only where the plan says `false` in so many words.
import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

/** @typedef {"code" | "e2e" | "intake" | "full" | "agents" | "installer"} Tier */
/** @type {Tier[]} */
const ALL = ["code", "e2e", "intake", "full", "agents", "installer"];

/** Root-level Markdown and issue templates: nothing a build, a test or the tarball reads. */
const DOCS = [
	/^[^/]+\.md$/,
	/^\.github\/ISSUE_TEMPLATE\//,
	/^\.github\/[^/]+\.md$/,
];

/**
 * The packages whose change (or whose dependency's change, for turbo lists dependents too) requires a tier.
 * `code` is any package; `full` is the CLI's own sources (`directlyChangesCli`).
 * @type {Record<"e2e" | "intake" | "agents", string[]>}
 */
export const TIER_PACKAGES = {
	e2e: ["@prismalens/frontend", "@prismalens/api"],
	intake: ["prismalens"],
	agents: [
		"@prismalens/engine",
		"@prismalens/agent-host",
		"@prismalens/agent-adapters",
	],
};

export const DRAFT_REASON =
	"draft: the fast tier only; marking it ready runs the full plan";

/** The names of the `changes` job: `ci.yml` names it `Plan (draft)` for a draft PR, so a run's jobs tell its mode. */
export const PLAN_JOB = "Plan this run";
export const DRAFT_PLAN_JOB = "Plan (draft)";

/**
 * Whether a finished `CI` run is proof for a ready PR: its plan job ran and was not the draft one.
 * @param {string[]} jobNames the names of the run's jobs
 */
export const countsAsProof = (jobNames) =>
	jobNames.includes(PLAN_JOB) && !jobNames.includes(DRAFT_PLAN_JOB);

/**
 * The first candidate whose run is proof. `jobNamesOf` may throw; the caller then runs everything.
 * @template T
 * @param {T[]} candidates
 * @param {(candidate: T) => string[]} jobNamesOf
 * @returns {T | undefined}
 */
export const firstProof = (candidates, jobNamesOf) =>
	candidates.find((c) => countsAsProof(jobNamesOf(c)));

/** The package every release artifact is built from. */
const CLI = { name: "prismalens", path: "packages/cli" };

/**
 * What a path outside every package needs, first match wins; a path none names needs every tier.
 * @type {[RegExp, Tier[]][]}
 */
const OUTSIDE = [
	// Repo metadata no job reads.
	[/\.md$/, []],
	[/^docs\//, []],
	[/^\.github\/(ISSUE_TEMPLATE\/|assets\/|CODEOWNERS$|dependabot\.yml$)/, []],
	[
		/^(\.coderabbit\.yaml|\.worktreeinclude|biome\.json|\.editorconfig|\.gitignore|\.gitattributes|LICENSE)$/,
		[],
	],
	// Workflows: the ones that run the checks change how they run; the rest are proven in `lint`.
	[/^\.github\/workflows\/ci\.yml$/, ALL],
	[/^\.github\/workflows\/e2e-browser\.yml$/, ["code", "e2e"]],
	[/^\.github\/workflows\/(proofs|nightly)\.yml$/, ["full", "agents"]],
	[/^\.github\/workflows\//, []],
	// Scripts whose tests run in `lint` and whose behaviour only the nightly or release proofs exercise.
	[
		/^scripts\/(ci-plan|ci-gate-report|nightly-version|workflow-pins)(\.test)?\.mjs$/,
		[],
	],
	[
		/^scripts\/(agent-probe|agent-tested|agent-adapter-sdk|admission-fake)(\.test)?\.mjs$/,
		["agents"],
	],
	[/^scripts\/agent-pins\.json$/, ["agents"]],
	[
		/^scripts\/(gate-side-checks|packed-upgrade-chain)(\.test)?\.mjs$/,
		["full"],
	],
	// What every package builds from.
	[
		/^(package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|turbo\.json|tsconfig\.base\.json|patches\/.*)$/,
		["code", "e2e", "intake", "agents"],
	],
];

/** @param {string} file @returns {Tier[]} */
const outsideNeeds = (file) => OUTSIDE.find(([p]) => p.test(file))?.[1] ?? ALL;

/** The longest package path that holds the file, if any. */
const owner = (
	/** @type {{ name: string, path: string }[]} */ packages,
	/** @type {string} */ file,
) =>
	packages
		.filter((p) => file.startsWith(`${p.path}/`))
		.sort((a, b) => b.path.length - a.path.length)[0];

/** A change to the CLI's own sources: what `pl service`, `upgrade` and the rest are built from. */
const directlyChangesCli = (/** @type {string[]} */ files) =>
	files.some(
		(f) =>
			f.startsWith(`${CLI.path}/`) &&
			!/\.(md|spec\.[cm]?[jt]sx?|test\.[cm]?[jt]sx?)$/.test(f),
	);

/**
 * @typedef {{
 *   event: string,
 *   files: string[],
 *   packages?: { name: string, path: string }[],
 *   affected?: string[] | null,
 *   labels?: string[],
 *   headRef?: string,
 *   sameTreeAs?: string | null,
 *   draft?: boolean,
 *   readyOnPassedHead?: boolean,
 * }} PlanInput `affected` is turbo's list of changed packages and their dependents; `null` when turbo could not say.
 * @typedef {{ skip: boolean, code: boolean, e2e: boolean, intake: boolean, full: boolean, agents: boolean, installer: boolean, reason: string, defer?: boolean, draft?: boolean }} PlanResult
 */

/**
 * @param {PlanInput} input
 * @returns {PlanResult}
 */
export function plan(input) {
	const result = planFull(input);
	// A draft keeps `code` as computed and drops the tiers that cost a runner each; ready_for_review plans the rest.
	if (input.draft && input.event === "pull_request" && !result.skip)
		return {
			...result,
			e2e: false,
			intake: false,
			full: false,
			agents: false,
			installer: false,
			draft: true,
			reason: DRAFT_REASON,
		};
	return result;
}

/**
 * @param {PlanInput} input
 * @returns {PlanResult}
 */
function planFull({
	event,
	files,
	packages = [],
	affected = null,
	labels = [],
	headRef = "",
	sameTreeAs = null,
	draft = false,
	readyOnPassedHead = false,
}) {
	const none = {
		skip: true,
		code: false,
		e2e: false,
		intake: false,
		full: false,
		agents: false,
		installer: false,
	};
	const everything = {
		skip: false,
		code: true,
		e2e: true,
		intake: true,
		full: true,
		agents: true,
		installer: true,
	};
	if (event !== "pull_request")
		return {
			skip: false,
			code: true,
			e2e: true,
			intake: true,
			full: false,
			agents: false,
			installer: true,
			reason: `${event}: the PR checks run; the release proofs run nightly`,
		};
	// release-please rebuilds this PR on every push to main; CI waits until it is marked ready.
	if (draft && headRef.startsWith("release-please--"))
		return {
			...none,
			defer: true,
			reason: "draft release PR: CI waits until it is marked ready for review",
		};
	// "Ready for review" starts a run; a head that already passed CI as a draft has nothing left to prove.
	if (readyOnPassedHead)
		return {
			...none,
			reason: "marked ready for review: this head already passed CI",
		};
	if (sameTreeAs)
		return {
			...none,
			reason: `tree identical to ${sameTreeAs}, which already passed CI: nothing re-run. A head made with "git merge -s ours" lacks main's other changes (CONTRIBUTING.md, Landing a stack)`,
		};
	if (files.length > 0 && files.every((f) => DOCS.some((p) => p.test(f))))
		return { ...none, reason: "docs only: nothing to build or test" };
	if (files.length === 0)
		return {
			...everything,
			reason: "no changed files listed: everything runs",
		};
	const release = headRef.startsWith("release-please--");
	const forced = labels.includes("full-ci");
	if (release || forced)
		return {
			...everything,
			reason: release
				? "release PR: everything runs"
				: "label full-ci: everything runs",
		};
	// Without turbo's answer no package path can be judged, so every tier runs.
	if (affected === null)
		return {
			...everything,
			reason: "turbo could not list the affected packages: everything runs",
		};
	const outside = files.filter((f) => !owner(packages, f));
	// A package the API lists as changed but turbo does not means the two disagree on the base.
	const missed = files
		.map((f) => owner(packages, f))
		.find((p) => p && !affected.includes(p.name));
	if (missed)
		return {
			...everything,
			reason: `turbo did not list ${missed.name}, whose files changed: everything runs`,
		};
	/** @type {Set<Tier>} */
	const need = new Set(outside.flatMap(outsideNeeds));
	if (affected.length > 0) need.add("code");
	for (const tier of /** @type {const} */ (["e2e", "intake", "agents"]))
		if (TIER_PACKAGES[tier].some((p) => affected.includes(p))) need.add(tier);
	if (directlyChangesCli(files)) need.add("full");
	if (need.has("full")) need.add("installer");
	// The build is what e2e and the intake run on.
	if (need.has("e2e") || need.has("intake")) need.add("code");
	const unknown = outside.find((f) => !OUTSIDE.some(([p]) => p.test(f)));
	return {
		skip: false,
		code: need.has("code"),
		e2e: need.has("e2e"),
		intake: need.has("intake"),
		full: need.has("full"),
		agents: need.has("agents"),
		installer: need.has("installer"),
		reason: unknown
			? `${unknown} is on no plan rule: everything runs`
			: need.has("code")
				? "affected packages and path rules"
				: "CI-only paths: lint and its script tests",
	};
}

/** @param {string[]} args */
const gh = (args) =>
	execFileSync("gh", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

/**
 * The workspace's packages, or only those turbo marks affected between `base` and `head`.
 * `turbo` is the command and its leading arguments, e.g. `["pnpm", "exec", "turbo"]`.
 * @param {{ turbo: string[], cwd?: string, affected?: { base: string, head: string } }} opts
 * @returns {{ name: string, path: string }[]}
 */
export function turboPackages({ turbo, cwd, affected }) {
	const [cmd = "turbo", ...lead] = turbo;
	const out = execFileSync(
		cmd,
		[...lead, "ls", ...(affected ? ["--affected"] : []), "--output=json"],
		{
			cwd,
			encoding: "utf8",
			maxBuffer: 64 * 1024 * 1024,
			// pnpm is a .cmd shim on Windows.
			shell: process.platform === "win32" && cmd === "pnpm",
			env: {
				...process.env,
				TURBO_TELEMETRY_DISABLED: "1",
				...(affected && {
					TURBO_SCM_BASE: affected.base,
					TURBO_SCM_HEAD: affected.head,
				}),
			},
		},
	);
	// turbo prints a version banner before the JSON.
	return JSON.parse(out.slice(out.indexOf("{"))).packages.items;
}

/** The names of every job in a run; a failed lookup throws, and the caller then runs everything. */
const jobNames = (
	/** @type {NodeJS.ProcessEnv} */ env,
	/** @type {number} */ id,
) =>
	gh([
		"api",
		"--paginate",
		`repos/${env.REPO}/actions/runs/${id}/jobs?per_page=100`,
		"--jq",
		".jobs[].name",
	])
		.split("\n")
		.filter(Boolean);

/**
 * An earlier `CI` run on this PR branch that passed as a ready PR, whose head commit has the same tree, if any.
 * The run list carries each head commit's tree, as Git's own skip-if-redundant job reads it.
 */
function earlierPassWithSameTree(/** @type {NodeJS.ProcessEnv} */ env) {
	const { REPO, HEAD_SHA, HEAD_REF, HEAD_REPO } = env;
	const mine = gh([
		"api",
		`repos/${REPO}/git/commits/${HEAD_SHA}`,
		"--jq",
		".tree.sha",
	]).trim();
	const runs = JSON.parse(
		gh([
			"api",
			`repos/${REPO}/actions/workflows/ci.yml/runs?event=pull_request&status=success&per_page=50&branch=${encodeURIComponent(String(HEAD_REF))}`,
			"--jq",
			"[.workflow_runs[] | {id, sha: .head_sha, tree: .head_commit.tree_id, repo: .head_repository.full_name}]",
		]),
	);
	const hit = firstProof(
		runs.filter(
			(r) => r.repo === HEAD_REPO && r.sha !== HEAD_SHA && r.tree === mine,
		),
		(r) => jobNames(env, r.id),
	);
	return hit ? hit.sha : null;
}

/** Whether a `CI` run on exactly this head commit already succeeded as a ready PR, not as a draft. */
function headAlreadyPassed(/** @type {NodeJS.ProcessEnv} */ env) {
	const ids = JSON.parse(
		gh([
			"api",
			`repos/${env.REPO}/actions/workflows/ci.yml/runs?head_sha=${env.HEAD_SHA}&event=pull_request&status=success&per_page=100`,
			"--jq",
			"[.workflow_runs[].id]",
		]),
	);
	return firstProof(ids, (id) => jobNames(env, id)) !== undefined;
}

function main(/** @type {NodeJS.ProcessEnv} */ env) {
	const event = String(env.EVENT_NAME);
	/** @type {string[]} */
	let files = [];
	/** @type {string | null} */
	let sameTreeAs = null;
	/** @type {{ name: string, path: string }[]} */
	let packages = [];
	/** @type {string[] | null} */
	let affected = null;
	if (event === "pull_request") {
		files = gh([
			"api",
			"--paginate",
			`repos/${env.REPO}/pulls/${env.PR_NUMBER}/files`,
			"--jq",
			".[] | .filename, (.previous_filename // empty)",
		])
			.split("\n")
			.filter(Boolean);
		try {
			sameTreeAs = earlierPassWithSameTree(env);
		} catch (error) {
			// A failed lookup must cost a full run, never a skipped one.
			console.log(`tree lookup failed, running everything: ${error}`);
		}
		try {
			const turbo = (env.TURBO_CMD || "pnpm exec turbo").split(" ");
			packages = turboPackages({ turbo });
			affected = turboPackages({
				turbo,
				affected: { base: `origin/${env.BASE_REF}`, head: "HEAD" },
			}).map((p) => p.name);
		} catch (error) {
			console.log(`turbo failed, running everything: ${error}`);
			affected = null;
		}
	}
	/** @type {boolean} */
	let readyOnPassedHead = false;
	if (event === "pull_request" && env.ACTION === "ready_for_review") {
		try {
			readyOnPassedHead = headAlreadyPassed(env);
		} catch (error) {
			console.log(`pass lookup failed, running everything: ${error}`);
		}
	}
	const result = plan({
		event,
		files,
		packages,
		affected,
		labels: JSON.parse(env.LABELS || "[]"),
		headRef: env.HEAD_REF || "",
		sameTreeAs,
		draft: env.DRAFT === "true",
		readyOnPassedHead,
	});
	const lines = [
		`skip=${result.skip}`,
		`code=${result.code}`,
		`e2e=${result.e2e}`,
		`intake=${result.intake}`,
		`full=${result.full}`,
		`agents=${result.agents}`,
		`installer=${result.installer}`,
		`defer=${Boolean(result.defer)}`,
		`draft=${Boolean(result.draft)}`,
		`reason=${result.reason}`,
	];
	console.log(lines.join("\n"));
	if (env.GITHUB_OUTPUT)
		appendFileSync(env.GITHUB_OUTPUT, `${lines.join("\n")}\n`);
	if (env.GITHUB_STEP_SUMMARY)
		appendFileSync(
			env.GITHUB_STEP_SUMMARY,
			`**CI plan:** ${result.reason} (code=${result.code}, e2e=${result.e2e}, intake=${result.intake}, full=${result.full}, agents=${result.agents}, installer=${result.installer})\n`,
		);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href)
	main(process.env);
