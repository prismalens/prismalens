// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	CircleDot,
	Eye,
	Hand,
	Pencil,
	Shield,
	Signal,
	SignalHigh,
	SignalLow,
	SignalMedium,
	TriangleAlert,
} from "lucide-react";
import { describe, expect, it } from "vitest";
import { effortIcon, modeIcon } from "./picker-icons";

describe("modeIcon", () => {
	it("returns Hand for default and manual", () => {
		expect(modeIcon("default")).toBe(Hand);
		expect(modeIcon("manual")).toBe(Hand);
	});

	it("returns Pencil for acceptEdits, accept-edits and autoEdit", () => {
		expect(modeIcon("acceptEdits")).toBe(Pencil);
		expect(modeIcon("accept-edits")).toBe(Pencil);
		expect(modeIcon("autoEdit")).toBe(Pencil);
	});

	it("returns Eye for plan and read-only", () => {
		expect(modeIcon("plan")).toBe(Eye);
		expect(modeIcon("read-only")).toBe(Eye);
	});

	it("returns Shield for auto", () => {
		expect(modeIcon("auto")).toBe(Shield);
	});

	it("returns TriangleAlert for bypassPermissions, full-access and yolo", () => {
		expect(modeIcon("bypassPermissions")).toBe(TriangleAlert);
		expect(modeIcon("full-access")).toBe(TriangleAlert);
		expect(modeIcon("yolo")).toBe(TriangleAlert);
	});

	it("returns CircleDot for something-else", () => {
		expect(modeIcon("something-else")).toBe(CircleDot);
	});
});

describe("effortIcon", () => {
	it("returns SignalLow for low, SignalMedium for medium, SignalHigh for high, and Signal for max", () => {
		expect(effortIcon("low")).toBe(SignalLow);
		expect(effortIcon("medium")).toBe(SignalMedium);
		expect(effortIcon("high")).toBe(SignalHigh);
		expect(effortIcon("max")).toBe(Signal);
	});
});
