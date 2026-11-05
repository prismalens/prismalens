// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/** What a `CI` run runs for a given push (#1052). */
import assert from "node:assert/strict";
import { test } from "node:test";
import { plan } from "./ci-plan.mjs";

const pr = (/** @type {Parameters<typeof plan>[0]} */ over) =>
	plan({ event: "pull_request", files: [], ...over });

test("main, the nightly and the merge queue run everything", () => {
	for (const event of ["push", "schedule", "merge_group"]) {
		const p = plan({ event, files: ["README.md"] });
		assert.deepEqual([p.skip, p.full, p.agents], [false, true, true], event);
	}
});

test("a push whose tree already passed runs nothing and names the commit", () => {
	const p = pr({ files: ["packages/cli/src/a.ts"], sameTreeAs: "abc123" });
	assert.equal(p.skip, true);
	assert.match(p.reason, /abc123/);
});

test("a docs-only PR runs nothing; a package README is not docs", () => {
	assert.equal(pr({ files: ["README.md", "CONTRIBUTING.md"] }).skip, true);
	assert.equal(
		pr({ files: ["README.md", "packages/cli/README.md"] }).skip,
		false,
	);
});

test("a UI-only PR skips the release-only proofs and the agent legs", () => {
	const p = pr({ files: ["packages/frontend/src/routes/index.tsx"] });
	assert.deepEqual([p.skip, p.full, p.agents], [false, false, false]);
});

test("a change that moves the tarball or an agent's launch turns that tier on", () => {
	assert.equal(pr({ files: ["packages/cli/src/service.ts"] }).full, true);
	assert.equal(pr({ files: ["scripts/gate-side-checks.mjs"] }).full, true);
	assert.equal(
		pr({ files: ["packages/@prismalens/engine/src/run/a.ts"] }).agents,
		true,
	);
	assert.equal(pr({ files: ["scripts/admission-fake.mjs"] }).agents, true);
	assert.equal(pr({ files: ["packages/api/src/a.ts"] }).agents, false);
	assert.equal(pr({ files: ["pnpm-lock.yaml"] }).agents, true);
});

test("a release PR and the full-ci label run everything", () => {
	for (const over of [
		{ headRef: "release-please--branches--main" },
		{ labels: ["full-ci"] },
	]) {
		const p = pr({ files: ["packages/frontend/a.tsx"], ...over });
		assert.deepEqual([p.skip, p.full, p.agents], [false, true, true]);
	}
});

test("a PR with no listed files is not mistaken for docs-only", () => {
	assert.equal(pr({ files: [] }).skip, false);
});
