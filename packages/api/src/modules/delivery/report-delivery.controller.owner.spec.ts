// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { ACCESS_SCOPE } from "@prismalens/auth";
import { describe, expect, it, vi } from "vitest";
import { ReportDeliveryController } from "./report-delivery.controller.js";
import type { ReportDeliveryService } from "./report-delivery.service.js";

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

describe("ReportDeliveryController owner guard (#1066)", () => {
	it("refuses update to a paired device and saves for the owner", async () => {
		const service = {
			getSettings: vi.fn(async () => ({ slackWebhookUrl: null })),
			setSlackWebhook: vi.fn(async (url: string | null) => ({ slackWebhookUrl: url })),
		};
		const controller = new ReportDeliveryController(
			service as unknown as ReportDeliveryService,
		);
		const routes = controller.deliverySettings();
		const route = routes.update as unknown as Callable;
		const input = { slackWebhookUrl: "https://hooks.slack.com/services/T00/B00/X00" };

		await expect(async () =>
			route["~orpc"].handler({ input, context: { request: pairedRequest } }),
		).rejects.toMatchObject({
			code: "FORBIDDEN",
			message: "Only the owner can change report delivery.",
		});
		expect(service.setSlackWebhook).not.toHaveBeenCalled();

		await route["~orpc"].handler({ input, context: { request: ownerRequest } });
		expect(service.setSlackWebhook).toHaveBeenCalledWith(input.slackWebhookUrl);
	});
});
