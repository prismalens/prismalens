// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { ORPCError } from "@orpc/nest";
import { describe, expect, it, vi } from "vitest";
import type { HarnessService } from "../harness/harness.service.js";
import type { HarnessProbeService } from "../harness/harness-probe.service.js";
import { SettingsController } from "./settings.controller.js";
import { ActiveRunsError, type SettingsService } from "./settings.service.js";
import { telemetryStub } from "../../../test/factories/index.js";
import type { AboutService } from "./about.service.js";

type Handler = (args: { input: { confirmation: string } }) => Promise<unknown>;

function dangerHandlers(settings: Partial<SettingsService>) {
	const controller = new SettingsController(
		settings as SettingsService,
		{} as HarnessService,
		{} as HarnessProbeService,
		telemetryStub(),
		{} as AboutService,
	);
	const procedures = controller.danger() as unknown as Record<
		string,
		{ "~orpc": { handler: Handler } }
	>;
	return {
		resetData: procedures.resetData["~orpc"].handler,
		factoryReset: procedures.factoryReset["~orpc"].handler,
	};
}

describe("SettingsController danger zone (#605 edge 28)", () => {
	it("refuses both resets with CONFLICT while an investigation is queued or running", async () => {
		const settings = {
			activeRunCount: vi.fn(async () => 2),
			resetData: vi.fn(),
			factoryReset: vi.fn(),
		};
		const h = dangerHandlers(settings);

		await expect(
			h.resetData({ input: { confirmation: "RESET" } }),
		).rejects.toMatchObject({ code: "CONFLICT" });
		await expect(
			h.factoryReset({ input: { confirmation: "FACTORY RESET" } }),
		).rejects.toBeInstanceOf(ORPCError);
		expect(settings.resetData).not.toHaveBeenCalled();
		expect(settings.factoryReset).not.toHaveBeenCalled();
	});

	// The pre-check is friendly, not decisive: a run claimed between the count and
	// the deletes still has to stop the reset (#662 review).
	it("maps a refusal raised inside the reset transaction to the same CONFLICT", async () => {
		const settings = {
			activeRunCount: vi.fn(async () => 0),
			factoryReset: vi.fn(async () => {
				throw new ActiveRunsError(1);
			}),
		};
		const h = dangerHandlers(settings as unknown as Partial<SettingsService>);

		await expect(
			h.factoryReset({ input: { confirmation: "FACTORY RESET" } }),
		).rejects.toMatchObject({ code: "CONFLICT" });
	});

	it("resets when nothing is running", async () => {
		const settings = {
			activeRunCount: vi.fn(async () => 0),
			factoryReset: vi.fn(async () => ({ success: true, message: "done" })),
		};
		const h = dangerHandlers(settings);

		await expect(
			h.factoryReset({ input: { confirmation: "FACTORY RESET" } }),
		).resolves.toEqual({ success: true, message: "done" });
	});
});
