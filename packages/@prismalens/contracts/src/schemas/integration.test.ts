// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import { ServiceIntegrationOrderSchema } from "./integration.js";

describe("ServiceIntegrationOrderSchema (#848)", () => {
	const serviceId = "00000000-0000-4000-8000-000000000001";
	const id1 = "00000000-0000-4000-8000-000000000002";
	const id2 = "00000000-0000-4000-8000-000000000003";

	it("accepts valid serviceId and unique overrideIds", () => {
		const res = ServiceIntegrationOrderSchema.safeParse({
			serviceId,
			overrideIds: [id1, id2],
		});
		expect(res.success).toBe(true);
	});

	it("refuses duplicate ids", () => {
		const res = ServiceIntegrationOrderSchema.safeParse({
			serviceId,
			overrideIds: [id1, id1],
		});
		expect(res.success).toBe(false);
	});

	it("refuses an empty array", () => {
		const res = ServiceIntegrationOrderSchema.safeParse({
			serviceId,
			overrideIds: [],
		});
		expect(res.success).toBe(false);
	});

	it("refuses ids that aren't UUIDs", () => {
		expect(
			ServiceIntegrationOrderSchema.safeParse({
				serviceId,
				overrideIds: ["not-a-uuid"],
			}).success,
		).toBe(false);

		expect(
			ServiceIntegrationOrderSchema.safeParse({
				serviceId: "not-a-uuid",
				overrideIds: [id1],
			}).success,
		).toBe(false);
	});
});
