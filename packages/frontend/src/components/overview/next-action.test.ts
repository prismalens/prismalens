// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it, vi } from "vitest";
import { nextHandler } from "./next-action";
import type { Overview } from "./use-overview";

const page = () => ({
	investigate: vi.fn(),
	ask: vi.fn(),
	resume: vi.fn(),
	watch: vi.fn(),
	commandRef: { current: null },
});

describe("nextHandler", () => {
	it("hands start, resume, ask and watch to the page, and Retry starts like Investigate", () => {
		const p = page();
		const on = nextHandler({ current: null } as unknown as Overview, p);
		on("resume");
		on("retry");
		on("ask");
		on("watch");
		expect(p.resume).toHaveBeenCalledTimes(1);
		expect(p.investigate).toHaveBeenCalledTimes(1);
		expect(p.ask).toHaveBeenCalledTimes(1);
		expect(p.watch).toHaveBeenCalledTimes(1);
	});

	it("resolves through the record and applies the current fix", () => {
		const openClose = vi.fn();
		const apply = vi.fn();
		const opt = { id: "f1" };
		const on = nextHandler(
			{ current: opt, apply, record: { openClose } } as unknown as Overview,
			page(),
		);
		on("resolve");
		on("applied");
		expect(openClose).toHaveBeenCalled();
		expect(apply).toHaveBeenCalledWith(opt);
	});
});
