// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Logger } from "@prismalens/logger";
import { describe, expect, it, vi } from "vitest";
import { quietly } from "./gateway.service.js";

describe("quietly gateway notice (#1024 surface F)", () => {
	it("sends responseMode notice to logger debug and passes other warnings to console.warn", () => {
		const originalWarn = console.warn;
		const warnSpy = vi.fn();
		console.warn = warnSpy;

		const debugSpy = vi.spyOn(Logger.prototype, "debug").mockImplementation(() => {});

		try {
			quietly(() => {
				console.warn("responseMode: 'json' drops mid-call notifications and events");
				console.warn("disk space low");
			});

			expect(debugSpy).toHaveBeenCalledWith(
				"responseMode: 'json' drops mid-call notifications and events",
			);
			expect(warnSpy).not.toHaveBeenCalledWith(
				"responseMode: 'json' drops mid-call notifications and events",
			);
			expect(warnSpy).toHaveBeenCalledWith("disk space low");
		} finally {
			debugSpy.mockRestore();
			console.warn = originalWarn;
		}
	});
});
