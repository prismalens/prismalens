// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { PR_TONES } from "@prismalens/contracts";
import { describe, expect, it } from "vitest";
import { prToneClass } from "./pr-tone";

describe("prToneClass", () => {
	it("maps all 8 tones in PR_TONES to ready text-ok, open text-info, draft text-neutral, attention text-warn, failing text-danger, merged text-done, closed text-text-3, unknown text-neutral", () => {
		expect(
			PR_TONES.map((tone) => `${tone} ${prToneClass(tone)}`).join(", "),
		).toBe(
			"ready text-ok, open text-info, draft text-neutral, attention text-warn, failing text-danger, merged text-done, closed text-text-3, unknown text-neutral",
		);
		expect(prToneClass("ready")).toBe("text-ok");
		expect(prToneClass("open")).toBe("text-info");
		expect(prToneClass("draft")).toBe("text-neutral");
		expect(prToneClass("attention")).toBe("text-warn");
		expect(prToneClass("failing")).toBe("text-danger");
		expect(prToneClass("merged")).toBe("text-done");
		expect(prToneClass("closed")).toBe("text-text-3");
		expect(prToneClass("unknown")).toBe("text-neutral");
	});
});
