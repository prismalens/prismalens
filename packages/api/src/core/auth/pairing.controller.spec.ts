// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { ConfigService } from "@nestjs/config";
import { call } from "@orpc/server";
import { ACCESS_SCOPE, type DeviceRecord } from "@prismalens/auth";
import type { Request } from "express";
import { describe, expect, it, vi } from "vitest";
import type { PrismaService } from "../prisma/prisma.service.js";
import { PairingController } from "./pairing.controller.js";

const host: DeviceRecord = {
	id: "host",
	name: "desk",
	scopes: [ACCESS_SCOPE],
	userAgent: "Mozilla/5.0 (X11; Linux x86_64) Chrome/131.0.0.0",
	createdAt: new Date("2026-10-02T10:00:00Z"),
	lastSeenAt: null,
	revokedAt: null,
};
const phone: DeviceRecord = {
	...host,
	id: "phone",
	name: "Pixel 9",
	scopes: [],
	userAgent: "Mozilla/5.0 (Linux; Android 15; Pixel 9) Chrome/131.0.0.0",
};

const store = {
	listDevices: vi.fn().mockResolvedValue([host, phone]),
	renameDevice: vi.fn(async (id: string, name: string) =>
		id === "phone" ? { ...phone, name } : null,
	),
};
vi.mock("@prismalens/auth", async (original) => ({
	...(await original<typeof import("@prismalens/auth")>()),
	prismaPairingStore: () => store,
}));

const config = {
	get: (key: string) =>
		key === "PRISMALENS_WEBHOOK_SECRET" ? "plw_secret" : undefined,
} as unknown as ConfigService;
const controller = new PairingController({} as PrismaService, config);
const as = (device: DeviceRecord) =>
	({ operator: { device } }) as unknown as Request;

describe("PairingController", () => {
	it("lists devices with their browser and marks the one asking", async () => {
		const { devices } = await call(
			controller.manage().listDevices,
			{},
			{ context: { request: as(host) } },
		);
		expect(devices.map((d) => [d.name, d.current])).toEqual([
			["desk", true],
			["Pixel 9", false],
		]);
		expect(devices[1]?.userAgent).toContain("Pixel 9");
	});

	it("renames a device, and says so when there is none", async () => {
		const renamed = await call(
			controller.manage().renameDevice,
			{ id: "phone", name: "Sumit's phone" },
			{ context: { request: as(host) } },
		);
		expect(renamed.name).toBe("Sumit's phone");
		await expect(
			call(
				controller.manage().renameDevice,
				{ id: "gone", name: "x" },
				{ context: { request: as(host) } },
			),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});

	it("gives the webhook token to the host's session only", async () => {
		await expect(
			call(controller.webhookToken(), {}, { context: { request: as(host) } }),
		).resolves.toEqual({ token: "plw_secret" });
		await expect(
			call(controller.webhookToken(), {}, { context: { request: as(phone) } }),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
	});
});
