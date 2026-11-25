// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { beforeEach, describe, expect, it, vi } from "vitest";
import { liveChanges } from "../../core/live/live-changes.js";
import type { PrismaService } from "../../core/prisma/prisma.service.js";
import { AttentionService } from "./attention.service.js";

describe("AttentionService.markThreadRead (#1181)", () => {
	let service: AttentionService;
	let prismaMock: {
		investigation: {
			findUnique: ReturnType<typeof vi.fn>;
			updateMany: ReturnType<typeof vi.fn>;
		};
		investigationEvent: { findFirst: ReturnType<typeof vi.fn> };
		threadRead: {
			findUnique: ReturnType<typeof vi.fn>;
			upsert: ReturnType<typeof vi.fn>;
		};
		attentionEvent: { updateMany: ReturnType<typeof vi.fn> };
	};

	beforeEach(() => {
		vi.clearAllMocks();
		prismaMock = {
			investigation: {
				findUnique: vi.fn().mockResolvedValue({
					eventGeneration: 1,
					eventOrdinal: 10,
					updatedAt: new Date("2026-11-12T10:00:00Z"),
				}),
				updateMany: vi.fn().mockResolvedValue({ count: 1 }),
			},
			investigationEvent: {
				findFirst: vi.fn().mockResolvedValue({ ordinal: 5 }),
			},
			threadRead: {
				findUnique: vi.fn().mockResolvedValue(null),
				upsert: vi.fn().mockResolvedValue({}),
			},
			attentionEvent: {
				updateMany: vi.fn().mockResolvedValue({ count: 0 }),
			},
		};
		service = new AttentionService(
			prismaMock as unknown as PrismaService,
			{} as never,
			{} as never,
		);
	});

	it("an advance does not call liveChanges.noteTopic('threads')", async () => {
		const noteSpy = vi.spyOn(liveChanges, "noteTopic");
		const advanced = await service.markThreadRead("inv-1", "main:5");

		expect(advanced).toBe(true);
		expect(noteSpy).not.toHaveBeenCalledWith("threads");
	});

	it("calls noteTopic('attention') only when an attention event turned read", async () => {
		const noteSpy = vi.spyOn(liveChanges, "noteTopic");

		prismaMock.attentionEvent.updateMany.mockResolvedValueOnce({ count: 0 });
		const advancedNoEvents = await service.markThreadRead("inv-1", "main:5");
		expect(advancedNoEvents).toBe(true);
		expect(noteSpy).not.toHaveBeenCalledWith("attention");

		prismaMock.attentionEvent.updateMany.mockResolvedValueOnce({ count: 2 });
		const advancedWithEvents = await service.markThreadRead("inv-1", "main:5");
		expect(advancedWithEvents).toBe(true);
		expect(noteSpy).toHaveBeenCalledWith("attention");
		expect(noteSpy).toHaveBeenCalledTimes(1);
	});
});
