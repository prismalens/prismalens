// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// The second layer behind the app tarball's `private: true` (#717): every job that can publish
// to npm runs exactly the steps workflow-publishers.json lists, nothing added, changed or
// reached through a script, composite action, reusable workflow or matrix value.
// A job can publish when a step publishes, or when it sits in release.yml, the workflow npm's
// trusted publisher for `prismalens` accepts, with an id-token to mint one.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";

const PUBLISHES = /\b(npm|pnpm|yarn)\s+(publish|dist-tag)\b|--publish\b/;
const TRUSTED_WORKFLOW = "release.yml";

export const ALLOWED_JOBS = JSON.parse(
	readFileSync(new URL("./workflow-publishers.json", import.meta.url), "utf8"),
);

const stepOf = (step, cwd) =>
	step.uses
		? { uses: String(step.uses) }
		: { run: String(step.run ?? "").trim(), cwd };

/** Jobs that can publish: `{file, job, steps}`, steps as `{uses}` or `{run, cwd}`. */
export function publishingJobs(dir) {
	const jobs = [];
	for (const file of readdirSync(dir).filter((n) => /\.ya?ml$/.test(n))) {
		const doc = parse(readFileSync(join(dir, file), "utf8")) ?? {};
		const workflowCwd = doc.defaults?.run?.["working-directory"];
		for (const [job, def] of Object.entries(doc.jobs ?? {})) {
			const cwd =
				def?.defaults?.run?.["working-directory"] ?? workflowCwd ?? ".";
			const steps = (def?.steps ?? []).map((s) =>
				stepOf(s, s["working-directory"] ?? cwd),
			);
			const token =
				(def?.permissions?.["id-token"] ?? doc.permissions?.["id-token"]) ===
				"write";
			const publishes = steps.some((s) => s.run && PUBLISHES.test(s.run));
			if (publishes || (file === TRUSTED_WORKFLOW && token))
				jobs.push({ file, job, uses: def?.uses, steps });
		}
	}
	return jobs;
}

const same = (a, b) =>
	a.uses !== undefined
		? a.uses === b.uses
		: a.run === b.run && a.cwd === b.cwd && b.uses === undefined;

/** One line per difference from the allow-list; empty when every publishing job matches it. */
export function unexpectedPublishers(dir) {
	const problems = [];
	for (const found of publishingJobs(dir)) {
		const allowed = ALLOWED_JOBS.find(
			(a) => a.file === found.file && a.job === found.job,
		);
		const where = `${found.file}:${found.job}`;
		if (!allowed) {
			problems.push(`${where} can publish and is not an allowed publisher`);
			continue;
		}
		if (found.uses) problems.push(`${where} calls ${found.uses}`);
		if (
			found.steps.length !== allowed.steps.length ||
			found.steps.some((s, i) => !same(allowed.steps[i], s))
		)
			problems.push(
				`${where} runs steps other than the allowed ones: ${JSON.stringify(
					found.steps.filter((s) => !allowed.steps.some((a) => same(a, s))),
				)}`,
			);
	}
	return problems;
}
