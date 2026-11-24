// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { main, parseLabels, reportFailure } from "./report-failure.mjs";

const RUN = "https://github.com/o/r/actions/runs/9";

function fakeGh(issues, labels = ["bug", "ci"]) {
	const calls = [];
	const gh = (args) => {
		calls.push(args);
		if (args[0] === "issue" && args[1] === "list")
			return JSON.stringify(issues);
		if (args[0] === "label")
			return JSON.stringify(labels.map((name) => ({ name })));
		return "";
	};
	return { gh, calls };
}
const base = { repo: "o/r", runUrl: RUN, say: () => {} };

test("red with no issue creates one with the exact title, the body file and only the labels that exist", () => {
	const { gh, calls } = fakeGh([]);
	const result = reportFailure({
		...base,
		gh,
		title: "Audit failing",
		body: "b",
		labels: ["bug", "nope"],
		ok: false,
	});
	assert.equal(result, "created");
	const create = calls.find((c) => c[1] === "create");
	assert.deepEqual(create.slice(0, 6), [
		"issue",
		"create",
		"-R",
		"o/r",
		"--title",
		"Audit failing",
	]);
	assert.deepEqual(create.slice(-2), ["--label", "bug"]);
	assert.equal(
		readFileSync(create[create.indexOf("--body-file") + 1], "utf8"),
		"b",
	);
});

test("red with an open issue of the same title rewrites its body and creates nothing", () => {
	const { gh, calls } = fakeGh([
		{ number: 8, title: "Audit failing too", state: "OPEN" },
		{ number: 7, title: "Audit failing", state: "OPEN" },
	]);
	assert.equal(
		reportFailure({
			...base,
			gh,
			title: "Audit failing",
			body: "new",
			ok: false,
		}),
		"updated",
	);
	const edit = calls.find((c) => c[1] === "edit");
	assert.deepEqual(edit.slice(0, 5), ["issue", "edit", "7", "-R", "o/r"]);
	assert.equal(
		readFileSync(edit[edit.indexOf("--body-file") + 1], "utf8"),
		"new",
	);
	assert.equal(
		calls.some((c) => c[1] === "create"),
		false,
	);
});

test("red with only a closed issue reopens it with the run url, then rewrites it", () => {
	const { gh, calls } = fakeGh([{ number: 3, title: "T", state: "CLOSED" }]);
	assert.equal(
		reportFailure({ ...base, gh, title: "T", body: "x", ok: false }),
		"reopened",
	);
	const reopen = calls.find((c) => c[1] === "reopen");
	assert.deepEqual(reopen, [
		"issue",
		"reopen",
		"3",
		"-R",
		"o/r",
		"--comment",
		`Red again: ${RUN}`,
	]);
	const editIndex = calls.findIndex((c) => c[1] === "edit");
	assert.equal(editIndex > calls.indexOf(reopen), true);
	const edit = calls[editIndex];
	assert.deepEqual(edit.slice(0, 5), ["issue", "edit", "3", "-R", "o/r"]);
	assert.equal(
		readFileSync(edit[edit.indexOf("--body-file") + 1], "utf8"),
		"x",
	);
});

test("green closes the open issue with 'green again: <run url>'", () => {
	const { gh, calls } = fakeGh([{ number: 7, title: "T", state: "OPEN" }]);
	assert.equal(reportFailure({ ...base, gh, title: "T", ok: true }), "closed");
	assert.deepEqual(calls.at(-1), [
		"issue",
		"close",
		"7",
		"-R",
		"o/r",
		"--comment",
		`green again: ${RUN}`,
	]);
});

test("green with no open issue does nothing but look", () => {
	const { gh, calls } = fakeGh([{ number: 3, title: "T", state: "CLOSED" }]);
	assert.equal(reportFailure({ ...base, gh, title: "T", ok: true }), "none");
	assert.equal(calls.length, 1);
});

test("a dry run prints each gh call it would make and makes no write", () => {
	const { gh, calls } = fakeGh([{ number: 7, title: "T", state: "OPEN" }]);
	const said = [];
	reportFailure({
		...base,
		gh,
		title: "T",
		body: "b",
		ok: false,
		dryRun: true,
		say: (line) => said.push(line),
	});
	assert.equal(calls.length, 1);
	assert.equal(said[0], "b");
	assert.match(
		said[1],
		/^Dry run, would run: gh issue edit 7 -R o\/r --body-file /,
	);
});

test("a title with a newline is refused", () => {
	const { gh } = fakeGh([]);
	assert.throws(
		() => reportFailure({ ...base, gh, title: "a\nb", ok: false }),
		/one non-empty line/,
	);
});

test("a label with shell or flag characters is refused", () => {
	assert.deepEqual(parseLabels("bug, ci"), ["bug", "ci"]);
	assert.throws(() => parseLabels("bug,$(id)"), /refusing label "\$\(id\)"/);
});

test("batch mode reports each entry, closing the green one and opening the red one", (t) => {
	const { gh, calls } = fakeGh([{ number: 5, title: "A", state: "OPEN" }]);
	const file = join(mkdtempSync(join(tmpdir(), "batch-")), "batch.json");
	writeFileSync(
		file,
		JSON.stringify([
			{ title: "A", body: "", labels: [], ok: true },
			{ title: "B", body: "b", labels: ["bug"], ok: false },
		]),
	);
	t.mock.method(console, "log", () => {});
	main({ REPO: "o/r", RUN_URL: RUN, BATCH_FILE: file, DRY_RUN: "false" }, gh);
	assert.deepEqual(calls.find((c) => c[1] === "close").slice(0, 3), [
		"issue",
		"close",
		"5",
	]);
	assert.equal(calls.find((c) => c[1] === "create")[5], "B");
});
