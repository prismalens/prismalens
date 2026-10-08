// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { ORPCError } from "@orpc/nest";
import type { HarnessSelection } from "@prismalens/config/harness-selection";
import { describe, expect, it, vi } from "vitest";
import type { HarnessService } from "../../core/harness/harness.service.js";
import type { DispatchService } from "../../infrastructure/dispatch/dispatch.service.js";
import type { IntegrationsService } from "../integrations/integrations.service.js";
import type { InvestigationsService } from "../investigations/investigations.service.js";
import { IncidentsController } from "./incidents.controller.js";
import type { IncidentsService } from "./incidents.service.js";

describe("IncidentsController - storm path alert serialization", () => {
	function getHandlers(controller: IncidentsController) {
		const procedures = controller.incidents() as unknown as Record<
			string,
			{ "~orpc"?: { handler: (args: { input: unknown }) => Promise<unknown> } }
		>;
		return Object.fromEntries(
			Object.entries(procedures).map(([key, proc]) => [
				key,
				proc?.["~orpc"]?.handler ?? proc,
			]),
		) as Record<
			string,
			(args: { input: { id: string } }) => Promise<Record<string, unknown>>
		>;
	}

	it("preserves full alert objects with labels, annotations, and timestamps in serializeIncidentWithRelations", async () => {
		const incidentsService = {
			findDetail(id: string) { return this.findById(id); },
			findById: vi.fn().mockResolvedValue({
				id: "123e4567-e89b-12d3-a456-426614174000",
				number: 1,
				title: "Storm Incident",
				severity: "critical",
				status: "triggered",
				priority: "p1",
				triggeredAt: new Date("2026-07-31T10:00:00Z"),
				createdAt: new Date("2026-07-31T10:00:00Z"),
				updatedAt: new Date("2026-07-31T10:00:00Z"),
				alertCount: 2,
				alerts: [
					{
						id: "alert-1",
						dedupKey: "key-1",
						title: "Alert One",
						severity: "critical",
						status: "correlated",
						labels: JSON.stringify({ service: "checkout", environment: "prod" }),
						description: "High latency on checkout service",
						triggeredAt: new Date("2026-07-31T10:00:00Z"),
						lastOccurrence: new Date("2026-07-31T10:00:00Z"),
						createdAt: new Date("2026-07-31T10:00:00Z"),
						updatedAt: new Date("2026-07-31T10:00:00Z"),
					},
					{
						id: "alert-2",
						dedupKey: "key-2",
						title: "Alert Two",
						severity: "high",
						status: "correlated",
						labels: JSON.stringify({ service: "checkout", component: "db" }),
						description: "Connection pool exhausted",
						triggeredAt: new Date("2026-07-31T10:01:00Z"),
						lastOccurrence: new Date("2026-07-31T10:01:00Z"),
						createdAt: new Date("2026-07-31T10:01:00Z"),
						updatedAt: new Date("2026-07-31T10:01:00Z"),
					},
				],
			}),
			update: vi.fn().mockResolvedValue({}),
		};

		const investigationsService = {
			startOrGet: vi.fn().mockResolvedValue({ investigation: { id: "inv-123" }, created: true }),
		};

		const dispatchService = {
			addInvestigationJob: vi.fn().mockResolvedValue("job-123"),
		};

		const integrationsService = {
			getIntegrationsForService: vi.fn().mockResolvedValue([]),
		};

		const harnessService = {
			ensureReady: vi.fn().mockResolvedValue({ ready: true }),
			resolveSelection: vi.fn().mockResolvedValue({
				runnable: true,
				harness: "deepagents",
				auto: true,
			} satisfies HarnessSelection),
		};

		const controller = new IncidentsController(
			incidentsService as unknown as IncidentsService,
			investigationsService as unknown as InvestigationsService,
			dispatchService as unknown as DispatchService,
			integrationsService as unknown as IntegrationsService,
			harnessService as unknown as HarnessService,
			{} as never,
		);

		const handlers = getHandlers(controller);

		// Test get incident endpoint
		const result = await handlers.get({
			input: { id: "123e4567-e89b-12d3-a456-426614174000" },
		});

		expect(result.alerts).toHaveLength(2);
		expect((result.alerts as Record<string, unknown>[])?.[0]?.labels).toEqual({
			service: "checkout",
			environment: "prod",
		});
		expect((result.alerts as Record<string, unknown>[])?.[1]?.labels).toEqual({
			service: "checkout",
			component: "db",
		});

		// Test investigate endpoint passes alerts into the job payload
		await handlers.investigate({
			input: { id: "123e4567-e89b-12d3-a456-426614174000" },
		});

		expect(dispatchService.addInvestigationJob).toHaveBeenCalledWith(
			expect.objectContaining({
				incidentId: "123e4567-e89b-12d3-a456-426614174000",
				investigationId: "inv-123",
				alerts: [
					expect.objectContaining({
						alertname: "Alert One",
						severity: "critical",
						labels: { service: "checkout", environment: "prod" },
					}),
					expect.objectContaining({
						alertname: "Alert Two",
						severity: "high",
						labels: { service: "checkout", component: "db" },
					}),
				],
			}),
		);
	});

	// Follow-up 4b, issue #302: serializeAlert used to spread the raw Prisma
	// row, which put `tenantId` (ADR-0011 §6's dormant multi-tenancy hedge) on
	// the incident-detail response. Whitelisting must keep it out even if oRPC
	// output validation is ever loosened or bypassed — defense in depth.
	it("never leaks tenantId (or other non-contract columns) via serializeAlert", async () => {
		const incidentsService = {
			findDetail(id: string) { return this.findById(id); },
			findById: vi.fn().mockResolvedValue({
				id: "123e4567-e89b-12d3-a456-426614174000",
				number: 1,
				title: "Storm Incident",
				severity: "critical",
				status: "triggered",
				priority: "p1",
				triggeredAt: new Date("2026-07-31T10:00:00Z"),
				createdAt: new Date("2026-07-31T10:00:00Z"),
				updatedAt: new Date("2026-07-31T10:00:00Z"),
				alertCount: 1,
				alerts: [
					{
						id: "alert-1",
						dedupKey: "key-1",
						title: "Alert One",
						severity: "critical",
						status: "correlated",
						labels: JSON.stringify({ service: "checkout" }),
						description: "High latency on checkout service",
						triggeredAt: new Date("2026-07-31T10:00:00Z"),
						lastOccurrence: new Date("2026-07-31T10:00:00Z"),
						createdAt: new Date("2026-07-31T10:00:00Z"),
						updatedAt: new Date("2026-07-31T10:00:00Z"),
						// Internal-only columns that must never reach the API response.
						tenantId: "tenant-secret-123",
						internalNotes: "do-not-leak",
					},
				],
			}),
			update: vi.fn().mockResolvedValue({}),
		};

		const controller = new IncidentsController(
			incidentsService as unknown as IncidentsService,
			{} as unknown as InvestigationsService,
			{} as unknown as DispatchService,
			{} as unknown as IntegrationsService,
			{} as unknown as HarnessService,
			{} as never,
		);

		const handlers = getHandlers(controller);
		const result = await handlers.get({
			input: { id: "123e4567-e89b-12d3-a456-426614174000" },
		});

		expect(result.alerts).toHaveLength(1);
		expect(
			(result.alerts as Record<string, unknown>[])?.[0],
		).not.toHaveProperty("tenantId");
		expect(
			(result.alerts as Record<string, unknown>[])?.[0],
		).not.toHaveProperty("internalNotes");
	});
});

describe("IncidentsController - investigate runnability gate (#520)", () => {
	function getHandlers(controller: IncidentsController) {
		const procedures = controller.incidents() as unknown as Record<
			string,
			{ "~orpc"?: { handler: (args: { input: unknown }) => Promise<unknown> } }
		>;
		return Object.fromEntries(
			Object.entries(procedures).map(([key, proc]) => [
				key,
				proc?.["~orpc"]?.handler ?? proc,
			]),
		) as Record<
			string,
			(args: { input: { id: string } }) => Promise<Record<string, unknown>>
		>;
	}

	const mockIncident = {
		id: "123e4567-e89b-12d3-a456-426614174000",
		number: 42,
		title: "Database Outage",
		severity: "critical",
		status: "triggered",
		priority: "p1",
		serviceId: "srv-123",
		triggeredAt: new Date("2026-08-30T10:00:00Z"),
		createdAt: new Date("2026-08-30T10:00:00Z"),
		updatedAt: new Date("2026-08-30T10:00:00Z"),
		alertCount: 1,
	};

	it("happy path: usable harness enqueues the job and leaves the incident status alone (#673 w19)", async () => {
		const incidentsService = {
			findById: vi.fn().mockResolvedValue(mockIncident),
			update: vi.fn().mockResolvedValue({ ...mockIncident, status: "investigating" }),
		};
		const investigationsService = {
			startOrGet: vi.fn().mockResolvedValue({ investigation: { id: "inv-456" }, created: true }),
		};
		const dispatchService = {
			addInvestigationJob: vi.fn().mockResolvedValue("job-789"),
		};
		const integrationsService = {
			getIntegrationsForService: vi.fn().mockResolvedValue([]),
		};
		const harnessService = {
			ensureReady: vi.fn().mockResolvedValue({ ready: true }),
			resolveSelection: vi.fn().mockResolvedValue({
				runnable: true,
				harness: "deepagents",
				auto: true,
			} satisfies HarnessSelection),
		};

		const controller = new IncidentsController(
			incidentsService as unknown as IncidentsService,
			investigationsService as unknown as InvestigationsService,
			dispatchService as unknown as DispatchService,
			integrationsService as unknown as IntegrationsService,
			harnessService as unknown as HarnessService,
			{} as never,
		);

		const handlers = getHandlers(controller);
		const result = await handlers.investigate({
			input: { id: "123e4567-e89b-12d3-a456-426614174000" },
		});

		expect(result).toEqual({
			incidentId: "123e4567-e89b-12d3-a456-426614174000",
			investigationId: "inv-456",
			jobId: "job-789",
			queued: true,
		});

		// A run never moves the incident's status (#673 w19)
		expect(incidentsService.update).not.toHaveBeenCalled();

		// Investigation created and job enqueued
		expect(investigationsService.startOrGet).toHaveBeenCalledTimes(1);
		expect(dispatchService.addInvestigationJob).toHaveBeenCalledTimes(1);
	});

	it("investigates a resolved incident again without reopening it, and passes the brief (#743)", async () => {
		const resolved = { ...mockIncident, status: "resolved" };
		const incidentsService = { findById: vi.fn().mockResolvedValue(resolved), update: vi.fn() };
		const investigationsService = {
			startOrGet: vi.fn().mockResolvedValue({ investigation: { id: "inv-2" }, created: true }),
		};
		const dispatchService = { addInvestigationJob: vi.fn().mockResolvedValue("job-2") };
		const controller = new IncidentsController(
			incidentsService as unknown as IncidentsService,
			investigationsService as unknown as InvestigationsService,
			dispatchService as unknown as DispatchService,
			{ getIntegrationsForService: vi.fn().mockResolvedValue([]) } as unknown as IntegrationsService,
			{
				ensureReady: vi.fn().mockResolvedValue({ ready: true }),
				resolveSelection: vi.fn().mockResolvedValue({ runnable: true, harness: "opencode", auto: true }),
			} as unknown as HarnessService,
			{} as never,
		);

		await (getHandlers(controller).investigate as (a: { input: { id: string; brief: string } }) => Promise<unknown>)({
			input: { id: mockIncident.id, brief: "The fix did not hold." },
		});

		expect(incidentsService.update).not.toHaveBeenCalled();
		// A manual run records its trigger and its title, the brief's first line (#673).
		expect(investigationsService.startOrGet).toHaveBeenCalledWith({
			incidentId: mockIncident.id,
			agentMode: null,
			afterResolve: true,
			triggerType: "manual",
			title: "The fix did not hold.",
		});
		expect(dispatchService.addInvestigationJob).toHaveBeenCalledWith(
			expect.objectContaining({ brief: "The fix did not hold." }),
		);
	});

	describe("chat (#673: runs as threads)", () => {
		const ready = () =>
			({
				ensureReady: vi.fn().mockResolvedValue({ ready: true }),
				resolveSelection: vi.fn().mockResolvedValue({ runnable: true, harness: "opencode", auto: true }),
			}) as unknown as HarnessService;
		type Chat = (a: { input: { id: string; text: string; agentMode?: string } }) => Promise<unknown>;

		it("starts a chat run whose job carries the message and no brief", async () => {
			const investigationsService = {
				startOrGet: vi.fn().mockResolvedValue({ investigation: { id: "inv-chat" }, created: true }),
			};
			const dispatchService = { addInvestigationJob: vi.fn().mockResolvedValue("job-c") };
			const controller = new IncidentsController(
				{ findById: vi.fn().mockResolvedValue(mockIncident) } as unknown as IncidentsService,
				investigationsService as unknown as InvestigationsService,
				dispatchService as unknown as DispatchService,
				{ getIntegrationsForService: vi.fn().mockResolvedValue([]) } as unknown as IntegrationsService,
				ready(),
				{} as never,
			);
			const text = `Is the pool still saturated? ${"x".repeat(200)}`;
			const result = await (getHandlers(controller).chat as Chat)({
				input: { id: mockIncident.id, text, agentMode: "plan" },
			});
			expect(result).toMatchObject({ investigationId: "inv-chat", jobId: "job-c", queued: true });
			expect(investigationsService.startOrGet).toHaveBeenCalledWith(
				expect.objectContaining({
					kind: "chat",
					triggerType: "manual",
					title: text.slice(0, 120),
					agentMode: "plan",
				}),
			);
			const job = dispatchService.addInvestigationJob.mock.calls[0][0];
			expect(job).toMatchObject({ kind: "chat", chat: { text } });
			expect(job).not.toHaveProperty("brief");
		});

		it("answers CONFLICT naming the live run, and never hands it the message", async () => {
			const investigationsService = {
				startOrGet: vi.fn().mockResolvedValue({ investigation: { id: "inv-2" }, created: false }),
				findByIncidentId: vi.fn().mockResolvedValue([{ id: "inv-2" }, { id: "inv-1" }]),
			};
			const dispatchService = { addInvestigationJob: vi.fn() };
			const controller = new IncidentsController(
				{ findById: vi.fn().mockResolvedValue(mockIncident) } as unknown as IncidentsService,
				investigationsService as unknown as InvestigationsService,
				dispatchService as unknown as DispatchService,
				{ getIntegrationsForService: vi.fn() } as unknown as IntegrationsService,
				ready(),
				{} as never,
			);
			await expect(
				(getHandlers(controller).chat as Chat)({ input: { id: mockIncident.id, text: "hi" } }),
			).rejects.toMatchObject({
				code: "CONFLICT",
				message: "Run #2 is working; message it or stop it",
				data: { liveInvestigationId: "inv-2" },
			});
			expect(dispatchService.addInvestigationJob).not.toHaveBeenCalled();
		});

		it("refuses before any run when the agent is not ready", async () => {
			const investigationsService = { startOrGet: vi.fn() };
			const controller = new IncidentsController(
				{ findById: vi.fn().mockResolvedValue(mockIncident) } as unknown as IncidentsService,
				investigationsService as unknown as InvestigationsService,
				{} as DispatchService,
				{} as IntegrationsService,
				{
					resolveSelection: vi.fn().mockResolvedValue({ runnable: true, harness: "codex", auto: true }),
					ensureReady: vi.fn().mockResolvedValue({ ready: false, reason: "Codex: sign in needed" }),
				} as unknown as HarnessService,
				{} as never,
			);
			await expect(
				(getHandlers(controller).chat as Chat)({ input: { id: mockIncident.id, text: "hi" } }),
			).rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: "Codex: sign in needed" });
			expect(investigationsService.startOrGet).not.toHaveBeenCalled();
		});
	});

	it("starts any agent mode with no ceiling, and carries the chosen one on the job and the row (#673 w21)", async () => {
		const make = () => {
			const dispatchService = { addInvestigationJob: vi.fn().mockResolvedValue("job-3") };
			const investigationsService = {
				startOrGet: vi.fn().mockResolvedValue({ investigation: { id: "inv-3" }, created: true }),
			};
			const controller = new IncidentsController(
				{ findById: vi.fn().mockResolvedValue(mockIncident), update: vi.fn() } as unknown as IncidentsService,
				investigationsService as unknown as InvestigationsService,
				dispatchService as unknown as DispatchService,
				{ getIntegrationsForService: vi.fn().mockResolvedValue([]) } as unknown as IntegrationsService,
				{
					ensureReady: vi.fn().mockResolvedValue({ ready: true }),
					resolveSelection: vi.fn().mockResolvedValue({ runnable: true, harness: "opencode", auto: true }),
				} as unknown as HarnessService,
				{} as never,
			);
			const investigate = getHandlers(controller).investigate as (a: {
				input: { id: string; agentMode?: string };
			}) => Promise<unknown>;
			return { dispatchService, investigationsService, investigate };
		};
		const full = make();
		await full.investigate({ input: { id: mockIncident.id, agentMode: "bypassPermissions" } });
		expect(full.dispatchService.addInvestigationJob).toHaveBeenCalledWith(
			expect.objectContaining({ agentMode: "bypassPermissions" }),
		);
		expect(full.investigationsService.startOrGet).toHaveBeenCalledWith(
			expect.objectContaining({ agentMode: "bypassPermissions" }),
		);
		const none = make();
		await none.investigate({ input: { id: mockIncident.id } });
		expect(none.dispatchService.addInvestigationJob).toHaveBeenCalledWith(
			expect.not.objectContaining({ agentMode: expect.anything() }),
		);
	});

	it("returns the investigation already in progress instead of starting a second one", async () => {
		const incidentsService = {
			findById: vi.fn().mockResolvedValue(mockIncident),
			update: vi.fn(),
		};
		const investigationsService = {
			startOrGet: vi.fn().mockResolvedValue({ investigation: { id: "inv-running" }, created: false }),
		};
		const dispatchService = { addInvestigationJob: vi.fn() };
		const harnessService = {
			ensureReady: vi.fn().mockResolvedValue({ ready: true }),
			resolveSelection: vi.fn().mockResolvedValue({ runnable: true, harness: "opencode", auto: true }),
		};
		const controller = new IncidentsController(
			incidentsService as unknown as IncidentsService,
			investigationsService as unknown as InvestigationsService,
			dispatchService as unknown as DispatchService,
			{ getIntegrationsForService: vi.fn() } as unknown as IntegrationsService,
			harnessService as unknown as HarnessService,
			{} as never,
		);

		const result = await getHandlers(controller).investigate({
			input: { id: mockIncident.id },
		});

		expect(result).toEqual({
			incidentId: mockIncident.id,
			investigationId: "inv-running",
			jobId: null,
			queued: false,
		});
		expect(dispatchService.addInvestigationJob).not.toHaveBeenCalled();
		expect(incidentsService.update).not.toHaveBeenCalled();
	});

	it("refuses with PRECONDITION_FAILED naming the agent when it is not signed in, and starts nothing (#673 w9)", async () => {
		const investigationsService = { startOrGet: vi.fn() };
		const dispatchService = { addInvestigationJob: vi.fn() };
		const harnessService = {
			resolveSelection: vi.fn().mockResolvedValue({ runnable: true, harness: "codex", auto: true }),
			ensureReady: vi.fn().mockResolvedValue({
				ready: false,
				reason: "Codex: sign in needed (API Key, ChatGPT)",
			}),
		};
		const controller = new IncidentsController(
			{ findById: vi.fn().mockResolvedValue(mockIncident) } as unknown as IncidentsService,
			investigationsService as unknown as InvestigationsService,
			dispatchService as unknown as DispatchService,
			{} as unknown as IntegrationsService,
			harnessService as unknown as HarnessService,
			{} as never,
		);

		const thrown = await getHandlers(controller)
			.investigate({ input: { id: "123e4567-e89b-12d3-a456-426614174000" } })
			.catch((err: unknown) => err);

		expect(thrown).toBeInstanceOf(ORPCError);
		const orpcErr = thrown as ORPCError<"PRECONDITION_FAILED", { reason: string; harness: string }>;
		expect(orpcErr.code).toBe("PRECONDITION_FAILED");
		expect(orpcErr.message).toBe("Codex: sign in needed (API Key, ChatGPT)");
		expect(orpcErr.data).toMatchObject({ harness: "codex" });
		expect(harnessService.ensureReady).toHaveBeenCalledWith("codex");
		expect(investigationsService.startOrGet).not.toHaveBeenCalled();
		expect(dispatchService.addInvestigationJob).not.toHaveBeenCalled();
	});

	describe("a run's own agent, model and effort (#673 w52)", () => {
		const make = (ready: { ready: boolean; reason?: string }) => {
			const dispatchService = { addInvestigationJob: vi.fn().mockResolvedValue("job-4") };
			const investigationsService = {
				startOrGet: vi.fn().mockResolvedValue({ investigation: { id: "inv-4" }, created: true }),
			};
			const harnessService = {
				resolveSelection: vi.fn(async (asked: { harness?: string }) => ({
					runnable: true,
					harness: asked.harness ?? "opencode",
					auto: false,
				})),
				ensureReady: vi.fn().mockResolvedValue(ready),
			};
			const controller = new IncidentsController(
				{ findById: vi.fn().mockResolvedValue(mockIncident) } as unknown as IncidentsService,
				investigationsService as unknown as InvestigationsService,
				dispatchService as unknown as DispatchService,
				{ getIntegrationsForService: vi.fn().mockResolvedValue([]) } as unknown as IntegrationsService,
				harnessService as unknown as HarnessService,
				{} as never,
			);
			const handlers = getHandlers(controller) as unknown as Record<
				"investigate" | "chat",
				(a: { input: Record<string, unknown> }) => Promise<unknown>
			>;
			return { dispatchService, investigationsService, harnessService, handlers };
		};

		it("gates on the agent the request names, with that agent's reason", async () => {
			const t = make({ ready: false, reason: "Codex: sign in needed" });
			await expect(
				t.handlers.investigate({ input: { id: mockIncident.id, harness: "codex", model: null } }),
			).rejects.toMatchObject({
				code: "PRECONDITION_FAILED",
				message: "Codex: sign in needed",
				data: { harness: "codex", failure: "not-ready" },
			});
			expect(t.harnessService.resolveSelection).toHaveBeenCalledWith({ harness: "codex", model: null });
			expect(t.harnessService.ensureReady).toHaveBeenCalledWith("codex");
			expect(t.investigationsService.startOrGet).not.toHaveBeenCalled();
		});

		it("gates on Settings' agent when the request names none", async () => {
			const t = make({ ready: true });
			await t.handlers.chat({ input: { id: mockIncident.id, text: "hi" } });
			expect(t.harnessService.resolveSelection).toHaveBeenCalledWith({});
			expect(t.harnessService.ensureReady).toHaveBeenCalledWith("opencode");
			expect(t.dispatchService.addInvestigationJob).toHaveBeenCalledWith(
				expect.not.objectContaining({ harness: expect.anything() }),
			);
		});

		it("carries the request's choice on the job, investigate and chat alike", async () => {
			const t = make({ ready: true });
			const choice = { harness: "claude-code", model: "opus[1m]", effort: null };
			await t.handlers.investigate({ input: { id: mockIncident.id, ...choice } });
			await t.handlers.chat({ input: { id: mockIncident.id, text: "hi", ...choice } });
			for (const call of t.dispatchService.addInvestigationJob.mock.calls)
				expect(call[0]).toMatchObject(choice);
			expect(t.harnessService.ensureReady).toHaveBeenCalledWith("claude-code");
		});
	});

	it("refuses with PRECONDITION_FAILED when no harness is on PATH: status UNCHANGED and no job enqueued", async () => {
		const incidentsService = {
			findById: vi.fn().mockResolvedValue(mockIncident),
			update: vi.fn().mockResolvedValue({}),
		};
		const investigationsService = {
			startOrGet: vi.fn().mockResolvedValue({ investigation: { id: "inv-456" }, created: true }),
		};
		const dispatchService = {
			addInvestigationJob: vi.fn().mockResolvedValue("job-789"),
		};
		const integrationsService = {
			getIntegrationsForService: vi.fn().mockResolvedValue([]),
		};
		const harnessService = {
			ensureReady: vi.fn().mockResolvedValue({ ready: true }),
			resolveSelection: vi.fn().mockResolvedValue({
				runnable: false,
				failure: "no-harness",
				reason:
					"No coding agent found on PATH. Install one: OpenCode: curl -fsSL https://opencode.ai/install | bash.",
			} satisfies HarnessSelection),
		};

		const controller = new IncidentsController(
			incidentsService as unknown as IncidentsService,
			investigationsService as unknown as InvestigationsService,
			dispatchService as unknown as DispatchService,
			integrationsService as unknown as IntegrationsService,
			harnessService as unknown as HarnessService,
			{} as never,
		);

		const handlers = getHandlers(controller);

		let thrown: unknown;
		try {
			await handlers.investigate({
				input: { id: "123e4567-e89b-12d3-a456-426614174000" },
			});
		} catch (err) {
			thrown = err;
		}

		// 1. Returns typed refusal
		expect(thrown).toBeInstanceOf(ORPCError);
		const orpcErr = thrown as ORPCError<"PRECONDITION_FAILED", { failure: string; reason: string; harness?: string }>;
		expect(orpcErr.code).toBe("PRECONDITION_FAILED");
		expect(orpcErr.status).toBe(412);
		expect(orpcErr.data).toEqual({
			failure: "no-harness",
			reason:
				"No coding agent found on PATH. Install one: OpenCode: curl -fsSL https://opencode.ai/install | bash.",
			harness: undefined,
		});

		// 2. Incident status is UNCHANGED
		expect(incidentsService.update).not.toHaveBeenCalled();

		// 3. No job was enqueued and no investigation was created
		expect(dispatchService.addInvestigationJob).not.toHaveBeenCalled();
		expect(investigationsService.startOrGet).not.toHaveBeenCalled();
	});

	it("refuses with PRECONDITION_FAILED on a pinned-but-missing harness: status UNCHANGED and no job enqueued", async () => {
		const incidentsService = {
			findById: vi.fn().mockResolvedValue(mockIncident),
			update: vi.fn().mockResolvedValue({}),
		};
		const investigationsService = {
			startOrGet: vi.fn().mockResolvedValue({ investigation: { id: "inv-456" }, created: true }),
		};
		const dispatchService = {
			addInvestigationJob: vi.fn().mockResolvedValue("job-789"),
		};
		const integrationsService = {
			getIntegrationsForService: vi.fn().mockResolvedValue([]),
		};
		const harnessService = {
			ensureReady: vi.fn().mockResolvedValue({ ready: true }),
			resolveSelection: vi.fn().mockResolvedValue({
				runnable: false,
				failure: "pinned-harness-missing",
				harness: "deepagents",
				reason:
					'PRISMALENS_HARNESS="deepagents" but dcode is not on PATH. Install: uv tool install -U deepagents-code --with deepagents-acp',
			} satisfies HarnessSelection),
		};

		const controller = new IncidentsController(
			incidentsService as unknown as IncidentsService,
			investigationsService as unknown as InvestigationsService,
			dispatchService as unknown as DispatchService,
			integrationsService as unknown as IntegrationsService,
			harnessService as unknown as HarnessService,
			{} as never,
		);

		const handlers = getHandlers(controller);

		let thrown: unknown;
		try {
			await handlers.investigate({
				input: { id: "123e4567-e89b-12d3-a456-426614174000" },
			});
		} catch (err) {
			thrown = err;
		}

		expect(thrown).toBeInstanceOf(ORPCError);
		const orpcErr = thrown as ORPCError<"PRECONDITION_FAILED", { failure: string; reason: string; harness?: string }>;
		expect(orpcErr.code).toBe("PRECONDITION_FAILED");
		expect(orpcErr.status).toBe(412);
		expect(orpcErr.data.failure).toBe("pinned-harness-missing");
		expect(orpcErr.data.harness).toBe("deepagents");

		expect(incidentsService.update).not.toHaveBeenCalled();
		expect(dispatchService.addInvestigationJob).not.toHaveBeenCalled();
		expect(investigationsService.startOrGet).not.toHaveBeenCalled();
	});

	it("refuses with PRECONDITION_FAILED on an invalid PRISMALENS_HARNESS pin: status UNCHANGED and no job enqueued", async () => {
		const incidentsService = {
			findById: vi.fn().mockResolvedValue(mockIncident),
			update: vi.fn().mockResolvedValue({}),
		};
		const investigationsService = {
			startOrGet: vi.fn().mockResolvedValue({ investigation: { id: "inv-456" }, created: true }),
		};
		const dispatchService = {
			addInvestigationJob: vi.fn().mockResolvedValue("job-789"),
		};
		const integrationsService = {
			getIntegrationsForService: vi.fn().mockResolvedValue([]),
		};
		const harnessService = {
			ensureReady: vi.fn().mockResolvedValue({ ready: true }),
			resolveSelection: vi.fn().mockResolvedValue({
				runnable: false,
				failure: "invalid-env-harness",
				reason:
					'PRISMALENS_HARNESS="bogus" is not a known harness (opencode, claude-code, codex, gemini, deepagents)',
			} satisfies HarnessSelection),
		};

		const controller = new IncidentsController(
			incidentsService as unknown as IncidentsService,
			investigationsService as unknown as InvestigationsService,
			dispatchService as unknown as DispatchService,
			integrationsService as unknown as IntegrationsService,
			harnessService as unknown as HarnessService,
			{} as never,
		);

		const handlers = getHandlers(controller);

		let thrown: unknown;
		try {
			await handlers.investigate({
				input: { id: "123e4567-e89b-12d3-a456-426614174000" },
			});
		} catch (err) {
			thrown = err;
		}

		expect(thrown).toBeInstanceOf(ORPCError);
		const orpcErr = thrown as ORPCError<"PRECONDITION_FAILED", { failure: string; reason: string; harness?: string }>;
		expect(orpcErr.code).toBe("PRECONDITION_FAILED");
		expect(orpcErr.status).toBe(412);
		expect(orpcErr.data.failure).toBe("invalid-env-harness");
		expect(orpcErr.data.harness).toBeUndefined();

		expect(incidentsService.update).not.toHaveBeenCalled();
		expect(dispatchService.addInvestigationJob).not.toHaveBeenCalled();
		expect(investigationsService.startOrGet).not.toHaveBeenCalled();
	});

	it("throws NOT_FOUND when incident does not exist", async () => {
		const incidentsService = {
			findById: vi.fn().mockResolvedValue(null),
			update: vi.fn().mockResolvedValue({}),
		};
		const controller = new IncidentsController(
			incidentsService as unknown as IncidentsService,
			{} as unknown as InvestigationsService,
			{} as unknown as DispatchService,
			{} as unknown as IntegrationsService,
			{} as unknown as HarnessService,
			{} as never,
		);

		const handlers = getHandlers(controller);

		let thrown: unknown;
		try {
			await handlers.investigate({
				input: { id: "non-existent-id" },
			});
		} catch (err) {
			thrown = err;
		}

		expect(thrown).toBeInstanceOf(ORPCError);
		const orpcErr = thrown as ORPCError<"NOT_FOUND", unknown>;
		expect(orpcErr.code).toBe("NOT_FOUND");
		expect(orpcErr.status).toBe(404);
	});

	// Task #532: serializeIncidentWithRelations previously spread `incident.service`,
	// leaking `tenantId`, `discoveryMetadata`, and any raw Prisma columns.
	it("never leaks tenantId, discoveryMetadata, or extra database columns on incident.service via get handler", async () => {
		const incidentsService = {
			findDetail(id: string) { return this.findById(id); },
			findById: vi.fn().mockResolvedValue({
				id: "123e4567-e89b-12d3-a456-426614174000",
				number: 1,
				title: "Storm Incident",
				severity: "critical",
				status: "triggered",
				priority: "p1",
				triggeredAt: new Date("2026-07-31T10:00:00Z"),
				createdAt: new Date("2026-07-31T10:00:00Z"),
				updatedAt: new Date("2026-07-31T10:00:00Z"),
				alertCount: 0,
				service: {
					id: "22222222-2222-4222-8222-222222222222",
					name: "checkout-service",
					displayName: "Checkout Service",
					description: "Processes checkout transactions",
					type: "service",
					tier: "tier_1",
					team: "payments",
					slackChannel: "#payments-alerts",
					tags: JSON.stringify(["tier1", "pci"]),
					metadata: JSON.stringify({ repo: "org/checkout" }),
					createdAt: new Date("2026-07-31T10:00:00Z"),
					updatedAt: new Date("2026-07-31T10:00:00Z"),
					// Internal / unwhitelisted columns
					tenantId: "tenant-secret-service-456",
					discoveryMetadata: JSON.stringify({ autoDiscovered: true }),
					internalSecret: "do-not-leak-service-secret",
				},
			}),
			update: vi.fn().mockResolvedValue({}),
		};

		const controller = new IncidentsController(
			incidentsService as any,
			{} as any,
			{} as any,
			{} as any,
			{} as unknown as HarnessService,
			{} as never,
		);

		const handlers = getHandlers(controller);
		const result = await handlers.get({
			input: { id: "123e4567-e89b-12d3-a456-426614174000" },
		});

		expect(result.service).toBeDefined();
		expect(result.service).not.toHaveProperty("tenantId");
		expect(result.service).not.toHaveProperty("discoveryMetadata");
		expect(result.service).not.toHaveProperty("internalSecret");
		expect(Object.keys(result.service!).sort()).toEqual(
			[
				"createdAt",
				"description",
				"displayName",
				"id",
				"metadata",
				"name",
				"slackChannel",
				"tags",
				"team",
				"tier",
				"type",
				"updatedAt",
			].sort(),
		);
	});
});

describe("IncidentsController - one-step Resolve (R1a)", () => {
	const id = "123e4567-e89b-12d3-a456-426614174000";
	const base = {
		id,
		number: 1,
		title: "Pool exhausted",
		severity: "high",
		priority: "p2",
		triggeredAt: new Date("2026-10-02T17:00:00Z"),
		createdAt: new Date("2026-10-02T17:00:00Z"),
		updatedAt: new Date("2026-10-02T17:00:00Z"),
		alertCount: 1,
	};
	function handlersFor(status: string) {
		const incidentsService = {
			findById: vi.fn().mockResolvedValue({ ...base, status }),
			update: vi.fn().mockResolvedValue({ ...base, status }),
			close: vi.fn().mockResolvedValue({ ...base, status: "closed" }),
		};
		const controller = new IncidentsController(
			incidentsService as unknown as IncidentsService,
			{} as InvestigationsService,
			{} as DispatchService,
			{} as IntegrationsService,
			{} as HarnessService,
			{} as never,
		);
		const procedures = controller.incidents() as unknown as Record<
			string,
			{ "~orpc": { handler: (a: { input: unknown }) => Promise<unknown> } }
		>;
		return {
			incidentsService,
			call: (name: string, input: Record<string, unknown>) =>
				procedures[name]["~orpc"].handler({ input: { id, ...input } }),
		};
	}

	it("resolves from Triggered, Acknowledged and Alerts cleared, never twice", async () => {
		for (const status of ["triggered", "investigating", "resolved"]) {
			const { call, incidentsService } = handlersFor(status);
			await call("close", {});
			expect(incidentsService.close).toHaveBeenCalledTimes(1);
		}
		const { call } = handlersFor("closed");
		await expect(call("close", {})).rejects.toMatchObject({ code: "CONFLICT" });
	});

	it("takes an edited cause on a Resolved incident and refuses anything else but Reopen", async () => {
		const ok = handlersFor("closed");
		await ok.call("update", { actualCause: "the pool" });
		expect(ok.incidentsService.update).toHaveBeenCalledWith(id, {
			actualCause: "the pool",
		});
		const refused = handlersFor("closed");
		await expect(
			refused.call("update", { customerImpact: "checkout down" }),
		).rejects.toMatchObject({ code: "CONFLICT" });
		await expect(
			refused.call("update", { status: "resolved" }),
		).rejects.toMatchObject({ code: "CONFLICT" });
		const reopen = handlersFor("closed");
		await reopen.call("update", { status: "investigating" });
		expect(reopen.incidentsService.update).toHaveBeenCalledWith(id, {
			status: "investigating",
		});
	});
});

describe("IncidentsController - runs as threads (#673)", () => {
	it("the incident carries each run's kind, title, mode and whether it left a report", () => {
		const controller = new IncidentsController(
			{} as IncidentsService,
			{} as InvestigationsService,
			{} as DispatchService,
			{} as IntegrationsService,
			{} as HarnessService,
			{} as never,
		);
		const at = new Date("2026-10-07T10:00:00Z");
		const out = (
			controller as unknown as {
				serializeIncidentWithRelations: (i: unknown) => {
					investigations?: Array<Record<string, unknown>>;
				};
			}
		).serializeIncidentWithRelations({
			id: "123e4567-e89b-12d3-a456-426614174000",
			status: "triggered",
			triggeredAt: at,
			createdAt: at,
			updatedAt: at,
			investigations: [
				{ id: "chat", status: "completed", kind: "chat", title: "Is it full?", agentMode: "plan", hasReport: false, startedAt: at, createdAt: at, completedAt: at },
				{ id: "old", status: "completed", createdAt: at, completedAt: at },
			],
		});
		expect(out.investigations?.[0]).toMatchObject({
			kind: "chat",
			title: "Is it full?",
			agentMode: "plan",
			hasReport: false,
			startedAt: at.toISOString(),
		});
		expect(out.investigations?.[1]).toMatchObject({ kind: "investigation", title: null });
	});
});
