// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import assert from "node:assert/strict";
import {
	mkdirSync,
	mkdtempSync,
	rmSync,
	utimesSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runDir, summarize } from "./report.mjs";

/** A stamps root as `pnpm sim up` leaves it: one directory per run, each stamped a minute after the last. */
function stampsRoot(/** @type {Record<string, number>} */ byRun) {
	const root = mkdtempSync(join(tmpdir(), "sim-report-"));
	let at = Date.parse("2026-11-25T00:00:00Z") / 1000;
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
		at += 60;
		utimesSync(join(root, run, "home__net.slow-link.json"), at, at);
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

test("a run named by PRISMALENS_RUN_ID is read when it stamped last, though an older sim- run sorts after it", (t) => {
	const root = stampsRoot({
		"sim-2026-11-25T13-33-17-835Z": 1230,
		"benchmark-42": 14,
	});
	t.after(() => rmSync(root, { recursive: true, force: true }));
	assert.equal(runDir(root), join(root, "benchmark-42"));
	assert.equal(homeRequests(root)?.value, 14);
});

test("a stamps root takes the conditions from the sheet sim up writes beside it, so an unstamped one reads untested", (t) => {
	const sim = mkdtempSync(join(tmpdir(), "sim-dir-"));
	t.after(() => rmSync(sim, { recursive: true, force: true }));
	const stamps = join(sim, "stamps");
	mkdirSync(stamps);
	const run = join(stamps, "sim-2026-11-25T14-13-27-405Z");
	mkdirSync(run);
	writeFileSync(
		join(run, "home__net.slow-link.json"),
		JSON.stringify({
			version: 1,
			condition: "net.slow-link",
			walk: "home",
			sha: "abc1234",
			run: "r",
			at: "2026-11-25T00:00:00Z",
			observed: {},
			measures: [
				{ metric: "census.liveRequestsPerMin", value: 14, page: "home" },
			],
		}),
	);
	writeFileSync(
		join(sim, "sheet.json"),
		JSON.stringify({
			rows: [
				{ id: "net.slow-link" },
				{ id: "huge.diff" },
				{ id: "seed: subagents" },
			],
		}),
	);
	const s = summarize(stamps);
	assert.deepEqual(
		s.conditions.map((c) => c.id),
		["net.slow-link", "huge.diff"],
	);
	const huge = s.conditions.find((c) => c.id === "huge.diff");
	assert.deepEqual(
		huge?.rows.map((r) => [r.metric, r.result]),
		[
			["bytes.beforeFirstFile", "untested"],
			["mainThread.longestTask", "untested"],
		],
	);
});

test("a stamp rewritten in an older custom run makes that run the newest, though its directory time stays old", (t) => {
	const root = stampsRoot({
		"benchmark-42": 1230,
		"sim-2026-11-25T14-13-27-405Z": 14,
	});
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const dir = join(root, "benchmark-42");
	const stamp = join(dir, "home__net.slow-link.json");
	writeFileSync(
		stamp,
		JSON.stringify({
			version: 1,
			condition: "net.slow-link",
			walk: "home",
			sha: "abc1234",
			run: "benchmark-42",
			at: "2026-11-25T01:00:00Z",
			observed: {},
			measures: [
				{ metric: "census.liveRequestsPerMin", value: 22, page: "home" },
			],
		}),
	);
	const later = Date.parse("2026-11-26T00:00:00Z") / 1000;
	const earlier = Date.parse("2026-11-24T00:00:00Z") / 1000;
	utimesSync(stamp, later, later);
	utimesSync(dir, earlier, earlier);
	assert.equal(runDir(root), dir);
	assert.equal(homeRequests(root)?.value, 22);
});
