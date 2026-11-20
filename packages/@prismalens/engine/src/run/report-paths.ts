// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

type Cites = { evidence: { source: string }[] };

/**
 * Evidence that names a file by its absolute path inside the run's own checkout, written as the
 * repo-relative path the prompt asks for: the checkout is a throwaway worktree, so the absolute
 * form names nothing once the run is cleaned up (#1085, live intake run 44797156691).
 */
export function withCwdRelativeSources<
	R extends { hypotheses: Cites[]; ruledOut?: Cites[] },
>(report: R, cwd: string): R {
	const roots = [cwd, cwd.replaceAll("\\", "/")]
		.map((r) => r.replace(/[\\/]+$/, ""))
		.filter((r, i, all) => r && all.indexOf(r) === i);
	const relative = (source: string) =>
		roots.reduce(
			(s, root) => s.split(`${root}/`).join("").split(`${root}\\`).join(""),
			source,
		);
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
