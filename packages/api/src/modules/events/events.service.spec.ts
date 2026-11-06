// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it, vi } from "vitest";
import type { PrismaService } from "../../core/prisma/prisma.service.js";
import { EventsService } from "./events.service.js";

describe("EventsService.findUnclaimed", () => {
	it("takes the earliest-ending row first, so an older episode's firing does not take a newer episode's row", async () => {
		const findFirst = vi.fn().mockResolvedValue(null);
		const service = new EventsService({
			event: { findFirst },
		} as unknown as PrismaService);

		await service.findUnclaimed({
			source: "prometheus",
			sourceEventId: "fp-1",
			eventType: "alert-resolved-early",
			eventTimeFrom: new Date("2026-09-19T10:00:00Z"),
			receivedSince: new Date("2026-09-19T09:00:00Z"),
		});

		expect(findFirst.mock.calls[0][0].orderBy).toEqual([
			{ eventTime: "asc" },
			{ receivedAt: "asc" },
		]);
	});
});
