// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import assert from "node:assert/strict";
import test from "node:test";
import { EDITED, FOLDED, rewindFailures } from "./real-agent.mjs";

const seen = { opening: "fork", want: "fork", input: { inputId: "i1" } };

test("the rewind case fails when the recorded prompt is empty, even with the expected opening (#1193)", () => {
	assert.deepEqual(rewindFailures({ ...seen, body: { parts: [] } }), [
		"the edited prompt did not carry the edited message",
	]);
});

test("the rewind case passes a prompt that carries the edit and not the folded message (#1193)", () => {
	assert.deepEqual(
		rewindFailures({
			...seen,
			body: { parts: [{ text: `Context.\n${EDITED}` }] },
		}),
		[],
	);
});

test("the rewind case fails a prompt that carries the folded message beside the edit (#1193)", () => {
	assert.deepEqual(
		rewindFailures({
			...seen,
			body: { parts: [{ text: FOLDED }, { text: EDITED }] },
		}),
		["the edited prompt carried the folded message"],
	);
});
