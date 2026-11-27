// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import { isKnownUpdate } from "./acp-client.js";

describe("isKnownUpdate (#1262)", () => {
	// SDK 2.8 added cursor_update; investigate.test.ts covers what a run does with it.
	it("classifies cursor_update as known", () => {
		expect(isKnownUpdate("cursor_update")).toBe(true);
	});

	it("classifies a kind the SDK lacks as unknown", () => {
		expect(isKnownUpdate("unknown_session_update_kind")).toBe(false);
	});
});
