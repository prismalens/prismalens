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

	it("older probe resolving after a newer one does not overwrite it (#1171)", async () => {
		let resolve1!: (v: unknown) => void;
		let resolve2!: (v: unknown) => void;
		mocks.probeHarness
			.mockImplementationOnce(() => new Promise((r) => { resolve1 = r; }))
			.mockImplementationOnce(() => new Promise((r) => { resolve2 = r; }));
		const p1 = svc.check("claude-code", undefined, undefined, 1);
		const p2 = svc.check("claude-code", undefined, undefined, 2);
		resolve2({ ...answered, detail: "check from probe 2" });
		await p2;
		expect(models.checked("claude-code")?.detail).toBe("check from probe 2");
		resolve1({ ...answered, detail: "check from probe 1" });
		await p1;
		expect(models.checked("claude-code")?.detail).toBe("check from probe 2");
	});

	it("publishes nothing when guard key differs from current key (#1171)", async () => {
		mocks.probeHarness.mockResolvedValue({ ...answered, detail: "guard check" });
		const guard = { key: "old-key", current: () => "new-key" };
		await svc.check("claude-code", undefined, guard);
		expect(models.checked("claude-code")).toBeNull();
	});

	it("pass then no-answer keeps outcome as answers-acp with lastTry set (#1171)", async () => {
		mocks.probeHarness.mockResolvedValueOnce({
			...answered,
			outcome: "answers-acp",
			models: [{ id: "model-1", name: "Model 1" }],
		});
		await svc.check("claude-code");
		expect(models.checked("claude-code")?.outcome).toBe("answers-acp");
		expect(
			models.modelsFor("claude-code")?.entries.map((e) => e.id),
		).toContain("model-1");

		mocks.probeHarness.mockResolvedValueOnce({
			id: "claude-code",
			outcome: "no-answer",
			detail: "probe timed out",
			hard: false,
		});
		await svc.check("claude-code");
		const c = models.checked("claude-code");
		expect(c?.outcome).toBe("answers-acp");
		expect(c?.lastTry).toEqual({
			at: expect.any(String),
			outcome: "no-answer",
			detail: "probe timed out",
		});
		expect(
			models.modelsFor("claude-code")?.entries.map((e) => e.id),
		).toContain("model-1");

		const freshModels = new HarnessModelsService();
		const freshSvc = new HarnessProbeService(freshModels);
		mocks.probeHarness.mockResolvedValueOnce({
			id: "claude-code",
			outcome: "no-answer",
			detail: "probe timed out",
			hard: false,
		});
		await freshSvc.check("claude-code");
		const fresh = freshModels.checked("claude-code");
		expect(fresh?.outcome).toBe("no-answer");
		expect(fresh?.lastTry).toBeNull();
	});
});
