// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import { UpdateHarnessSettingsSchema } from "./settings.js";

describe("UpdateHarnessSettingsSchema", () => {
	it("parses valid harness and models", () => {
		const parsed = UpdateHarnessSettingsSchema.parse({
			harness: "claude-code",
			models: { "claude-code": "claude-3-5-sonnet" },
		});
		expect(parsed).toEqual({
			harness: "claude-code",
			models: { "claude-code": "claude-3-5-sonnet" },
		});
	});

	it("rejects unknown keys like {harness, model} with strict validation", () => {
		const res = UpdateHarnessSettingsSchema.safeParse({
			harness: "claude-code",
			model: "claude-3-5-sonnet",
		});
		expect(res.success).toBe(false);
	});
});
