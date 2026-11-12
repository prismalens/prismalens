// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import {
	itemEventKey,
	rowIndexOf,
	type TranscriptRowNode,
} from "./WindowedTranscript";

describe("WindowedTranscript", () => {
	it("itemEventKey: \"main-12\" gives \"main:12\", \"tools-main-12\" gives \"main:12\", \"thought-main-7\" gives \"main:7\", \"report-3\" gives \"report:3\", and \"queued-abc\" and \"thinking\" give null.", () => {
		expect(itemEventKey("main-12")).toBe("main:12");
		expect(itemEventKey("tools-main-12")).toBe("main:12");
		expect(itemEventKey("thought-main-7")).toBe("main:7");
		expect(itemEventKey("report-3")).toBe("report:3");
		expect(itemEventKey("queued-abc")).toBeNull();
		expect(itemEventKey("thinking")).toBeNull();
	});

	it("rowIndexOf(rows, key) returns the last row whose at is at or before the key. Rows with a null at are skipped.", () => {
		const rows: TranscriptRowNode[] = [
			{ key: "r0", at: null, node: null },
			{ key: "r1", at: "main:2", node: null },
			{ key: "r2", at: null, node: null },
			{ key: "r3", at: "main:5", node: null },
			{ key: "r4", at: "main:8", node: null },
		];

		// Key before any row's at
		expect(rowIndexOf(rows, "main:1")).toBe(-1);

		// Key matching r1 exactly
		expect(rowIndexOf(rows, "main:2")).toBe(1);

		// Key between r1 and r3 -> should be r1 (index 1)
		expect(rowIndexOf(rows, "main:4")).toBe(1);

		// Key matching r3
		expect(rowIndexOf(rows, "main:5")).toBe(3);

		// Key between r3 and r4
		expect(rowIndexOf(rows, "main:6")).toBe(3);

		// Key matching r4
		expect(rowIndexOf(rows, "main:8")).toBe(4);

		// Key after r4
		expect(rowIndexOf(rows, "main:10")).toBe(4);
	});
});
