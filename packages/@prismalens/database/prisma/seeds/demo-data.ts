// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { PrismaClient } from "../../prisma/generated/client.js";

export interface SeedPrismaClient {
	service: {
		upsert: PrismaClient["service"]["upsert"];
	};
	correlationRule: {
		upsert: PrismaClient["correlationRule"]["upsert"];
	};
	incident: {
		upsert: PrismaClient["incident"]["upsert"];
	};
	alert: {
		upsert: PrismaClient["alert"]["upsert"];
	};
	investigation: {
		upsert: PrismaClient["investigation"]["upsert"];
	};
}

/**
 * Seed demo data into an empty PrismaLens database.
 * Pure Prisma writes — no auth/HTTP dependencies.
 * Idempotent: safe to run multiple times against the same DB.
 */
export async function seedDemoData(prisma: SeedPrismaClient): Promise<void> {
	// ---------------------------------------------------------------------------
	// 1. Monitored Services (4-5 services across tiers)
	// ---------------------------------------------------------------------------
	const services = [
		{
			id: "11111111-1111-4111-8111-111111111111",
			name: "api-gateway",
			displayName: "API Gateway",
			description: "Main ingress API gateway and request router",
			type: "gateway",
			tier: "tier_1",
			team: "platform-eng",
			slackChannel: "#alerts-gateway",
		},
		{
			id: "22222222-2222-4222-8222-222222222222",
			name: "auth-service",
			displayName: "Auth Service",
			description: "User authentication, OAuth, and session tokens",
			type: "service",
			tier: "tier_1",
			team: "security-team",
			slackChannel: "#alerts-auth",
		},
		{
			id: "33333333-3333-4333-8333-333333333333",
			name: "payment-service",
			displayName: "Payment Service",
			description: "Billing, Stripe integration, and payment processing",
			type: "service",
			tier: "tier_2",
			team: "billing-team",
			slackChannel: "#alerts-payments",
		},
		{
			id: "44444444-4444-4444-8444-444444444444",
			name: "notification-service",
			displayName: "Notification Service",
			description: "Email, SMS, and Webhook alert notifications",
			type: "service",
			tier: "tier_3",
			team: "comms-team",
			slackChannel: "#alerts-notifications",
		},
		{
			id: "55555555-5555-4555-8555-555555555555",
			name: "analytics-pipeline",
			displayName: "Analytics Pipeline",
			description: "Async event stream processing queue",
			type: "queue",
			tier: "tier_4",
			team: "data-eng",
			slackChannel: "#alerts-data",
		},
	];

	for (const service of services) {
		await prisma.service.upsert({
			where: { id: service.id },
			create: service,
			update: {},
		});
	}

	// ---------------------------------------------------------------------------
	// 2. Correlation Rules (1 correlate, 1 suppress)
	// ---------------------------------------------------------------------------
	const rules = [
		{
			id: "c0111111-1111-4111-8111-111111111111",
			name: "storm-error-correlation",
			description: "Correlate error rate spikes across gateway & auth service",
			enabled: true,
			priority: 10,
			matchCriteria: JSON.stringify({
				serviceId: {
					in: [
						"11111111-1111-4111-8111-111111111111",
						"22222222-2222-4222-8222-222222222222",
					],
				},
			}),
			timeWindowMinutes: 30,
			action: "correlate",
		},
		{
			id: "c0222222-2222-4222-8222-222222222222",
			name: "maintenance-suppression-rule",
			description: "Suppress low-severity synthetic probe alerts during window",
			enabled: true,
			priority: 1,
			matchCriteria: JSON.stringify({
				labels: { maintenance: "true" },
			}),
			timeWindowMinutes: 60,
			action: "suppress",
		},
	];

	for (const rule of rules) {
		await prisma.correlationRule.upsert({
			where: { id: rule.id },
			create: rule,
			update: {},
		});
	}

	// ---------------------------------------------------------------------------
	// 3. Incidents (Sequential application-managed numbers 1, 2, 3)
	// ---------------------------------------------------------------------------
	const baseDate = new Date("2026-08-03T12:00:00Z");

	const incidents = [
		{
			id: "b0111111-1111-4111-8111-111111111111",
			number: 1,
			title: "[demo] Storm: High 5xx error rate on API Gateway & Auth timeout",
			description:
				"Cascade of 5xx errors on api-gateway following auth-service connection pool saturation.",
			severity: "critical",
			status: "investigating",
			priority: "p1",
			serviceId: "11111111-1111-4111-8111-111111111111",
			correlationReason:
				"Correlated 10 high-rate error alerts within 15m window",
			correlationRuleId: "c0111111-1111-4111-8111-111111111111",
			alertCount: 10,
			triggeredAt: new Date(baseDate.getTime() - 60 * 60 * 1000),
		},
		{
			id: "b0222222-2222-4222-8222-222222222222",
			number: 2,
			title: "[demo] Payment Service latency degradation p99 > 2000ms",
			description:
				"Elevated response times during peak checkout window, likely external gateway throttling.",
			severity: "high",
			status: "identified",
			priority: "p2",
			serviceId: "33333333-3333-4333-8333-333333333333",
			correlationReason: "3 correlated latency alerts on payment-service",
			alertCount: 3,
			triggeredAt: new Date(baseDate.getTime() - 3 * 60 * 60 * 1000),
		},
		{
			id: "b0333333-3333-4333-8333-333333333333",
			number: 3,
			title: "[demo] Notification Service message queue backlog build-up",
			description:
				"BullMQ queue size exceeds threshold (12,400 messages pending).",
			severity: "medium",
			status: "monitoring",
			priority: "p3",
			serviceId: "44444444-4444-4444-8444-444444444444",
			correlationReason: "2 correlated queue backlog alerts",
			alertCount: 2,
			triggeredAt: new Date(baseDate.getTime() - 6 * 60 * 60 * 1000),
		},
	];

	for (const incident of incidents) {
		await prisma.incident.upsert({
			where: { id: incident.id },
			create: incident,
			update: {},
		});
	}

	// ---------------------------------------------------------------------------
	// 4. Alerts (~60 total: 1 suppressed + 15 correlated + 44 general)
	// ---------------------------------------------------------------------------
	// (a) 1 Suppressed alert (#244 path)
	const suppressedAlert = {
		id: "a0000000-0000-4000-8000-000000000000",
		dedupKey: "demo-suppressed-maintenance-probe",
		title: "[demo] Suppressed: Maintenance probe synthetic healthcheck failure",
		description:
			"Synthetic health check suppressed by rule maintenance-suppression-rule",
		severity: "low",
		status: "suppressed",
		source: "prometheus",
		serviceId: "55555555-5555-4555-8555-555555555555",
		incidentId: null,
		triggeredAt: new Date(baseDate.getTime() - 10 * 60 * 1000),
		labels: JSON.stringify({ maintenance: "true", env: "dev" }),
	};
	await prisma.alert.upsert({
		where: { id: suppressedAlert.id },
		create: suppressedAlert,
		update: {},
	});

	// (b) 10 Alerts for Storm Incident #1
	for (let i = 0; i < 10; i++) {
		const alertId = `a1111111-1111-4111-8111-1111111111${i.toString().padStart(2, "0")}`;
		const isGateway = i % 2 === 0;
		const alert = {
			id: alertId,
			dedupKey: `demo-storm-alert-${i}`,
			title: `[demo] Storm alert #${i + 1}: ${
				isGateway
					? "API Gateway HTTP 502 Bad Gateway"
					: "Auth Service Connection Timeout"
			}`,
			description: `High error rate observed on ${
				isGateway ? "api-gateway" : "auth-service"
			} during traffic burst`,
			severity: i < 3 ? "critical" : "high",
			status: i < 5 ? "triggered" : "acknowledged",
			source: "prometheus",
			serviceId: isGateway
				? "11111111-1111-4111-8111-111111111111"
				: "22222222-2222-4222-8222-222222222222",
			incidentId: "b0111111-1111-4111-8111-111111111111",
			triggeredAt: new Date(baseDate.getTime() - (60 - i * 2) * 60 * 1000),
			labels: JSON.stringify({ storm: "true", index: String(i) }),
		};
		await prisma.alert.upsert({
			where: { id: alert.id },
			create: alert,
			update: {},
		});
	}

	// (c) 3 Alerts for Incident #2
	for (let i = 0; i < 3; i++) {
		const alertId = `a2222222-2222-4222-8222-2222222222${i.toString().padStart(2, "0")}`;
		const alert = {
			id: alertId,
			dedupKey: `demo-incident2-alert-${i}`,
			title: `[demo] Payment latency spike chunk #${i + 1}`,
			description: "Stripe webhook dispatch response time exceeded 2500ms",
			severity: "high",
			status: "acknowledged",
			source: "datadog",
			serviceId: "33333333-3333-4333-8333-333333333333",
			incidentId: "b0222222-2222-4222-8222-222222222222",
			triggeredAt: new Date(baseDate.getTime() - (180 - i * 5) * 60 * 1000),
			labels: JSON.stringify({ service: "payment-service" }),
		};
		await prisma.alert.upsert({
			where: { id: alert.id },
			create: alert,
			update: {},
		});
	}

	// (d) 2 Alerts for Incident #3
	for (let i = 0; i < 2; i++) {
		const alertId = `a3333333-3333-4333-8333-3333333333${i.toString().padStart(2, "0")}`;
		const alert = {
			id: alertId,
			dedupKey: `demo-incident3-alert-${i}`,
			title: `[demo] Queue threshold warning #${i + 1}`,
			description:
				"Notification worker processing rate below incoming queue speed",
			severity: "medium",
			status: "triggered",
			source: "prometheus",
			serviceId: "44444444-4444-4444-8444-444444444444",
			incidentId: "b0333333-3333-4333-8333-333333333333",
			triggeredAt: new Date(baseDate.getTime() - (360 - i * 10) * 60 * 1000),
			labels: JSON.stringify({ service: "notification-service" }),
		};
		await prisma.alert.upsert({
			where: { id: alert.id },
			create: alert,
			update: {},
		});
	}

	// (e) 44 Standalone / Unassigned Alerts to bring total alerts to exactly 60
	const serviceIds = [
		"11111111-1111-4111-8111-111111111111",
		"22222222-2222-4222-8222-222222222222",
		"33333333-3333-4333-8333-333333333333",
		"44444444-4444-4444-8444-444444444444",
		"55555555-5555-4555-8555-555555555555",
	];
	const severities = ["low", "medium", "high", "critical", "info"];
	const statuses = ["triggered", "acknowledged", "resolved"];

	for (let i = 0; i < 44; i++) {
		const alertId = `a9999999-9999-4999-8999-999999${i.toString().padStart(6, "0")}`;
		const serviceId = serviceIds[i % serviceIds.length];
		const severity = severities[i % severities.length];
		const status = statuses[i % statuses.length];

		const alert = {
			id: alertId,
			dedupKey: `demo-standalone-alert-${i}`,
			title: `[demo] Service metrics telemetry warning #${i + 1}`,
			description: `Deterministic background metric signal #${i + 1} for ${serviceId}`,
			severity,
			status,
			source: "prometheus",
			serviceId,
			incidentId: null,
			triggeredAt: new Date(baseDate.getTime() - (i + 1) * 30 * 60 * 1000),
			labels: JSON.stringify({ env: "development", index: String(i) }),
		};

		await prisma.alert.upsert({
			where: { id: alert.id },
			create: alert,
			update: {},
		});
	}

	// ---------------------------------------------------------------------------
	// 5. Investigations (#282/ADR-0026 culprit rendering proof)
	// ---------------------------------------------------------------------------
	// (a) Investigation with populated culprit (under Storm Incident 1)
	const inv1Report = {
		summary:
			"Database connection pool exhaustion caused cascading 5xx gateway errors.",
		rootCause:
			"Connection pool size in auth-service was misconfigured and capped at 10 pool connections after release v2.4.1.",
		rootCauseCategory: "config",
		culprit: {
			service: "auth-service",
			changeRef: "v2.4.1",
			mechanism: "connection-pool exhaustion",
		},
		hypotheses: [
			{
				statement:
					"Auth service DB connection pool limit reached under peak load",
				status: "supported",
				evidence: [
					{
						observation:
							"Active connections metric spiked to pool limit (10/10)",
						source: "prometheus:db_pool_active",
						direction: "supports",
						status: "verified",
					},
				],
			},
		],
		ruledOut: [
			{
				statement:
					"Network connectivity outage between gateway and auth service",
				why: "Ping latency and HTTP connection metrics remained normal",
				evidence: [
					{
						observation: "RTT latency between services remained below 1ms",
						source: "network_probe",
						direction: "contradicts",
						status: "verified",
					},
				],
			},
		],
		coverage: {
			queried: ["prometheus", "application_logs", "deployment_history"],
			notQueried: ["tracing_spans"],
		},
		nextSteps: [
			{
				title: "Increase auth-service DB connection pool",
				detail: "Set AUTH_DB_POOL_MAX to 50 in deployment config",
				priority: "high",
			},
		],
	};

	const inv1 = {
		id: "d0111111-1111-4111-8111-111111111111",
		incidentId: "b0111111-1111-4111-8111-111111111111",
		status: "completed",
		summary: inv1Report.summary,
		rootCause: inv1Report.rootCause,
		rootCauseCategory: inv1Report.rootCauseCategory,
		report: JSON.stringify(inv1Report),
		triggerType: "auto_critical",
		triggerReason: "Incident severity is critical",
	};

	await prisma.investigation.upsert({
		where: { id: inv1.id },
		create: inv1,
		update: {},
	});

	// (b) Investigation with culprit: null (under Incident 2)
	const inv2Report = {
		summary: "Payment service latency elevation under active investigation.",
		rootCause:
			"Upstream payment provider experiencing elevated processing latencies.",
		rootCauseCategory: "external",
		culprit: null,
		hypotheses: [
			{
				statement: "External payment gateway API throttling or slowdown",
				status: "supported",
				evidence: [
					{
						observation: "Stripe API response times averaged 2300ms",
						source: "payment_gateway_metrics",
						direction: "supports",
						status: "verified",
					},
				],
			},
		],
		ruledOut: [],
		coverage: {
			queried: ["external_api_logs", "service_metrics"],
			notQueried: ["db_queries"],
		},
		nextSteps: [
			{
				title: "Contact payment gateway vendor support",
				detail: "Escalate latency ticket with payment provider",
				priority: "medium",
			},
		],
	};

	const inv2 = {
		id: "d0222222-2222-4222-8222-222222222222",
		incidentId: "b0222222-2222-4222-8222-222222222222",
		status: "completed",
		summary: inv2Report.summary,
		rootCause: inv2Report.rootCause,
		rootCauseCategory: inv2Report.rootCauseCategory,
		report: JSON.stringify(inv2Report),
		triggerType: "manual",
		triggerReason: "Triggered by on-call engineer",
	};

	await prisma.investigation.upsert({
		where: { id: inv2.id },
		create: inv2,
		update: {},
	});
}
