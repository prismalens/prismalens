// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Repo-relative or absolute file paths inside an evidence source, which is a
 * command or origin string ("cat config/db.yaml", "promql/engine.go:4880-4890",
 * "git show 03b0db54 -- server/models/hotlink.js"). A path needs a directory
 * part and an extension; a bare "hotlink.js" or "e.g." is not one, and a URL
 * is skipped.
 */
export function citedPaths(source) {
	const paths = [];
	for (const raw of source.split(/[\s"'`()[\]{},;]+/)) {
		if (!raw || raw.includes("://")) continue;
		const token = raw.replace(/^\.\//, "").replace(/[.:]+$/, "");
		const m =
			/^(\/?(?:[\w.-]+\/)+[\w.-]+\.[A-Za-z0-9]{1,8})(?::\d+(?:-\d+)?)?$/.exec(
				token,
			);
		if (m) paths.push(m[1]);
	}
	return paths;
}

/** Every path cited by any hypothesis's evidence in a report. */
export function reportCitedPaths(report) {
	const cited = new Set();
	for (const h of report?.hypotheses ?? []) {
		for (const e of h.evidence ?? []) {
			for (const p of citedPaths(e.source ?? "")) cited.add(p);
		}
	}
	return cited;
}
