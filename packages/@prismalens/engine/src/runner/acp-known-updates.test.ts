// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import { isKnownUpdate } from "./acp-client.js";

describe("isKnownUpdate (#1262)", () => {
	// SDK 2.8 added cursor_update; we never advertise session.cursors, so it must not show as drift.
	it("knows cursor_update, so it is not a drift row", () => {
		expect(isKnownUpdate("cursor_update")).toBe(true);
	});

	it("still treats a kind the SDK lacks as drift", () => {
		expect(isKnownUpdate("unknown_session_update_kind")).toBe(false);
	});
});
