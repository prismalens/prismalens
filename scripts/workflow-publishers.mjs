// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// The second layer behind the app tarball's `private: true` (#717): every job that could
// publish runs exactly what workflow-publishers.json lists, nothing added or changed.
// A job could publish when it runs a publish or a release upload, hides a command behind a
// variable or an expression, calls a reusable workflow or a local composite action, or can
// mint an id-token; the permission alone is not what the guard relies on.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";

const PUBLISHES =
	/\b(npm|pnpm|yarn|bun)\s+(publish|dist-tag)\b|--publish\b|\bgh\s+release\s+(upload|create|edit|delete)\b/;
/** A command chosen at run time: `$CMD publish`, `${{ matrix.cmd }}` as a command, `eval`. */
const INDIRECT =
	/(^|[;&|]\s*|\n\s*)(\$\{?\w+\}?|\$\{\{[^}]*\}\})\s+(publish|dist-tag|upload)\b|(^|\n)\s*\$\{\{|\beval\b/;

export const ALLOWED_JOBS = JSON.parse(
	readFileSync(new URL("./workflow-publishers.json", import.meta.url), "utf8"),
);

/** What a step does: its action and inputs, or its command and directory, and its env either way. */
const stepOf = (step, cwd) => {
	const out = step.uses
		? { uses: String(step.uses), with: step.with ?? null }
		: { run: String(step.run ?? "").trim(), cwd };
	return { ...out, env: step.env ?? null };
};

/** Jobs that could publish: `{file, job, call, steps}`, a reusable call as `{uses, with, secrets, permissions}`. */
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
			const call = def?.uses
				? {
						uses: String(def.uses),
						with: def.with ?? null,
						secrets: def.secrets ?? null,
						permissions: def.permissions ?? null,
					}
				: null;
			const token =
				(def?.permissions?.["id-token"] ?? doc.permissions?.["id-token"]) ===
				"write";
			const could =
				call ||
				token ||
				steps.some(
					(s) =>
						(s.run && (PUBLISHES.test(s.run) || INDIRECT.test(s.run))) ||
						s.uses?.startsWith("./"),
				);
			if (could) jobs.push({ file, job, call, steps });
		}
	}
	return jobs;
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** One line per difference from the allow-list; empty when every such job matches it. */
export function unexpectedPublishers(dir) {
	const problems = [];
	for (const found of publishingJobs(dir)) {
		const allowed = ALLOWED_JOBS.find(
			(a) => a.file === found.file && a.job === found.job,
		);
		const where = `${found.file}:${found.job}`;
		if (!allowed) {
			problems.push(`${where} could publish and is not an allowed job`);
			continue;
		}
		if (!same(allowed.call ?? null, found.call))
			problems.push(`${where} calls ${JSON.stringify(found.call)}`);
		if (!same(allowed.steps, found.steps))
			problems.push(
				`${where} runs steps other than the allowed ones: ${JSON.stringify(
					found.steps.filter((s) => !allowed.steps.some((a) => same(a, s))),
				)}`,
			);
	}
	return problems;
}
