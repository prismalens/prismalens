// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/** What `CI gate` says about a red run (#1052). */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
	classify,
	networkFailure,
	onlyCancelled,
	queueWaits,
	rerunnable,
} from "./ci-gate-report.mjs";

const job = (
	/** @type {string} */ name,
	/** @type {string | null} */ conclusion,
	/** @type {[string, string][]} */ steps = [],
) => ({
	name,
	conclusion,
	html_url: `https://example/${name}`,
	steps: steps.map(([n, c]) => ({ name: n, conclusion: c })),
});

test("every kind of red is named, a green or skipped job is not", () => {
	const reds = classify([
		job("Build", "success", [["build", "success"]]),
		job("macOS side checks", "cancelled"),
		job("E2E", "failure", [
			["checkout", "success"],
			["Run Playwright", "failure"],
		]),
		job("Windows tests", "timed_out", [["test", "cancelled"]]),
		job("Pack", "cancelled", [
			["build", "success"],
			["pack", "cancelled"],
		]),
		job("Lint", "skipped"),
	]);
	assert.deepEqual(
		reds.map((r) => [r.kind, r.name, r.step]),
		[
			["never started", "macOS side checks", "-"],
			["failed", "E2E", "Run Playwright"],
			["timed out", "Windows tests", "test"],
			["cancelled mid-run", "Pack", "pack"],
		],
	);
});

test("only cancellations call for a plain rerun; one real failure does not", () => {
	const never = classify([job("macOS", "cancelled")]);
	const mid = classify([job("Pack", "cancelled", [["pack", "cancelled"]])]);
	const failed = classify([job("E2E", "failure", [["t", "failure"]])]);
	assert.equal(onlyCancelled(never), true);
	assert.equal(onlyCancelled([...never, ...mid]), true);
	assert.equal(onlyCancelled([...never, ...failed]), false);
	assert.equal(onlyCancelled([]), false);
});

test("the automatic rerun fires only when every red job but the gate never started", () => {
	const gate = job("CI gate", "failure", [["Assert", "failure"]]);
	const never = job("macOS", "cancelled");
	assert.equal(rerunnable(classify([never, gate])), true);
	assert.equal(rerunnable(classify([gate])), false);
	assert.equal(
		rerunnable(
			classify([never, gate, job("E2E", "failure", [["t", "failure"]])]),
		),
		false,
	);
	assert.equal(
		rerunnable(
			classify([never, gate, job("Pack", "cancelled", [["p", "cancelled"]])]),
		),
		false,
	);
});

test("a long wait for a runner is reported, a short one is not", () => {
	const at = (/** @type {string} */ t) => `2026-11-05T${t}Z`;
	const waits = queueWaits([
		{
			name: "fast",
			conclusion: "success",
			created_at: at("10:00:00"),
			started_at: at("10:00:20"),
		},
		{
			name: "slow",
			conclusion: "success",
			created_at: at("10:00:00"),
			started_at: at("10:25:30"),
		},
		{
			name: "never ran",
			conclusion: "cancelled",
			created_at: at("10:00:00"),
			started_at: null,
			completed_at: at("10:22:00"),
		},
	]);
	assert.deepEqual(waits, [
		{ name: "slow", minutes: 25 },
		{ name: "never ran", minutes: 22 },
	]);
});

test("a failed job is retried only when its log ends on a network fault, not a failed check", () => {
	const download =
		"==> Target: linux-x64\nERROR: fetch failed\n##[error]Process completed with exit code 1.";
	const reset =
		"npm error code ECONNRESET\n##[error]Process completed with exit code 1.";
	const assertion =
		"AssertionError: expected 1 to be 2\nERROR: fetch failed\n##[error]Process completed with exit code 1.";
	const smoke =
		"SMOKE FAIL: the pl up HTTP contract is broken\n##[error]Process completed with exit code 1.";
	const plain =
		"rm: cannot remove 'ws': Directory not empty\n##[error]Process completed with exit code 1.";
	assert.deepEqual(
		[download, reset, assertion, smoke, plain].map(networkFailure),
		[true, true, false, false, false],
	);

	const failed = job("Build & smoke (linux-x64)", "failure", [
		["smoke", "failure"],
	]);
	const gate = job("CI gate", "failure", [["report", "failure"]]);
	const reds = classify([failed, gate]);
	assert.equal(rerunnable(reds), false);
	assert.equal(
		rerunnable(reds, "CI gate", new Set(["Build & smoke (linux-x64)"])),
		true,
	);
	assert.equal(rerunnable(reds, "CI gate", new Set(["Some other job"])), false);
});
