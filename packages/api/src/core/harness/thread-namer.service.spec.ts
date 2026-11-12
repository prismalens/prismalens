// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it, vi } from "vitest";
import type { ThreadTitleSettings } from "@prismalens/contracts/schemas";
import type { PrismaService } from "../prisma/prisma.service.js";
import type { HarnessService } from "./harness.service.js";
import type { HarnessModelsService } from "./harness-models.service.js";
import { ThreadNamerService } from "./thread-namer.service.js";

function createService() {
	const prisma = {
		investigation: {
			findUnique: vi.fn(async () => ({
				title: "Instant Title" as string | null,
				harness: "claude-code" as string | null,
				titleSetBy: null as string | null,
				incident: null as { title: string } | null,
			})),
			updateMany: vi.fn(async () => ({ count: 1 })),
		},
		investigationEvent: {
			findMany: vi.fn(async () => [] as Array<{ event: string }>),
		},
		job: {
			findUnique: vi.fn(async () => null as { payload: string } | null),
		},
	};
	const harness = {
		getSettings: vi.fn(async (): Promise<{ threadTitles?: ThreadTitleSettings }> => ({
			threadTitles: { enabled: true },
		})),
		runtimeFor: vi.fn(async () => ({
			env: { ANTHROPIC_API_KEY: "test-key" },
		})),
	};
	const models = {
		modelsFor: vi.fn(() => ({
			entries: [{ id: "claude-haiku-4", name: "Claude Haiku" }],
		})),
	};

	const svc = new ThreadNamerService(
		prisma as unknown as PrismaService,
		harness as unknown as HarnessService,
		models as unknown as HarnessModelsService,
	);
	svc.name = vi.fn(async () => ({
		text: "Generated Title",
		model: "claude-haiku-4",
	})) as never;
	return { svc, prisma, harness, models };
}

describe("ThreadNamerService (#1101)", () => {
	it("replaces the instant title with the generated title", async () => {
		const { svc, prisma } = createService();
		const outcome = await svc.nameOnce(
			"run-1",
			"claude-code",
			"Investigate checkout failures",
		);
		expect(outcome).toBe("named");
		expect(prisma.investigation.updateMany).toHaveBeenCalledWith({
			where: {
				id: "run-1",
				title: "Instant Title",
				titleSetBy: null,
			},
			data: {
				title: "Generated Title",
				titleSetBy: "agent",
			},
		});
	});

	it("keeps the title when rename wins with row titleSetBy user, never calling name", async () => {
		const { svc, prisma } = createService();
		prisma.investigation.findUnique.mockResolvedValue({
			title: "User Custom Title",
			harness: "claude-code",
			titleSetBy: "user",
			incident: null,
		});
		const outcome = await svc.nameOnce(
			"run-1",
			"claude-code",
			"Investigate checkout failures",
		);
		expect(outcome).toBe("kept");
		expect(svc.name).not.toHaveBeenCalled();
	});

	it("keeps the instant title when name rejects with outcome failed, never calling updateMany", async () => {
		const { svc, prisma } = createService();
		svc.name = vi.fn(async () => {
			throw new Error("Agent connection failed");
		}) as never;
		const outcome = await svc.nameOnce(
			"run-1",
			"claude-code",
			"Investigate checkout failures",
		);
		expect(outcome).toBe("failed");
		expect(prisma.investigation.updateMany).not.toHaveBeenCalled();
	});

	it("returns off and never calls name when threadTitles.enabled is false, but regenerate still names it with force", async () => {
		const { svc, prisma, harness } = createService();
		harness.getSettings.mockResolvedValue({
			threadTitles: { enabled: false },
		});
		const outcome = await svc.nameOnce(
			"run-1",
			"claude-code",
			"Investigate checkout failures",
		);
		expect(outcome).toBe("off");
		expect(svc.name).not.toHaveBeenCalled();

		prisma.investigationEvent.findMany.mockResolvedValue([
			{ event: JSON.stringify({ text: "Operator initial message" }) },
		]);
		const regenOutcome = await svc.regenerate("run-1");
		expect(regenOutcome).toBe("named");
		expect(svc.name).toHaveBeenCalled();
		expect(prisma.investigation.updateMany).toHaveBeenCalledWith({
			where: {
				id: "run-1",
				title: "Instant Title",
			},
			data: {
				title: "Generated Title",
				titleSetBy: "agent",
			},
		});
	});

	it("returns no-model when no small model is listed and none is set", async () => {
		const { svc, models } = createService();
		models.modelsFor.mockReturnValue({
			entries: [{ id: "large-opus-model", name: "Opus" }],
		} as never);
		const outcome = await svc.nameOnce(
			"run-1",
			"claude-code",
			"Investigate checkout failures",
		);
		expect(outcome).toBe("no-model");
		expect(svc.name).not.toHaveBeenCalled();
	});

	it("set per-agent model wins over the smallest listed one", async () => {
		const { svc, harness, models } = createService();
		harness.getSettings.mockResolvedValue({
			threadTitles: {
				enabled: true,
				models: { "claude-code": "custom-per-agent-model" },
			},
		});
		models.modelsFor.mockReturnValue({
			entries: [{ id: "claude-haiku-4", name: "Claude Haiku" }],
		} as never);
		const outcome = await svc.nameOnce(
			"run-1",
			"claude-code",
			"Investigate checkout failures",
		);
		expect(outcome).toBe("named");
		expect(svc.name).toHaveBeenCalledWith(
			"claude-code",
			expect.objectContaining({
				model: "custom-per-agent-model",
			}),
		);
	});

	it("passes a prompt to name containing the incident title when the row has one", async () => {
		const { svc, prisma } = createService();
		prisma.investigation.findUnique.mockResolvedValue({
			title: "Instant Title",
			harness: "claude-code",
			titleSetBy: null,
			incident: { title: "Payment Service 500 Spike" },
		});
		const outcome = await svc.nameOnce(
			"run-1",
			"claude-code",
			"Investigate checkout failures",
		);
		expect(outcome).toBe("named");
		expect(svc.name).toHaveBeenCalledWith(
			"claude-code",
			expect.objectContaining({
				prompt: expect.stringContaining("Alert: Payment Service 500 Spike"),
			}),
		);
	});

	it("names it again from the job's brief when no message event exists, not from the current title", async () => {
		const { svc, prisma } = createService();
		prisma.job.findUnique.mockResolvedValue({
			payload: JSON.stringify({ brief: "Why did checkout p99 rise after deploy 412?" }),
		});
		expect(await svc.regenerate("run-1")).toBe("named");
		const prompt = (svc.name as unknown as { mock: { calls: [string, { prompt: string }][] } })
			.mock.calls[0][1].prompt;
		expect(prompt).toContain("Why did checkout p99 rise after deploy 412?");
		expect(prompt).not.toContain("Instant Title");
	});

	it("ignores a follow-up's job and falls back to the incident title", async () => {
		const { svc, prisma } = createService();
		prisma.investigation.findUnique.mockResolvedValue({
			title: "Instant Title",
			harness: "claude-code",
			titleSetBy: null,
			incident: { title: "Checkout 5xx spike" },
		});
		prisma.job.findUnique.mockResolvedValue({
			payload: JSON.stringify({ resume: { sessionId: "s" }, brief: "follow-up text" }),
		});
		expect(await svc.regenerate("run-1")).toBe("named");
		const prompt = (svc.name as unknown as { mock: { calls: [string, { prompt: string }][] } })
			.mock.calls[0][1].prompt;
		expect(prompt).toContain("Task:\nCheckout 5xx spike");
		expect(prompt).not.toContain("follow-up text");
	});
});
