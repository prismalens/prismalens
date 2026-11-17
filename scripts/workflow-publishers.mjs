// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// Which workflow steps can publish to npm, read from the parsed YAML with each step's working
// directory, against the only steps allowed to (#717). npm's `prismalens` comes from the
// launcher step alone; the app tarball and nightlies never publish.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";

const PUBLISHES = /\b(npm|pnpm|yarn)\s+(publish|dist-tag)\b|--publish\b/;
const PUBLISH_ACTION = /npm-publish|publish-npm|changesets\/action/;

/** Every step that can publish: `{file, job, step, cwd, run, uses}`. */
export function publishSteps(dir) {
	const found = [];
	for (const file of readdirSync(dir).filter((n) => /\.ya?ml$/.test(n))) {
		const doc = parse(readFileSync(join(dir, file), "utf8")) ?? {};
		const workflowCwd = doc.defaults?.run?.["working-directory"];
		for (const [job, def] of Object.entries(doc.jobs ?? {})) {
			const jobCwd = def?.defaults?.run?.["working-directory"] ?? workflowCwd;
			for (const [i, step] of (def?.steps ?? []).entries()) {
				const run = String(step.run ?? "").trim();
				const uses = String(step.uses ?? "");
				if (!PUBLISHES.test(run) && !PUBLISH_ACTION.test(uses)) continue;
				found.push({
					file,
					job,
					step: step.name ?? `#${i + 1}`,
					cwd: step["working-directory"] ?? jobCwd ?? ".",
					run,
					uses,
				});
			}
		}
	}
	return found;
}

/** The allowed publishers: each (workflow, job, working directory) and exactly what it runs. */
export const ALLOWED = [
	{
		file: "release.yml",
		job: "npm",
		cwd: ".",
		run: 'node scripts/pack-launcher.mjs --publish --tag "$DIST_TAG"',
	},
	{
		file: "publish-agent-adapters.yml",
		job: "publish",
		cwd: "packages/@prismalens/agent-adapters",
		run: 'npm publish "$(node scripts/pack.mjs | tail -1)" --access public --provenance',
	},
	{
		file: "publish-agent-host.yml",
		job: "publish",
		cwd: "packages/@prismalens/agent-host",
		run: 'pnpm pack --pack-destination "$RUNNER_TEMP"\nnpm publish "$RUNNER_TEMP"/prismalens-agent-host-*.tgz --access public --provenance',
	},
];

/** The publishing steps no allow-list entry matches exactly. */
export function unexpectedPublishers(dir) {
	return publishSteps(dir).filter(
		(s) =>
			s.uses ||
			!ALLOWED.some(
				(a) =>
					a.file === s.file &&
					a.job === s.job &&
					a.cwd === s.cwd &&
					a.run === s.run,
			),
	);
}
