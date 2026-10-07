// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import { gatherLine } from "./gather-line";

describe("gatherLine", () => {
	it("names the alerts, the code and the telemetry, then the agent", () => {
		expect(
			gatherLine({
				chat: false,
				alerts: 1,
				code: "138674f",
				telemetry: ["Prometheus at localhost:9090"],
				agent: "Claude Code",
			}),
		).toBe(
			"Gathered 1 alert, the code at 138674f and Prometheus at localhost:9090, then started Claude Code.",
		);
	});

	it("says what was missing rather than skipping it", () => {
		expect(
			gatherLine({
				chat: false,
				alerts: 0,
				code: undefined,
				telemetry: [],
				agent: "OpenCode",
			}),
		).toBe("Gathered no alerts and no code, then started OpenCode.");
	});

	it("gathers nothing for a chat", () => {
		expect(
			gatherLine({
				chat: true,
				alerts: 2,
				code: "abc1234",
				telemetry: [],
				agent: "Codex",
			}),
		).toBe("Started Codex with your message; nothing was gathered.");
	});
});
