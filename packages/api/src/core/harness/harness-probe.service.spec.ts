// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { beforeEach, describe, expect, it, vi } from "vitest";
import { HarnessModelsService } from "./harness-models.service.js";
import { HarnessProbeService } from "./harness-probe.service.js";

const mocks = vi.hoisted(() => ({ probeHarness: vi.fn() }));

vi.mock("@prismalens/engine", async (importOriginal) => ({
	...(await importOriginal<typeof import("@prismalens/engine")>()),
	probeHarness: mocks.probeHarness,
}));

const answered = {
	id: "claude-code",
	outcome: "answers-acp",
	detail: "answers ACP through the adapter PrismaLens ships",
	hard: false,
	servedModel: "default",
	effort: null,
	images: true,
};

describe("HarnessProbeService.check signed out (w8-9)", () => {
	let models: HarnessModelsService;
	let svc: HarnessProbeService;
	beforeEach(() => {
		models = new HarnessModelsService();
		svc = new HarnessProbeService(models);
	});

	it("records a handshake the agent says is signed out as sign-in-needed", async () => {
		mocks.probeHarness.mockResolvedValue({ ...answered, signedOut: true });
		const result = await svc.check("claude-code");
		expect(result).toMatchObject({
			outcome: "sign-in-needed",
			detail: "sign in needed",
		});
		expect(models.checked("claude-code")).toMatchObject({
			outcome: "sign-in-needed",
			detail: "sign in needed",
		});
	});

	it("keeps answers-acp when signed in or when the agent pushed nothing", async () => {
		for (const signedOut of [false, undefined]) {
			mocks.probeHarness.mockResolvedValue({ ...answered, signedOut });
			expect((await svc.check("claude-code")).outcome).toBe("answers-acp");
			expect(models.checked("claude-code")?.outcome).toBe("answers-acp");
		}
	});
});
