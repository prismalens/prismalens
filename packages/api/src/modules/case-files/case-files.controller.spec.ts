// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { ORPCError } from "@orpc/nest";
import { describe, expect, it, vi } from "vitest";
import { IS_PUBLIC_KEY } from "../../core/auth/public.decorator.js";
import type { BindingsService } from "./bindings.service.js";
import type { CaseFileSettingsService } from "./case-file-settings.service.js";
import { CaseFilesController } from "./case-files.controller.js";
import {
	ArtifactUnavailableError,
	CaptureRefusedError,
	CaseNotFoundError,
	type CaseViewService,
} from "./case-view.service.js";

type Handler = (args: { input: unknown }) => Promise<unknown>;

function handler(procedures: unknown, key: string): Handler {
	return (procedures as Record<string, { "~orpc": { handler: Handler } }>)[key]?.["~orpc"].handler as Handler;
}

function setup() {
	const views = { get: vi.fn(), artifact: vi.fn(), verify: vi.fn(), capture: vi.fn() };
	const settings = { isEnabled: vi.fn().mockResolvedValue(false), set: vi.fn().mockResolvedValue(undefined) };
	const controller = new CaseFilesController(
		{} as BindingsService,
		views as unknown as CaseViewService,
		settings as unknown as CaseFileSettingsService,
	);
	return { controller, views, settings };
}

describe("CaseFilesController", () => {
	it("marks no route public, so the global auth guard covers every one", () => {
		const methods = ["bindings", "caseFileSettings", "cases"] as const;
		expect(Reflect.getMetadata(IS_PUBLIC_KEY, CaseFilesController)).toBeUndefined();
		for (const m of methods)
			expect(Reflect.getMetadata(IS_PUBLIC_KEY, CaseFilesController.prototype[m])).toBeUndefined();
	});

	it("reads and writes the setting", async () => {
		const { controller, settings } = setup();
		expect(await handler(controller.caseFileSettings(), "get")({ input: undefined })).toEqual({ enabled: false });
		expect(await handler(controller.caseFileSettings(), "update")({ input: { enabled: true } })).toEqual({ enabled: true });
		expect(settings.set).toHaveBeenCalledWith(true);
	});

	it("maps a missing case to 404, an unservable artifact to 409 and a refused capture to 412", async () => {
		const { controller, views } = setup();
		views.get.mockRejectedValue(new CaseNotFoundError("incident", "x"));
		views.artifact.mockRejectedValue(new ArtifactUnavailableError("withheld"));
		views.capture.mockRejectedValue(new CaptureRefusedError("disabled"));
		const cases = controller.cases();
		await expect(handler(cases, "get")({ input: { incidentId: "x" } })).rejects.toMatchObject({ code: "NOT_FOUND" });
		await expect(handler(cases, "artifact")({ input: { artifactId: "a" } })).rejects.toMatchObject({
			code: "CONFLICT",
			status: 409,
			data: { reason: "withheld" },
		});
		await expect(handler(cases, "capture")({ input: { incidentId: "x" } })).rejects.toMatchObject({
			code: "PRECONDITION_FAILED",
			status: 412,
		});
		views.verify.mockRejectedValue(new Error("boom"));
		const err = await handler(cases, "verify")({ input: { incidentId: "x" } }).catch((e: unknown) => e);
		expect(err).not.toBeInstanceOf(ORPCError);
	});
});
