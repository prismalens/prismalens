// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/** What a `CI` run runs for a given push (#1052, #1053). */
import assert from "node:assert/strict";
import { test } from "node:test";
import { plan } from "./ci-plan.mjs";

const pr = (/** @type {Parameters<typeof plan>[0]} */ over) =>
	plan({ event: "pull_request", files: [], ...over });
/** The tiers in the order skip, code, e2e, intake, full, agents. */
const tiers = (/** @type {ReturnType<typeof plan>} */ p) => [
	p.skip,
	p.code,
	p.e2e,
	p.intake,
	p.full,
	p.agents,
];
const NOTHING = [true, false, false, false, false, false];

test("main runs the PR checks and leaves the release proofs to the nightly", () => {
	for (const event of ["push", "schedule"]) {
		const p = plan({ event, files: ["README.md"] });
		assert.deepEqual(tiers(p), [false, true, true, true, false, false], event);
	}
});

test("a push whose tree already passed runs nothing and names the commit", () => {
	const p = pr({ files: ["packages/cli/src/a.ts"], sameTreeAs: "abc123" });
	assert.deepEqual(tiers(p), NOTHING);
	assert.match(p.reason, /abc123/);
});

test("a docs-only PR runs nothing; a package README is not docs", () => {
	assert.deepEqual(
		tiers(pr({ files: ["README.md", "CONTRIBUTING.md"] })),
		NOTHING,
	);
	assert.equal(
		pr({ files: ["README.md", "packages/cli/README.md"] }).skip,
		false,
	);
});

test("a UI-only PR skips the tarball intake, the release proofs and the agent legs", () => {
	const p = pr({ files: ["packages/frontend/src/routes/index.tsx"] });
	assert.deepEqual(tiers(p), [false, true, true, false, false, false]);
});

test("an API PR runs the build, the browser suite and the intake, and no release proof", () => {
	const p = pr({ files: ["packages/api/src/app.module.ts"] });
	assert.deepEqual(tiers(p), [false, true, true, true, false, false]);
});

test("a CI-only PR runs lint and its script tests, and no build", () => {
	const p = pr({
		files: [".github/workflows/release.yml", "scripts/ci-plan.mjs"],
	});
	assert.deepEqual(tiers(p), [false, false, false, false, false, false]);
	assert.equal(p.reason, "CI-only paths: lint and its script tests");
});

test("a change to ci.yml or the browser workflow is built and tested, because it changes how they run", () => {
	for (const file of [
		".github/workflows/ci.yml",
		".github/workflows/e2e-browser.yml",
	])
		assert.deepEqual(
			[pr({ files: [file] }).code, pr({ files: [file] }).e2e],
			[true, true],
			file,
		);
});

test("an agent pin turns the qualification legs on without a build", () => {
	const p = pr({ files: ["scripts/agent-pins.json"] });
	assert.deepEqual(tiers(p), [false, false, false, false, false, true]);
});

test("a change to the engine or an agent's launch inputs turns the qualification legs on", () => {
	assert.equal(
		pr({ files: ["packages/@prismalens/engine/src/run/a.ts"] }).agents,
		true,
	);
	assert.equal(pr({ files: ["scripts/admission-fake.mjs"] }).agents, true);
	assert.equal(pr({ files: ["pnpm-lock.yaml"] }).agents, true);
	assert.equal(pr({ files: ["packages/api/src/a.ts"] }).agents, false);
});

test("a change to packaging or to the workflows that run the proofs turns the release proofs on", () => {
	assert.equal(pr({ files: ["scripts/pack-cli.mjs"] }).full, true);
	assert.equal(pr({ files: ["scripts/gate-side-checks.mjs"] }).full, true);
	// proofs.yml also runs the agent legs, so editing it runs those too.
	const proofs = pr({ files: [".github/workflows/proofs.yml"] });
	assert.deepEqual(tiers(proofs), [false, false, false, false, true, true]);
	assert.equal(pr({ files: ["packages/api/src/a.ts"] }).full, false);
});

test("a path on no list turns every tier on, so a new package is never skipped", () => {
	const p = pr({ files: ["packages/@prismalens/newpkg/src/a.ts"] });
	assert.deepEqual(tiers(p), [false, true, true, true, false, true]);
});

test("a renamed file counts under both names, so a source file moved into docs still runs its checks", () => {
	const p = pr({ files: ["docs/api.md", "packages/api/src/main.ts"] });
	assert.deepEqual(tiers(p), [false, true, true, true, false, false]);
});

test("a release PR and the full-ci label run the release proofs and the agent legs", () => {
	for (const over of [
		{ headRef: "release-please--branches--main" },
		{ labels: ["full-ci"] },
	]) {
		const p = pr({ files: ["packages/frontend/a.tsx"], ...over });
		assert.deepEqual([p.skip, p.full, p.agents], [false, true, true]);
	}
});

test("a draft release PR defers everything; the same PR ready, or a draft feature PR, does not", () => {
	const release = {
		headRef: "release-please--branches--main",
		files: ["package.json"],
	};
	const d = pr({ ...release, draft: true });
	assert.deepEqual(tiers(d), NOTHING);
	assert.equal(d.defer, true);
	const ready = pr({ ...release, draft: false });
	assert.deepEqual(
		[ready.skip, ready.defer, ready.full, ready.agents],
		[false, undefined, true, true],
	);
	const feature = pr({
		headRef: "feat/x",
		files: ["packages/api/src/a.ts"],
		draft: true,
	});
	assert.deepEqual([feature.skip, feature.defer], [false, undefined]);
});

test("marking a PR ready after its head passed CI runs nothing; without that pass it plans as usual", () => {
	const files = ["packages/api/src/a.ts"];
	const passed = pr({ files, readyOnPassedHead: true });
	assert.deepEqual(tiers(passed), NOTHING);
	assert.match(passed.reason, /already passed CI/);
	assert.equal(pr({ files, readyOnPassedHead: false }).skip, false);
});

test("a PR with no listed files is not mistaken for docs-only and runs every PR tier", () => {
	assert.deepEqual(tiers(pr({ files: [] })), [
		false,
		true,
		true,
		true,
		false,
		true,
	]);
});
