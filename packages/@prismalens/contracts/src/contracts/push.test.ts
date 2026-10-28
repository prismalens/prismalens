// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { SubscribeInputSchema } from "./push.js";

const keys = { p256dh: "p", auth: "a" };

describe("SubscribeInputSchema", () => {
	it("accepts a push service's https endpoint", () => {
		expect(
			SubscribeInputSchema.safeParse({
				endpoint: "https://fcm.googleapis.com/fcm/send/abc",
				keys,
			}).success,
		).toBe(true);
	});

	it("rejects any other scheme, so the server never posts to an internal http host", () => {
		for (const endpoint of [
			"http://169.254.169.254/latest",
			"http://localhost:6473/x",
		])
			expect(SubscribeInputSchema.safeParse({ endpoint, keys }).success).toBe(
				false,
			);
	});
});
