// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import {
	AlertMappingHealthQuerySchema,
	AlertMappingHealthResponseSchema,
} from "./alert-mapping.js";

describe("AlertMappingHealth schemas", () => {
	it("parses AlertMappingHealthQuerySchema with defaults", () => {
		const parsed = AlertMappingHealthQuerySchema.parse({});
		expect(parsed.windowHours).toBe(168);
	});

	it("parses AlertMappingHealthQuerySchema with explicit windowHours string and number", () => {
		expect(AlertMappingHealthQuerySchema.parse({ windowHours: "24" }).windowHours).toBe(24);
		expect(AlertMappingHealthQuerySchema.parse({ windowHours: 72 }).windowHours).toBe(72);
	});

	it("validates AlertMappingHealthResponseSchema correctly", () => {
		const mockResponse = {
			summary: {
				totalIssues: 2,
				unmappedServicesCount: 1,
				neverMatchedRulesCount: 1,
				stoppedMatchingRulesCount: 0,
				healthyRulesCount: 1,
				disabledRulesCount: 0,
				totalRules: 2,
				totalServices: 2,
				windowHours: 168,
			},
			issues: [
				{
					id: "service-11111111-1111-4111-8111-111111111111",
					type: "unmapped_service",
					title: "Auth Service",
					description: "Service has no enabled alert mapping rules",
					serviceId: "11111111-1111-4111-8111-111111111111",
					serviceName: "auth-service",
				},
				{
					id: "rule-22222222-2222-4222-8222-222222222222",
					type: "never_matched",
					title: "Prometheus API",
					description: "Enabled rule has never matched any alert",
					ruleId: "22222222-2222-4222-8222-222222222222",
					ruleName: "Prometheus API",
					serviceId: "33333333-3333-4333-8333-333333333333",
					serviceName: "api-gateway",
					lastMatchedAt: null,
				},
			],
			services: [
				{
					serviceId: "11111111-1111-4111-8111-111111111111",
					serviceName: "auth-service",
					serviceDisplayName: "Auth Service",
					hasEnabledRules: false,
					ruleCount: 0,
					enabledRuleCount: 0,
				},
				{
					serviceId: "33333333-3333-4333-8333-333333333333",
					serviceName: "api-gateway",
					serviceDisplayName: "API Gateway",
					hasEnabledRules: true,
					ruleCount: 2,
					enabledRuleCount: 2,
				},
			],
			rules: [
				{
					ruleId: "22222222-2222-4222-8222-222222222222",
					ruleName: "Prometheus API",
					serviceId: "33333333-3333-4333-8333-333333333333",
					serviceName: "api-gateway",
					enabled: true,
					status: "never_matched",
					totalMatches: 0,
					windowMatches: 0,
					lastMatchedAt: null,
				},
				{
					ruleId: "44444444-4444-4444-8444-444444444444",
					ruleName: "Active Rule",
					serviceId: "33333333-3333-4333-8333-333333333333",
					serviceName: "api-gateway",
					enabled: true,
					status: "healthy",
					totalMatches: 10,
					windowMatches: 5,
					lastMatchedAt: "2026-08-20T12:00:00.000Z",
				},
			],
		};

		const parsed = AlertMappingHealthResponseSchema.parse(mockResponse);
		expect(parsed.summary.totalIssues).toBe(2);
		expect(parsed.issues).toHaveLength(2);
		expect(parsed.services).toHaveLength(2);
		expect(parsed.rules).toHaveLength(2);
	});
});
