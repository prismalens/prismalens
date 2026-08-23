// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Logger } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import { PrismaService } from "../../core/prisma/prisma.service.js";
import {
	type AlertInfo,
	AlertMappingService,
} from "./alert-mapping.service.js";
import type {
	CreateMappingRuleDto,
	UpdateMappingRuleDto,
} from "./dto/index.js";

const mockPrismaService = {
	alertMappingRule: {
		create: vi.fn(),
		findUnique: vi.fn(),
		findMany: vi.fn(),
		update: vi.fn(),
		delete: vi.fn(),
	},
	service: {
		findUnique: vi.fn(),
		findMany: vi.fn(),
	},
	alert: {
		findMany: vi.fn(),
	},
};

describe("AlertMappingService (BDD)", () => {
	let service: AlertMappingService;

	beforeEach(async () => {
		vi.clearAllMocks();
		vi.spyOn(Logger.prototype, "log").mockImplementation(() => {});
		vi.spyOn(Logger.prototype, "debug").mockImplementation(() => {});
		vi.spyOn(Logger.prototype, "error").mockImplementation(() => {});

		const module: TestingModule = await Test.createTestingModule({
			providers: [
				AlertMappingService,
				{ provide: PrismaService, useValue: mockPrismaService },
			],
		}).compile();

		service = module.get<AlertMappingService>(AlertMappingService);
	});

	describe("create", () => {
		it("should create mapping rule with provided data", async () => {
			const createDto: CreateMappingRuleDto = {
				name: "Production API Rule",
				description: "Route production API alerts",
				serviceId: "service-123",
				matchCriteria: { source: "prometheus", labels: { env: "prod" } },
				priority: 10,
				enabled: true,
			};

			const expectedRule = {
				id: "rule-123",
				name: createDto.name,
				description: createDto.description,
				serviceId: createDto.serviceId,
				matchCriteria: JSON.stringify(createDto.matchCriteria),
				priority: 10,
				enabled: true,
				createdAt: new Date(),
				updatedAt: new Date(),
			};

			mockPrismaService.alertMappingRule.create.mockResolvedValue(expectedRule);

			const result = await service.create(createDto);

			expect(result).toEqual(expectedRule);
			expect(mockPrismaService.alertMappingRule.create).toHaveBeenCalledWith({
				data: expect.objectContaining({
					name: "Production API Rule",
					serviceId: "service-123",
					priority: 10,
					enabled: true,
				}),
			});
		});

		it("should default priority to 100 and enabled to true", async () => {
			const createDto: CreateMappingRuleDto = {
				name: "Basic Rule",
				serviceId: "service-123",
				matchCriteria: { source: "github" },
			};

			const expectedRule = {
				id: "rule-123",
				name: createDto.name,
				serviceId: createDto.serviceId,
				matchCriteria: JSON.stringify(createDto.matchCriteria),
				priority: 100,
				enabled: true,
				createdAt: new Date(),
				updatedAt: new Date(),
			};

			mockPrismaService.alertMappingRule.create.mockResolvedValue(expectedRule);

			await service.create(createDto);

			expect(mockPrismaService.alertMappingRule.create).toHaveBeenCalledWith({
				data: expect.objectContaining({
					priority: 100,
					enabled: true,
				}),
			});
		});

		it("should convert matchCriteria object to JSON string", async () => {
			const createDto: CreateMappingRuleDto = {
				name: "Test Rule",
				serviceId: "service-123",
				matchCriteria: { source: "prometheus" },
			};

			mockPrismaService.alertMappingRule.create.mockResolvedValue({
				id: "rule-123",
				name: createDto.name,
				serviceId: createDto.serviceId,
				matchCriteria: JSON.stringify(createDto.matchCriteria),
				priority: 100,
				enabled: true,
				description: null,
				createdAt: new Date(),
				updatedAt: new Date(),
			});

			await service.create(createDto);

			expect(mockPrismaService.alertMappingRule.create).toHaveBeenCalledWith({
				data: expect.objectContaining({
					matchCriteria: expect.stringContaining("prometheus"),
				}),
			});
		});
	});

	describe("findAll", () => {
		it("should return all enabled rules ordered by priority", async () => {
			const rules = [
				{
					id: "rule-1",
					name: "High Priority",
					priority: 1,
					enabled: true,
					matchCriteria: "{}",
					serviceId: "service-1",
					description: null,
					createdAt: new Date(),
					updatedAt: new Date(),
				},
				{
					id: "rule-2",
					name: "Low Priority",
					priority: 100,
					enabled: true,
					matchCriteria: "{}",
					serviceId: "service-2",
					description: null,
					createdAt: new Date(),
					updatedAt: new Date(),
				},
			];

			mockPrismaService.alertMappingRule.findMany.mockResolvedValue(rules);

			const result = await service.findAll({ enabled: true });

			expect(result).toEqual(rules);
			expect(mockPrismaService.alertMappingRule.findMany).toHaveBeenCalledWith({
				where: { enabled: true },
				include: { service: true },
				orderBy: { priority: "asc" },
			});
		});

		it("should only return enabled rules", async () => {
			const enabledRule = {
				id: "rule-1",
				name: "Enabled",
				enabled: true,
				priority: 1,
				matchCriteria: "{}",
				serviceId: "service-1",
				description: null,
				createdAt: new Date(),
				updatedAt: new Date(),
			};

			mockPrismaService.alertMappingRule.findMany.mockResolvedValue([
				enabledRule,
			]);

			await service.findAll({ enabled: true });

			expect(mockPrismaService.alertMappingRule.findMany).toHaveBeenCalledWith({
				where: { enabled: true },
				include: { service: true },
				orderBy: { priority: "asc" },
			});
		});
	});

	describe("findById", () => {
		it("should return rule when found", async () => {
			const ruleId = "rule-123";
			const expectedRule = {
				id: ruleId,
				name: "Test Rule",
				enabled: true,
				priority: 1,
				matchCriteria: "{}",
				serviceId: "service-1",
				description: null,
				createdAt: new Date(),
				updatedAt: new Date(),
			};

			mockPrismaService.alertMappingRule.findUnique.mockResolvedValue(
				expectedRule,
			);

			const result = await service.findById(ruleId);

			expect(result).toEqual(expectedRule);
			expect(
				mockPrismaService.alertMappingRule.findUnique,
			).toHaveBeenCalledWith({
				where: { id: ruleId },
				include: { service: true },
			});
		});

		it("should return null when rule not found", async () => {
			mockPrismaService.alertMappingRule.findUnique.mockResolvedValue(null);

			const result = await service.findById("non-existent");

			expect(result).toBeNull();
		});
	});

	describe("update", () => {
		it("should update rule with provided fields", async () => {
			const ruleId = "rule-123";
			const updateDto: UpdateMappingRuleDto = {
				name: "Updated Name",
				priority: 50,
			};

			const updatedRule = {
				id: ruleId,
				name: "Updated Name",
				enabled: true,
				priority: 50,
				matchCriteria: "{}",
				serviceId: "service-1",
				description: null,
				createdAt: new Date(),
				updatedAt: new Date(),
			};

			mockPrismaService.alertMappingRule.update.mockResolvedValue(updatedRule);

			const result = await service.update(ruleId, updateDto);

			expect(result).toEqual(updatedRule);
			expect(mockPrismaService.alertMappingRule.update).toHaveBeenCalledWith({
				where: { id: ruleId },
				data: expect.objectContaining({
					name: "Updated Name",
					priority: 50,
				}),
			});
		});

		it("should update matchCriteria when provided", async () => {
			const ruleId = "rule-123";
			const updateDto: UpdateMappingRuleDto = {
				matchCriteria: { source: "datadog" },
			};

			mockPrismaService.alertMappingRule.update.mockResolvedValue({
				id: ruleId,
				name: "Test",
				enabled: true,
				priority: 1,
				matchCriteria: JSON.stringify({ source: "datadog" }),
				serviceId: "service-1",
				description: null,
				createdAt: new Date(),
				updatedAt: new Date(),
			});

			await service.update(ruleId, updateDto);

			expect(mockPrismaService.alertMappingRule.update).toHaveBeenCalledWith({
				where: { id: ruleId },
				data: expect.objectContaining({
					matchCriteria: expect.stringContaining("datadog"),
				}),
			});
		});

		it("should update enabled status", async () => {
			const ruleId = "rule-123";
			const updateDto: UpdateMappingRuleDto = {
				enabled: false,
			};

			mockPrismaService.alertMappingRule.update.mockResolvedValue({
				id: ruleId,
				name: "Test",
				enabled: false,
				priority: 1,
				matchCriteria: "{}",
				serviceId: "service-1",
				description: null,
				createdAt: new Date(),
				updatedAt: new Date(),
			});

			await service.update(ruleId, updateDto);

			expect(mockPrismaService.alertMappingRule.update).toHaveBeenCalledWith({
				where: { id: ruleId },
				data: expect.objectContaining({
					enabled: false,
				}),
			});
		});
	});

	describe("delete", () => {
		it("should delete rule", async () => {
			const ruleId = "rule-123";
			mockPrismaService.alertMappingRule.delete.mockResolvedValue({});

			await service.delete(ruleId);

			expect(mockPrismaService.alertMappingRule.delete).toHaveBeenCalledWith({
				where: { id: ruleId },
			});
		});
	});

	describe("resolveServiceForAlert", () => {
		it("should return service for matching alert", async () => {
			const alert: AlertInfo = {
				source: "prometheus",
				title: "High Memory Usage",
				labels: { env: "prod" },
			};

			const rule = {
				id: "rule-1",
				name: "Prod Rule",
				enabled: true,
				priority: 1,
				matchCriteria: JSON.stringify({
					source: "prometheus",
					labels: { env: "prod" },
				}),
				serviceId: "service-1",
				description: null,
				createdAt: new Date(),
				updatedAt: new Date(),
			};

			const expectedService = {
				id: "service-1",
				name: "API Service",
				createdAt: new Date(),
				updatedAt: new Date(),
				discoverySource: null,
				discoveryPath: null,
			};

			mockPrismaService.alertMappingRule.findMany.mockResolvedValue([rule]);
			mockPrismaService.service.findUnique.mockResolvedValue(expectedService);

			const result = await service.resolveServiceForAlert(alert);

			expect(result).toEqual(expectedService);
			expect(mockPrismaService.service.findUnique).toHaveBeenCalledWith({
				where: { id: "service-1" },
			});
		});

		it("should return null when no rules match", async () => {
			const alert: AlertInfo = {
				source: "prometheus",
				title: "High Memory Usage",
				labels: { env: "dev" },
			};

			const rule = {
				id: "rule-1",
				name: "Prod Rule",
				enabled: true,
				priority: 1,
				matchCriteria: JSON.stringify({
					source: "prometheus",
					labels: { env: "prod" },
				}),
				serviceId: "service-1",
				description: null,
				createdAt: new Date(),
				updatedAt: new Date(),
			};

			mockPrismaService.alertMappingRule.findMany.mockResolvedValue([rule]);

			const result = await service.resolveServiceForAlert(alert);

			expect(result).toBeNull();
			expect(mockPrismaService.service.findUnique).not.toHaveBeenCalled();
		});

		it("should evaluate rules in priority order", async () => {
			const alert: AlertInfo = {
				source: "prometheus",
				title: "Test Alert",
				labels: { env: "prod" },
			};

			const rules = [
				{
					id: "rule-1",
					name: "High Priority",
					enabled: true,
					priority: 1,
					matchCriteria: JSON.stringify({ source: "prometheus" }),
					serviceId: "service-1",
					description: null,
					createdAt: new Date(),
					updatedAt: new Date(),
				},
				{
					id: "rule-2",
					name: "Low Priority",
					enabled: true,
					priority: 100,
					matchCriteria: JSON.stringify({ source: "prometheus" }),
					serviceId: "service-2",
					description: null,
					createdAt: new Date(),
					updatedAt: new Date(),
				},
			];

			const expectedService = { id: "service-1", name: "Service 1" };

			mockPrismaService.alertMappingRule.findMany.mockResolvedValue(rules);
			mockPrismaService.service.findUnique.mockResolvedValue(expectedService);

			await service.resolveServiceForAlert(alert);

			// Should query service for rule-1 (highest priority)
			expect(mockPrismaService.service.findUnique).toHaveBeenCalledWith({
				where: { id: "service-1" },
			});
		});

		it("should match alerts with wildcard label patterns", async () => {
			const alert: AlertInfo = {
				source: "prometheus",
				title: "API Alert",
				labels: { alert_name: "api-high-latency" },
			};

			const rule = {
				id: "rule-1",
				name: "API Pattern Rule",
				enabled: true,
				priority: 1,
				matchCriteria: JSON.stringify({ labels: { alert_name: "api-*" } }),
				serviceId: "service-1",
				description: null,
				createdAt: new Date(),
				updatedAt: new Date(),
			};

			const expectedService = { id: "service-1", name: "API Service" };

			mockPrismaService.alertMappingRule.findMany.mockResolvedValue([rule]);
			mockPrismaService.service.findUnique.mockResolvedValue(expectedService);

			const result = await service.resolveServiceForAlert(alert);

			expect(result).toEqual(expectedService);
		});

		it("should not match alerts when wildcard pattern does not match", async () => {
			const alert: AlertInfo = {
				source: "prometheus",
				title: "Database Alert",
				labels: { alert_name: "db-connection-failed" },
			};

			const rule = {
				id: "rule-1",
				name: "API Pattern Rule",
				enabled: true,
				priority: 1,
				matchCriteria: JSON.stringify({ labels: { alert_name: "api-*" } }),
				serviceId: "service-1",
				description: null,
				createdAt: new Date(),
				updatedAt: new Date(),
			};

			mockPrismaService.alertMappingRule.findMany.mockResolvedValue([rule]);

			const result = await service.resolveServiceForAlert(alert);

			expect(result).toBeNull();
		});

		it("should match alerts by tags", async () => {
			const alert: AlertInfo = {
				source: "prometheus",
				title: "Test Alert",
				tags: ["critical", "database"],
			};

			const rule = {
				id: "rule-1",
				name: "Critical Rule",
				enabled: true,
				priority: 1,
				matchCriteria: JSON.stringify({ tags: ["critical", "warning"] }),
				serviceId: "service-1",
				description: null,
				createdAt: new Date(),
				updatedAt: new Date(),
			};

			const expectedService = { id: "service-1", name: "Critical Service" };

			mockPrismaService.alertMappingRule.findMany.mockResolvedValue([rule]);
			mockPrismaService.service.findUnique.mockResolvedValue(expectedService);

			const result = await service.resolveServiceForAlert(alert);

			expect(result).toEqual(expectedService);
		});

		it("should handle invalid JSON in rule criteria gracefully", async () => {
			const alert: AlertInfo = {
				source: "prometheus",
				title: "Test Alert",
			};

			const rule = {
				id: "rule-1",
				name: "Bad Rule",
				enabled: true,
				priority: 1,
				matchCriteria: "invalid json",
				serviceId: "service-1",
				description: null,
				createdAt: new Date(),
				updatedAt: new Date(),
			};

			mockPrismaService.alertMappingRule.findMany.mockResolvedValue([rule]);

			const result = await service.resolveServiceForAlert(alert);

			expect(result).toBeNull();
		});
	});

	describe("getHealth", () => {
		it("should return empty health summary when no services and no rules exist", async () => {
			mockPrismaService.service.findMany.mockResolvedValue([]);
			mockPrismaService.alertMappingRule.findMany.mockResolvedValue([]);
			mockPrismaService.alert.findMany.mockResolvedValue([]);

			const health = await service.getHealth();

			expect(health.summary).toEqual({
				totalIssues: 0,
				unmappedServicesCount: 0,
				neverMatchedRulesCount: 0,
				stoppedMatchingRulesCount: 0,
				healthyRulesCount: 0,
				disabledRulesCount: 0,
				totalRules: 0,
				totalServices: 0,
				windowHours: 168,
			});
			expect(health.issues).toEqual([]);
			expect(health.services).toEqual([]);
			expect(health.rules).toEqual([]);
		});

		it("should detect unmapped services when services have no enabled rules", async () => {
			const services = [
				{
					id: "s-1",
					name: "auth-service",
					displayName: "Auth Service",
					createdAt: new Date(),
					updatedAt: new Date(),
				},
				{
					id: "s-2",
					name: "billing-service",
					displayName: "Billing Service",
					createdAt: new Date(),
					updatedAt: new Date(),
				},
			];

			const rules = [
				{
					id: "r-1",
					name: "Disabled Auth Rule",
					serviceId: "s-1",
					enabled: false,
					priority: 100,
					matchCriteria: JSON.stringify({ source: "auth" }),
					createdAt: new Date(),
					updatedAt: new Date(),
					service: services[0],
				},
			];

			mockPrismaService.service.findMany.mockResolvedValue(services);
			mockPrismaService.alertMappingRule.findMany.mockResolvedValue(rules);
			mockPrismaService.alert.findMany.mockResolvedValue([]);

			const health = await service.getHealth();

			expect(health.summary.unmappedServicesCount).toBe(2);
			expect(health.summary.disabledRulesCount).toBe(1);
			expect(health.summary.totalIssues).toBe(2);

			const unmappedIssues = health.issues.filter(
				(i) => i.type === "unmapped_service",
			);
			expect(unmappedIssues).toHaveLength(2);
			expect(unmappedIssues.map((i) => i.serviceId)).toEqual(["s-1", "s-2"]);
		});

		it("should distinguish never_matched rules from stopped_matching rules", async () => {
			const now = new Date();
			const tenDaysAgo = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000);
			const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);

			const services = [
				{
					id: "s-1",
					name: "api-gateway",
					displayName: "API Gateway",
					createdAt: new Date(),
					updatedAt: new Date(),
				},
			];

			const rules = [
				{
					id: "r-never",
					name: "Never Matched Rule",
					serviceId: "s-1",
					enabled: true,
					priority: 10,
					matchCriteria: JSON.stringify({ source: "rare-source" }),
					createdAt: new Date(),
					updatedAt: new Date(),
					service: services[0],
				},
				{
					id: "r-stopped",
					name: "Stopped Matching Rule",
					serviceId: "s-1",
					enabled: true,
					priority: 20,
					matchCriteria: JSON.stringify({ source: "old-source" }),
					createdAt: new Date(),
					updatedAt: new Date(),
					service: services[0],
				},
				{
					id: "r-healthy",
					name: "Healthy Rule",
					serviceId: "s-1",
					enabled: true,
					priority: 30,
					matchCriteria: JSON.stringify({ source: "live-source" }),
					createdAt: new Date(),
					updatedAt: new Date(),
					service: services[0],
				},
			];

			const alerts = [
				// An alert matching r-stopped from 10 days ago (outside 7-day window)
				{
					id: "a-old",
					title: "Old Alert",
					source: "old-source",
					labels: null,
					tags: null,
					triggeredAt: tenDaysAgo,
				},
				// An alert matching r-healthy from 2 hours ago (inside 7-day window)
				{
					id: "a-live",
					title: "Live Alert",
					source: "live-source",
					labels: null,
					tags: null,
					triggeredAt: twoHoursAgo,
				},
			];

			mockPrismaService.service.findMany.mockResolvedValue(services);
			mockPrismaService.alertMappingRule.findMany.mockResolvedValue(rules);
			mockPrismaService.alert.findMany.mockResolvedValue(alerts);

			const health = await service.getHealth({ windowHours: 168 });

			// Service has enabled rules, so unmappedServicesCount is 0
			expect(health.summary.unmappedServicesCount).toBe(0);
			expect(health.summary.neverMatchedRulesCount).toBe(1);
			expect(health.summary.stoppedMatchingRulesCount).toBe(1);
			expect(health.summary.healthyRulesCount).toBe(1);
			expect(health.summary.totalIssues).toBe(2);

			const neverMatchedIssue = health.issues.find(
				(i) => i.type === "never_matched",
			);
			expect(neverMatchedIssue?.ruleId).toBe("r-never");
			expect(neverMatchedIssue?.lastMatchedAt).toBeNull();

			const stoppedIssue = health.issues.find(
				(i) => i.type === "stopped_matching",
			);
			expect(stoppedIssue?.ruleId).toBe("r-stopped");
			expect(stoppedIssue?.lastMatchedAt).toBe(tenDaysAgo.toISOString());

			const healthyRule = health.rules.find((r) => r.ruleId === "r-healthy");
			expect(healthyRule?.status).toBe("healthy");
			expect(healthyRule?.windowMatches).toBe(1);
			expect(healthyRule?.totalMatches).toBe(1);
		});

		it("should evaluate matches in priority order so lower priority rule does not steal alerts", async () => {
			const services = [
				{ id: "s-1", name: "api", displayName: "API" },
			];
			const now = new Date();

			const rules = [
				{
					id: "r-high",
					name: "High Priority",
					serviceId: "s-1",
					enabled: true,
					priority: 1,
					matchCriteria: JSON.stringify({ source: "common" }),
					createdAt: new Date(),
					updatedAt: new Date(),
					service: services[0],
				},
				{
					id: "r-low",
					name: "Low Priority",
					serviceId: "s-1",
					enabled: true,
					priority: 100,
					matchCriteria: JSON.stringify({ source: "common" }),
					createdAt: new Date(),
					updatedAt: new Date(),
					service: services[0],
				},
			];

			const alerts = [
				{
					id: "a-1",
					title: "Common Alert",
					source: "common",
					labels: null,
					tags: null,
					triggeredAt: now,
				},
			];

			mockPrismaService.service.findMany.mockResolvedValue(services);
			mockPrismaService.alertMappingRule.findMany.mockResolvedValue(rules);
			mockPrismaService.alert.findMany.mockResolvedValue(alerts);

			const health = await service.getHealth();

			const highRuleHealth = health.rules.find((r) => r.ruleId === "r-high");
			const lowRuleHealth = health.rules.find((r) => r.ruleId === "r-low");

			expect(highRuleHealth?.status).toBe("healthy");
			expect(highRuleHealth?.windowMatches).toBe(1);

			expect(lowRuleHealth?.status).toBe("never_matched");
			expect(lowRuleHealth?.windowMatches).toBe(0);
		});
	});
});
