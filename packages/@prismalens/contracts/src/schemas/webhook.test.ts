// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { DeployWebhookSchema } from "./webhook.js";

const base = { service: "api", version: "v1.2.3" };

describe("DeployWebhookSchema (#854)", () => {
	it("accepts an http(s) url and an ISO timestamp with an offset", () => {
		expect(
			DeployWebhookSchema.safeParse({
				...base,
				url: "https://ci.example/run/1",
				timestamp: "2026-10-20T10:00:00+05:30",
			}).success,
		).toBe(true);
	});

	it("rejects a url that is not http(s), so no javascript: link is stored", () => {
		expect(
			DeployWebhookSchema.safeParse({ ...base, url: "javascript:alert(1)" })
				.success,
		).toBe(false);
	});

	it("rejects an unparsable timestamp instead of recording the deploy at receipt time", () => {
		expect(
			DeployWebhookSchema.safeParse({ ...base, timestamp: "yesterday" }).success,
		).toBe(false);
	});
});
