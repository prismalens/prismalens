// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { docText, textDoc } from "@prismalens/contracts";
import { describe, expect, it } from "vitest";
import { recallList } from "../Composer";

describe("recallList (#1101 key row 13)", () => {
	it("recalls a restored thread's own messages, newest first, when this browser sent none", () => {
		expect(recallList([], ["Retries look low", "fix the timeout"]).map(docText)).toEqual([
			"Retries look low",
			"fix the timeout",
		]);
	});

	it("puts this browser's sends first and skips thread messages it already holds", () => {
		const stored = [textDoc("Retries look low"), "an older plain send"];
		expect(
			recallList(stored, ["Retries look low", "fix the timeout"]).map(docText),
		).toEqual(["Retries look low", "an older plain send", "fix the timeout"]);
	});
});
