// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { ACCESS_SCOPE } from "@prismalens/auth";
import { SCHEDULE_HOST_ONLY } from "@prismalens/contracts";
import { describe, expect, it, vi } from "vitest";
import { SchedulesController } from "./schedules.controller.js";
import type { SchedulesService } from "./schedules.service.js";

type Handler = (args: { input: unknown; context: { request: unknown } }) => Promise<unknown>;

const device = (scopes: string[]) => ({
	operator: { device: { id: "dev-1", scopes } },
});
const PHONE = device(["investigate:read", "investigate:operate"]);
const HOST = device(["investigate:read", "investigate:operate", ACCESS_SCOPE]);

function handlers(service: Partial<SchedulesService>) {
	const routes = new SchedulesController(service as SchedulesService).routes() as unknown as Record<
		string,
		{ "~orpc": { handler: Handler } }
	>;
	return (name: string) => routes[name]?.["~orpc"].handler as Handler;
}

describe("schedule writes are the host's (#979)", () => {
	const writes = {
		create: {},
		update: { id: "s", revision: 1, schedule: {} },
		setEnabled: { id: "s", enabled: false },
		runNow: { id: "s" },
		remove: { id: "s" },
	};

	it("refuses every write from a paired device, and changes nothing", async () => {
		const service = {
			create: vi.fn(),
			update: vi.fn(),
			setEnabled: vi.fn(),
			runNow: vi.fn(),
			remove: vi.fn(),
		};
		const h = handlers(service);
		for (const [name, input] of Object.entries(writes)) {
			await expect(h(name)({ input, context: { request: PHONE } })).rejects.toMatchObject({
				code: "FORBIDDEN",
				message: SCHEDULE_HOST_ONLY,
			});
		}
		for (const fn of Object.values(service)) expect(fn).not.toHaveBeenCalled();
	});

	it("lets the host write, recording its device", async () => {
		const service = { setEnabled: vi.fn(async () => ({})) };
		await handlers(service as never)("setEnabled")({ input: writes.setEnabled, context: { request: HOST } });
		expect(service.setEnabled).toHaveBeenCalledWith("s", false, "dev-1");
	});

	it("lets every device read, and tells it whether it can edit", async () => {
		const service = { list: vi.fn(async () => ({ schedules: [], builtIns: [] })) };
		const h = handlers(service);
		await expect(h("list")({ input: {}, context: { request: PHONE } })).resolves.toMatchObject({
			canEdit: false,
		});
		await expect(h("list")({ input: {}, context: { request: HOST } })).resolves.toMatchObject({
			canEdit: true,
		});
	});
});
