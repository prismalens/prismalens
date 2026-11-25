// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runDir, summarize } from "./report.mjs";

/** A stamps root as `pnpm sim up` leaves it: one directory per run. */
function stampsRoot(/** @type {Record<string, number>} */ byRun) {
	const root = mkdtempSync(join(tmpdir(), "sim-report-"));
	for (const [run, value] of Object.entries(byRun)) {
		mkdirSync(join(root, run));
		writeFileSync(
			join(root, run, "home__net.slow-link.json"),
			JSON.stringify({
				version: 1,
				condition: "net.slow-link",
				walk: "home",
				sha: "abc1234",
				run,
				at: "2026-11-25T00:00:00Z",
				observed: {},
				measures: [
					{ metric: "census.liveRequestsPerMin", value, page: "home" },
				],
			}),
		);
	}
	return root;
}

const homeRequests = (/** @type {string} */ dir) =>
	summarize(dir)
		.conditions.find((c) => c.id === "net.slow-link")
		?.rows.find(
			(r) => r.metric === "census.liveRequestsPerMin" && r.page === "home",
		);

test("a stamps root reports its newest run's stamps, not none", (t) => {
	const root = stampsRoot({
		"sim-2026-11-25T13-33-17-835Z": 1230,
		"sim-2026-11-25T14-13-27-405Z": 14,
	});
	t.after(() => rmSync(root, { recursive: true, force: true }));
	assert.equal(runDir(root), join(root, "sim-2026-11-25T14-13-27-405Z"));
	const row = homeRequests(root);
	assert.equal(row?.value, 14);
	assert.equal(row?.result, "pass");
});

test("a run directory is read as given", (t) => {
	const root = stampsRoot({
		"sim-2026-11-25T13-33-17-835Z": 1230,
		"sim-2026-11-25T14-13-27-405Z": 14,
	});
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const run = join(root, "sim-2026-11-25T13-33-17-835Z");
	assert.equal(runDir(run), run);
	const row = homeRequests(run);
	assert.equal(row?.value, 1230);
	assert.equal(row?.result, "fail");
});
