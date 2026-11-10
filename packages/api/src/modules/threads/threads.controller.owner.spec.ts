// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { ACCESS_SCOPE } from "@prismalens/auth";
import { describe, expect, it, vi } from "vitest";
import { ThreadsController } from "./threads.controller.js";
import type { ThreadsService } from "./threads.service.js";

type Callable = {
	"~orpc": { handler: (o: { input: unknown; context: { request: unknown } }) => unknown };
};

const pairedRequest = {
	operator: {
		device: {
			id: "dev-paired",
			scopes: ["investigate:read", "investigate:operate"],
		},
	},
};

const ownerRequest = {
	operator: {
		device: {
			id: "dev-owner",
			scopes: ["investigate:read", "investigate:operate", ACCESS_SCOPE],
		},
	},
};

describe("ThreadsController owner guard (#1066)", () => {
	it("refuses updateSettings to a paired device and saves for the owner", async () => {
		const threads = {
			updateSettings: vi.fn(async (input: unknown) => input),
		};
		const controller = new ThreadsController(
			threads as unknown as ThreadsService,
			{} as never,
			{} as never,
			{} as never,
			{} as never,
		);
		const routes = controller.routes();
		const route = routes.updateSettings as unknown as Callable;
		const input = { settleAfterDays: 5 };

		await expect(async () =>
			route["~orpc"].handler({ input, context: { request: pairedRequest } }),
		).rejects.toMatchObject({
			code: "FORBIDDEN",
			message: "Only the owner can change thread settings.",
		});
		expect(threads.updateSettings).not.toHaveBeenCalled();

		await route["~orpc"].handler({ input, context: { request: ownerRequest } });
		expect(threads.updateSettings).toHaveBeenCalledWith(input);
	});
});
