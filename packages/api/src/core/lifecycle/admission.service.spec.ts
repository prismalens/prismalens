// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it, vi } from "vitest";
import { AdmissionService } from "./admission.service.js";

describe("AdmissionService (#724)", () => {
	it("drains and restores the dispatch loop it is attached to", () => {
		const a = new AdmissionService();
		const drain = vi.fn();
		a.attach({ drain, running: () => 2 });
		a.drain();
		expect(a.draining).toBe(true);
		expect(drain).toHaveBeenLastCalledWith(true);
		a.restore();
		expect(drain).toHaveBeenLastCalledWith(false);
		expect(a.running()).toBe(2);
	});

	it("carries a drain that began before dispatch attached, and counts nothing without it", () => {
		const a = new AdmissionService();
		expect(a.running()).toBe(0);
		a.drain();
		const drain = vi.fn();
		a.attach({ drain, running: () => 0 });
		expect(drain).toHaveBeenCalledWith(true);
	});
});
