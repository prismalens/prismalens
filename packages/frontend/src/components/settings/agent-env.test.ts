// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import { apiKeyVars } from "./agent-env";

describe("apiKeyVars (#1235)", () => {
	it("offers Cursor's API key to set, never its login token, and Antigravity's Gemini key", () => {
		expect([apiKeyVars("cursor"), apiKeyVars("antigravity")]).toEqual([
			["CURSOR_API_KEY"],
			["GEMINI_API_KEY"],
		]);
	});
});
