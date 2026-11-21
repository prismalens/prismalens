// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

type Cites = { evidence: { source: string }[] };

// The root as a pattern that takes either separator between its segments, and only at the start
// of a path token: `/backup/work/repo` is not `/work/repo` (#1197 review).
function checkoutRootMatcher(cwd: string): (source: string) => string {
	const sep = String.raw`[\\/]`;
	const segments = cwd.split(/[\\/]+/).filter(Boolean);
	if (segments.length === 0) return (source) => source;
	const lead = /^[\\/]*/.exec(cwd)?.[0].length ?? 0;
	const body = segments.map(escapeRegExp).join(`${sep}+`);
	const root = new RegExp(
		String.raw`(?<=^|[\s"'=(,;|&<>])` +
			(lead ? `${sep}{${lead}}` : "") +
			body +
			sep,
		"g",
	);
	return (source) => source.replace(root, "");
}

const escapeRegExp = (s: string) =>
	s.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);

/**
 * Evidence that names a file by its absolute path inside the run's own checkout, written as the
 * repo-relative path the prompt asks for: the checkout is a throwaway worktree, so the absolute
 * form names nothing once the run is cleaned up (#1085, live intake run 44797156691).
 */
export function withCwdRelativeSources<
	R extends { hypotheses: Cites[]; ruledOut?: Cites[] },
>(report: R, cwd: string): R {
	const relative = checkoutRootMatcher(cwd);
	let changed = false;
	const each = <C extends Cites>(items: C[]): C[] =>
		items.map((c) => ({
			...c,
			evidence: c.evidence.map((e) => {
				const source = relative(e.source);
				if (source === e.source) return e;
				changed = true;
				return { ...e, source };
			}),
		}));
	const hypotheses = each(report.hypotheses);
	const ruledOut = report.ruledOut && each(report.ruledOut);
	if (!changed) return report;
	return { ...report, hypotheses, ...(ruledOut ? { ruledOut } : {}) };
}
