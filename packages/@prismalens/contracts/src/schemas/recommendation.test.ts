// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import { RecommendationWithRelationsSchema } from "./recommendation.js";

describe("RecommendationWithRelationsSchema (#979)", () => {
	const base = {
		id: "11111111-1111-4111-8111-111111111111",
		investigationId: "22222222-2222-4222-8222-222222222222",
		title: "Roll back",
		description: null,
		priority: "high",
		category: null,
		urgency: null,
		actionable: true,
		estimatedEffort: null,
		status: "pending",
		implementedAt: null,
		implementedBy: null,
		createdAt: "2026-10-28T09:00:00.000Z",
		updatedAt: "2026-10-28T09:00:00.000Z",
	};

	it("takes a run with no incident yet", () => {
		const parsed = RecommendationWithRelationsSchema.parse({
			...base,
			investigation: { id: base.investigationId, incidentId: null, status: "completed" },
		});
		expect(parsed.investigation?.incidentId).toBeNull();
	});
});
