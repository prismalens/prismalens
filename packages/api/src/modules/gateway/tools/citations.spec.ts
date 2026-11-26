// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { executeTool, resultValue } from "@prismalens/integrations/harness";
import { describe, expect, it, vi } from "vitest";
import { type CitationsData, citationTools } from "./citations.js";

const ctx = { runId: "run-1", signal: new AbortController().signal };
const THREAD = "6a3b1c2d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const KEY_PATTERN = String.raw`key: Invalid string: must match pattern /^[\w.-]{1,120}:\d{1,9}$/`;
const TURN = {
	threadId: THREAD,
	key: "main:4",
	turn: 2,
	link: `/threads/${THREAD}#item-main%3A4`,
	body: "the turn",
};

function setup(turn: CitationsData["turn"] = async () => TURN) {
	const data = { turn: vi.fn(turn) } satisfies CitationsData;
	const [tool] = citationTools(data);
	if (!tool) throw new Error("citationTools offers no tool");
	const call = async (args: unknown) => {
		const c = await executeTool(tool, args, ctx);
		return { isError: c.isError, body: resultValue(c.output) };
	};
	return { data, call };
}

describe("pl_citation_read's input (#1195)", () => {
	it("passes the run's id with the thread and the trimmed key, and answers the turn as read", async () => {
		const { data, call } = setup();
		const r = await call({ threadId: THREAD, key: " main:4 " });
		expect(data.turn).toHaveBeenCalledWith("run-1", THREAD, "main:4");
		expect(r).toEqual({ isError: false, body: TURN });
	});

	it("answers not_found, naming the message, when the thread did not cite it", async () => {
		const { call } = setup(async () => null);
		const r = await call({ threadId: THREAD, key: "main:4" });
		expect(r).toEqual({
			isError: true,
			body: {
				error: "not_found",
				message: `No message main:4 of thread ${THREAD} was cited into this thread.`,
				next: "Pass threadId and key exactly as a citation in the user's message names them, or answer from the excerpt.",
			},
		});
	});

	it.each([
		["a thread id that is not a uuid", { threadId: "not-a-uuid", key: "main:4" }, "threadId: Invalid UUID"],
		["a key with no sequence", { threadId: THREAD, key: "main:" }, KEY_PATTERN],
		["a key with a space in its branch", { threadId: THREAD, key: "my branch:4" }, KEY_PATTERN],
		["a missing key", { threadId: THREAD }, "key: Invalid input: expected string, received undefined"],
	])("refuses %s with invalid_input and never reads", async (_what, args, issue) => {
		const { data, call } = setup();
		const r = await call(args);
		expect(r).toEqual({
			isError: true,
			body: {
				error: "invalid_input",
				message: `The arguments do not match pl_citation_read's schema: ${issue}.`,
				next: "Fix the named fields and call again with the same tool.",
			},
		});
		expect(data.turn).not.toHaveBeenCalled();
	});
});
