// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * What a reviewer needs to judge an agent's turn without reading its diff (#1110):
 * risk flags from the changed paths, bulk files left out of the reviewed total, a
 * size gate, and the tests the turn ran. Tests, lockfiles and generated paths come from
 * the file-group registry (`lib/file-groups.ts`), as the diff tree reads them.
 */

import { FILE_GROUPS, SNAPSHOT_PATH } from "./file-groups";

export type RiskFlag =
	| "tests"
	| "ci"
	| "coverage"
	| "lockfile"
	| "migration"
	| "secrets"
	| "permissions";

const RISK: { flag: RiskFlag; re: RegExp }[] = [
	{ flag: "tests", re: FILE_GROUPS.views.tests.match as RegExp },
	{
		flag: "ci",
		re: /(^|\/)\.github\/workflows\/|(^|\/)\.gitlab-ci\.ya?ml$|(^|\/)\.circleci\/|(^|\/)Jenkinsfile$|(^|\/)azure-pipelines\.ya?ml$|(^|\/)\.buildkite\/|(^|\/)bitbucket-pipelines\.ya?ml$/i,
	},
	{
		flag: "coverage",
		re: /(^|\/)(vitest|jest|karma)\.config\.[cm]?[jt]s$|(^|\/)\.coveragerc$|(^|\/)codecov\.ya?ml$|(^|\/)\.nycrc(\.json)?$/i,
	},
	{ flag: "lockfile", re: FILE_GROUPS.views.lock.match as RegExp },
	{ flag: "migration", re: /(^|\/)migrations?\// },
	{
		flag: "secrets",
		re: /(^|\/)\.env(\.[\w.-]+)?$|(^|\/)[^/]*secrets?[^/]*$|\.(pem|key|p12)$|(^|\/)credentials[^/]*$/i,
	},
	{
		flag: "permissions",
		re: /(^|\/)(auth|permissions?|polic(y|ies)|acl|rbac|guards?)(\/|\.[\w]+$)|(^|\/)CODEOWNERS$/i,
	},
];

/** The flag's word on a card or a tree row. */
export const RISK_WORD: Record<RiskFlag, string> = {
	tests: "Tests",
	ci: "CI config",
	coverage: "Coverage",
	lockfile: "Lockfile",
	migration: "Migration",
	secrets: "Secrets",
	permissions: "Permissions",
};

export function riskFlags(path: string): RiskFlag[] {
	return RISK.filter((r) => r.re.test(path)).map((r) => r.flag);
}

/**
 * A file's flags: its path's, less Tests when the change only adds to tests, the
 * ordinary case of a turn writing tests for its code.
 */
export function fileFlags(f: ChangedFile): RiskFlag[] {
	const weakens = f.status === "deleted" || (f.status !== "added" && f.del > 0);
	return riskFlags(f.path).filter((x) => x !== "tests" || weakens);
}

export type ChangeStatus =
	| "added"
	| "modified"
	| "deleted"
	| "renamed"
	| (string & {});

export interface ChangedFile {
	path: string;
	add: number;
	del: number;
	status?: ChangeStatus;
}

/** A deleted test or a deleted CI or coverage file weakens what guards the change. */
export function blocks(f: ChangedFile): boolean {
	if (f.status !== "deleted") return false;
	return riskFlags(f.path).some(
		(x) => x === "tests" || x === "ci" || x === "coverage",
	);
}

export type NoiseKind = "lockfile" | "snapshot" | "generated" | "rename";

/** Bulk a reviewer never reads line by line; null for a file worth reading. */
export function noiseKind(f: ChangedFile): NoiseKind | null {
	if (riskFlags(f.path).includes("lockfile")) return "lockfile";
	if (SNAPSHOT_PATH.test(f.path)) return "snapshot";
	if (FILE_GROUPS.views.generated.match?.test(f.path)) return "generated";
	if (f.status === "renamed" && f.add === 0 && f.del === 0) return "rename";
	return null;
}

const NOISE_WORD: Record<NoiseKind, [string, string]> = {
	lockfile: ["lockfile", "lockfiles"],
	snapshot: ["snapshot", "snapshots"],
	generated: ["generated file", "generated files"],
	rename: ["rename", "renames"],
};

/** "1 lockfile, 2 snapshots": the bulk left out of the reviewed total. */
export function noiseLine(noise: readonly ChangedFile[]): string | null {
	const by = new Map<NoiseKind, number>();
	for (const f of noise) {
		const k = noiseKind(f);
		if (k) by.set(k, (by.get(k) ?? 0) + 1);
	}
	if (!by.size) return null;
	return Array.from(
		by,
		([k, n]) => `${n} ${NOISE_WORD[k][n === 1 ? 0 : 1]}`,
	).join(", ");
}

/** Past either, a turn is too big to judge in one read (#1110). */
export const TOO_BIG = { lines: 1000, areas: 5 } as const;

/** A path's top-level area; a monorepo package counts as its own. */
export function areaOf(path: string): string {
	const parts = path.replace(/^\.?\//, "").split("/");
	if (parts.length < 2) return ".";
	if (/^(packages|apps|services|libs|crates|modules)$/.test(parts[0] as string))
		return parts.slice(0, 2).join("/");
	return parts[0] as string;
}

export interface TurnReview {
	/** Files a reviewer reads, and their lines. */
	reviewed: { files: ChangedFile[]; add: number; del: number };
	noise: ChangedFile[];
	/** Each flag with the files that raised it, in pattern order. */
	flags: { flag: RiskFlag; paths: string[] }[];
	/** The files that weaken the checks: a deleted test, CI or coverage file. */
	blockers: string[];
	areas: number;
	tooBig: boolean;
}

export function reviewTurn(files: readonly ChangedFile[]): TurnReview {
	const reviewed = files.filter((f) => !noiseKind(f));
	const noise = files.filter((f) => noiseKind(f));
	const flags = new Map<RiskFlag, string[]>();
	for (const f of files)
		for (const flag of fileFlags(f))
			flags.set(flag, [...(flags.get(flag) ?? []), f.path]);
	const add = reviewed.reduce((n, f) => n + f.add, 0);
	const del = reviewed.reduce((n, f) => n + f.del, 0);
	const areas = new Set(reviewed.map((f) => areaOf(f.path))).size;
	return {
		reviewed: { files: reviewed, add, del },
		noise,
		flags: RISK.flatMap((r) => {
			const paths = flags.get(r.flag);
			return paths ? [{ flag: r.flag, paths }] : [];
		}),
		blockers: files.filter(blocks).map((f) => f.path),
		areas,
		tooBig: add + del > TOO_BIG.lines || areas > TOO_BIG.areas,
	};
}

const TEST_COMMAND =
	/\b(vitest|jest|mocha|ava|pytest|py\.test|rspec|phpunit|playwright test|cypress run|go test|cargo test|dotnet test|mvn (-\S+ )*test|gradle(w)? (\S+ )*test|(npm|pnpm|yarn|bun)( run)? (test|t)\b|(npm|pnpm|yarn|bun)( run)? test:\w+|deno test|bun test|node (?:\S+ )*--test|python3? -m (?:unittest|pytest)|tox|nox|rake test|swift test|zig build test|make (?:test|check)|mix test|ctest)\b/i;

export function isTestCommand(command: string): boolean {
	return TEST_COMMAND.test(command);
}

export interface TestRun {
	ok: boolean | null;
	passed: number | null;
	failed: number | null;
}

/** Counts a runner printed: "12 passed", "2 failed"; null when it printed none. */
export function testCounts(output: string | null): {
	passed: number | null;
	failed: number | null;
} {
	if (!output) return { passed: null, failed: null };
	const tail = output.slice(-4000);
	const last = (re: RegExp) => {
		const all = Array.from(tail.matchAll(re));
		const m = all.at(-1);
		return m ? Number(m[1] ?? m[2]) : null;
	};
	return {
		// "12 passed" from most runners; "ℹ pass 12" or "# pass 12" from node --test and TAP.
		passed: last(/(?:(\d+) (?:tests? )?pass(?:ed|ing)?|^\W*pass (\d+))\b/gim),
		failed: last(
			/(?:(\d+) (?:tests? )?fail(?:ed|ing|ures?)?|^\W*fail (\d+))\b/gim,
		),
	};
}

/** The turn's last run of tests decides; a run with no result yet is null. */
export function testVerdict(
	steps: readonly {
		node?: string;
		command: string;
		run?: string;
		ok: boolean | null;
		output: string | null;
	}[],
): (TestRun & { runs: number }) | null {
	const runs = steps.filter(
		(s) => s.node === "command" && isTestCommand(s.run ?? s.command),
	);
	const last = runs.at(-1);
	if (!last) return null;
	const counts = testCounts(last.output);
	const ok =
		last.ok === null ? null : last.ok && !(counts.failed && counts.failed > 0);
	return { ok, ...counts, runs: runs.length };
}

/** "Tests passed (12)", "Tests failed (2 of 14)", "Tests running". */
export function testLine(v: TestRun): string {
	if (v.ok === null) return "Tests running";
	if (v.ok) return v.passed ? `Tests passed (${v.passed})` : "Tests passed";
	if (v.failed && v.passed !== null)
		return `Tests failed (${v.failed} of ${v.failed + v.passed})`;
	return v.failed ? `Tests failed (${v.failed})` : "Tests failed";
}

/** What Ask to split puts in the composer. */
export const SPLIT_ASK =
	"This turn is too big to judge in one read. Split it into smaller steps I can review one at a time, or explain how the parts fit together.";
