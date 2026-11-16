// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import {
	type DetailsRow,
	cardHeight,
	densityFor,
	dockFor,
	visibleRows,
} from "./details";

describe("visibleRows", () => {
	it("keeps priorities <= 3 for full, <= 2 for compact, and <= 1 for essential", () => {
		const r1: DetailsRow = { id: "1", group: "g1", priority: 1, label: "Row 1" };
		const r2: DetailsRow = { id: "2", group: "g1", priority: 2, label: "Row 2" };
		const r3: DetailsRow = { id: "3", group: "g2", priority: 3, label: "Row 3" };
		const rows = [r1, r2, r3];

		expect(visibleRows(rows, "full")).toEqual([r1, r2, r3]);
		expect(visibleRows(rows, "compact")).toEqual([r1, r2]);
		expect(visibleRows(rows, "essential")).toEqual([r1]);
	});
});

describe("cardHeight", () => {
	it("equals 12 + 28 per one-line row + 44 per two-line row + 9 per extra group on a 3-row, 2-group fixture", () => {
		const fixture: DetailsRow[] = [
			{ id: "1", group: "g1", priority: 1, label: "Row 1" },
			{ id: "2", group: "g1", priority: 2, label: "Row 2", lines: 2 },
			{ id: "3", group: "g2", priority: 3, label: "Row 3" },
		];
		// 12 (pad) + 28 (row 1) + 44 (row 2) + 28 (row 3) + 9 (2 groups -> 1 extra gap) = 121
		expect(cardHeight(fixture)).toBe(121);
	});
});

describe("densityFor", () => {
	it("returns full, compact and essential at heights chosen from cardHeight formula, and essential when nothing fits", () => {
		const fixture: DetailsRow[] = [
			{ id: "1", group: "g1", priority: 1, label: "Row 1" },
			{ id: "2", group: "g1", priority: 2, label: "Row 2", lines: 2 },
			{ id: "3", group: "g2", priority: 3, label: "Row 3" },
		];
		// full: all 3 rows (2 groups) -> 12 + 28 + 44 + 28 + 9 = 121
		// compact: row 1, row 2 (1 group: g1) -> 12 + 28 + 44 = 84
		// essential: row 1 (1 group: g1) -> 12 + 28 = 40
		expect(densityFor(121, fixture)).toBe("full");
		expect(densityFor(84, fixture)).toBe("compact");
		expect(densityFor(40, fixture)).toBe("essential");
		expect(densityFor(39, fixture)).toBe("essential");
	});
});

describe("dockFor", () => {
	it("returns docked for 856 and button for 855", () => {
		expect(dockFor(856)).toBe("docked");
		expect(dockFor(855)).toBe("button");
	});
});
