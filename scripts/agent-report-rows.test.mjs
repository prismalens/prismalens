// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import assert from "node:assert/strict";
import { test } from "node:test";
import { buildBatch, rowsToBatch } from "./agent-report-rows.mjs";

const RUN = "https://run";

test("one issue per agent and OS, rows joined into its body", () => {
	const batch = rowsToBatch(
		[
			[
				"probe-failures-ubuntu-latest.tsv",
				"opencode\tlatest 1.2.3\tinitialize timed out\nopencode\tpin 1.0.0\tno session\nclaude-code\tlatest 2\tboom\n",
			],
			["probe-failures-windows-latest.tsv", "opencode\tlatest 1.2.3\tENOENT\n"],
		],
		RUN,
	);
	assert.deepEqual(
		batch.map((item) => item.title),
		[
			"Agent probe failing: opencode on ubuntu-latest",
			"Agent probe failing: claude-code on ubuntu-latest",
			"Agent probe failing: opencode on windows-latest",
		],
	);
	assert.equal(
		batch[0].body,
		"Failing rows in the last red run:\n\n- latest 1.2.3: initialize timed out\n- pin 1.0.0: no session\n\nhttps://run\n\nPosted by the agent-release-watch workflow.",
	);
	assert.equal(
		batch.every((item) => item.ok === false),
		true,
	);
});

test("an agent name or row with shell characters is refused", () => {
	assert.throws(
		() =>
			rowsToBatch([["probe-failures-linux.tsv", "a$(id)\tlatest\tx\n"]], RUN),
		/refusing a row/,
	);
	assert.throws(
		() =>
			rowsToBatch([["probe-failures-linux.tsv", "a\tlatest;rm -rf\tx\n"]], RUN),
		/refusing a row/,
	);
	assert.throws(
		() => rowsToBatch([["probe-failures-li nux.tsv", "a\tlatest\tx\n"]], RUN),
		/refusing OS name/,
	);
});

test("a red probe with no rows throws instead of reporting green", () => {
	assert.throws(
		() => buildBatch({ files: [], probeResult: "failure", runUrl: RUN }),
		/probe leg was failure but no failing row/,
	);
});

test("a green probe closes every open probe issue; a red one closes none", () => {
	const openTitles = ["Agent probe failing: opencode on ubuntu-latest"];
	assert.deepEqual(
		buildBatch({ files: [], probeResult: "success", runUrl: RUN, openTitles }),
		[
			{
				title: "Agent probe failing: opencode on ubuntu-latest",
				body: "",
				labels: [],
				ok: true,
			},
		],
	);
	const red = buildBatch({
		files: [["probe-failures-a.tsv", "x\tlatest\tbad\n"]],
		probeResult: "failure",
		runUrl: RUN,
		openTitles,
	});
	assert.deepEqual(
		red.map((item) => [item.title, item.ok]),
		[["Agent probe failing: x on a", false]],
	);
});
