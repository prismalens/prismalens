// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it, vi } from "vitest";
import type { PrismaService } from "../prisma/prisma.service.js";
import { SettingsService } from "./settings.service.js";

describe("SettingsService (#1066)", () => {
	it("factoryReset runs against a transaction without session, account, verification or user", async () => {
		const fakeTx = {
			investigation: {
				count: vi.fn(async () => 0),
				deleteMany: vi.fn(async () => ({ count: 0 })),
			},
			recommendation: { deleteMany: vi.fn(async () => ({ count: 0 })) },
			timelineEntry: { deleteMany: vi.fn(async () => ({ count: 0 })) },
			changeEvent: { deleteMany: vi.fn(async () => ({ count: 0 })) },
			attachment: { deleteMany: vi.fn(async () => ({ count: 0 })) },
			incident: { deleteMany: vi.fn(async () => ({ count: 0 })) },
			alert: { deleteMany: vi.fn(async () => ({ count: 0 })) },
			event: { deleteMany: vi.fn(async () => ({ count: 0 })) },
			serviceIntegration: { deleteMany: vi.fn(async () => ({ count: 0 })) },
			serviceDependency: { deleteMany: vi.fn(async () => ({ count: 0 })) },
			service: { deleteMany: vi.fn(async () => ({ count: 0 })) },
			connection: { deleteMany: vi.fn(async () => ({ count: 0 })) },
			integration: { deleteMany: vi.fn(async () => ({ count: 0 })) },
			setting: { deleteMany: vi.fn(async () => ({ count: 0 })) },
		};

		const prisma = {
			$transaction: vi.fn(
				async (cb: (tx: typeof fakeTx) => Promise<unknown>) => cb(fakeTx),
			),
		} as unknown as PrismaService;

		const service = new SettingsService(prisma);
		const result = await service.factoryReset();
		expect(result).toEqual({ success: true, message: "Factory reset complete" });
		expect(fakeTx.recommendation.deleteMany).toHaveBeenCalled();
		expect(fakeTx.setting.deleteMany).toHaveBeenCalled();
		expect("session" in fakeTx).toBe(false);
		expect("account" in fakeTx).toBe(false);
		expect("verification" in fakeTx).toBe(false);
		expect("user" in fakeTx).toBe(false);
	});
});
