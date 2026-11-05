// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { ORPCError } from "@orpc/nest";
import { describe, expect, it, vi } from "vitest";
import type { HarnessService } from "../harness/harness.service.js";
import { SettingsController } from "./settings.controller.js";
import { ActiveRunsError, type SettingsService } from "./settings.service.js";
import { telemetryStub } from "../../../test/factories/index.js";
import type { DiagnosticsService } from "./diagnostics.service.js";
import type { UpdateService } from "./update.service.js";

type Handler = (args: { input: { confirmation: string } }) => Promise<unknown>;

function dangerHandlers(settings: Partial<SettingsService>) {
	const controller = new SettingsController(
		settings as SettingsService,
		{} as HarnessService,
		telemetryStub(),
		{} as UpdateService,
		{} as DiagnosticsService,
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

describe("SettingsController usage data (#673 w45)", () => {
	it("passes the notice and the switch through to the service as sent", async () => {
		const telemetry = telemetryStub();
		const controller = new SettingsController(
			{} as SettingsService,
			{} as HarnessService,
			telemetry,
			{} as UpdateService,
			{} as DiagnosticsService,
		);
		const update = (
			controller.telemetry() as unknown as Record<
				string,
				{ "~orpc": { handler: (a: { input: unknown }) => Promise<unknown> } }
			>
		).update["~orpc"].handler;
		await update({ input: { enabled: false, dismissed: true } });
		expect(telemetry.update).toHaveBeenCalledWith({
			enabled: false,
			dismissed: true,
		});
	});
});

describe("SettingsController host-only update routes (#724)", () => {
	type Proc = { "~orpc": { handler: (a: unknown) => Promise<unknown> } };
	const paired = { request: { operator: { device: { scopes: [] } } } };
	const host = { request: { operator: { device: { scopes: ["admin:access"] } } } };

	function controller(update: Partial<UpdateService>, diagnostics: Partial<DiagnosticsService>) {
		return new SettingsController(
			{} as SettingsService,
			{} as HarnessService,
			telemetryStub(),
			update as UpdateService,
			diagnostics as DiagnosticsService,
		);
	}

	it("refuses diagnostics to a paired device and runs them for the host", async () => {
		const run = vi.fn(() => ({ checks: [], ranAt: "now" }));
		const about = controller({}, { run }).about() as unknown as Record<string, Proc>;
		await expect(
			about.diagnostics["~orpc"].handler({ input: undefined, context: paired }),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
		await about.diagnostics["~orpc"].handler({ input: undefined, context: host });
		expect(run).toHaveBeenCalledOnce();
	});

	it("passes who is asking to install, and maps a refusal to its status", async () => {
		const { UpdateRefused } = await import("./update.service.js");
		const install = vi.fn(async () => {
			throw new UpdateRefused("FORBIDDEN", "host only");
		});
		const update = controller({ install }, {}).update() as unknown as Record<string, Proc>;
		await expect(
			update.install["~orpc"].handler({ input: { version: "9.9.9" }, context: paired }),
		).rejects.toMatchObject({ code: "FORBIDDEN", message: "host only" });
		expect(install).toHaveBeenCalledWith("9.9.9", false);
	});
});
