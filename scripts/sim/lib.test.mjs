// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import assert from "node:assert/strict";
import test from "node:test";
import { readyTail } from "./lib.mjs";

const API = /API running on/;
const ESC = String.fromCharCode(27);

test("a ready line followed by more than the kept tail in the same chunk still counts as ready", () => {
	const after = "x".repeat(500);
	const chunk = `INFO: PrismaLens API running on http://127.0.0.1:3001\n${after}`;
	const r = readyTail("", chunk, API);
	assert.equal(r.ready, true);
	assert.equal(r.tail, after.slice(-400));
});

test("a ready line split across two chunks counts as ready on the second", () => {
	const first = readyTail("", "INFO: PrismaLens API run", API);
	assert.equal(first.ready, false);
	assert.equal(first.tail, "INFO: PrismaLens API run");
	const second = readyTail(first.tail, "ning on http://127.0.0.1:3001", API);
	assert.equal(second.ready, true);
});

test("colour codes inside the ready line are stripped before it is matched", () => {
	const r = readyTail(
		"",
		`  ${ESC}[32m➜${ESC}[39m  ${ESC}[1mLocal${ESC}[22m:   http://localhost:3000/`,
		/Local:/,
	);
	assert.equal(r.ready, true);
	assert.equal(r.tail, "  ➜  Local:   http://localhost:3000/");
});

test("output without the ready line is not ready and keeps only its last 400 characters", () => {
	const r = readyTail("a".repeat(300), "b".repeat(300), API);
	assert.equal(r.ready, false);
	assert.equal(r.tail, `${"a".repeat(100)}${"b".repeat(300)}`);
});
