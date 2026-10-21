// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/** POST /investigations/:id/messages (#743). Mocked service + dispatch. */

import { MutationThrottleGuard } from "../../core/throttle/mutation-throttle.guard.js";
import type { ExecutionContext } from "@nestjs/common";
import { GUARDS_METADATA } from "@nestjs/common/constants.js";
import { Reflector } from "@nestjs/core";
import { Test, type TestingModule } from "@nestjs/testing";
import { ThrottlerException, ThrottlerStorageService } from "@nestjs/throttler";
import { ORPCError } from "@orpc/nest";
import { DispatchService, FollowUpRefused } from "../../infrastructure/dispatch/dispatch.service.js";
import { InvestigationsController } from "./investigations.controller.js";
import { InvestigationsService } from "./investigations.service.js";
import { AttachmentsService } from "./attachments.service.js";
import { HarnessService } from "../../core/harness/harness.service.js";
import { TelemetryService } from "../../core/telemetry/telemetry.service.js";
import { telemetryStub } from "../../../test/factories/index.js";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const mockInvestigationsService = {
	findById: vi.fn(),
	// The real rule, with the run numbered 3 (#673 w59).
	liveKindRefusal: vi.fn((inv: never, kind: "chat" | "continue") =>
		InvestigationsService.prototype.liveKindRefusal.call(
			{ runNumber: async () => 3 } as never,
			inv,
			kind,
		),
	),
};

const mockDispatchService = {
	sendMessage: vi.fn(),
	resumeInvestigation: vi.fn(),
	planFollowUp: vi.fn(),
	followUpLevel: vi.fn(),
	afterRestart: vi.fn(),
};

function investigation(id: string, status: string) {
	const now = new Date("2026-07-05T00:00:00.000Z");
	return {
		id,
		incidentId: "inc-1",
		status,
		startedAt: null,
		completedAt: null,
		summary: null,
		rootCause: null,
		rootCauseCategory: null,
		report: null,
		overlay: null,
		error: null,
		createdAt: now,
		updatedAt: now,
	};
}

describe("InvestigationsController.message (#743)", () => {
	let controller: InvestigationsController;

	beforeEach(async () => {
		vi.clearAllMocks();
		const module: TestingModule = await Test.createTestingModule({
			controllers: [InvestigationsController],
			providers: [
				{ provide: InvestigationsService, useValue: mockInvestigationsService },
				{ provide: DispatchService, useValue: mockDispatchService },
				{ provide: TelemetryService, useValue: telemetryStub() },
				{ provide: AttachmentsService, useValue: { forJob: vi.fn(async () => []) } },
				{ provide: HarnessService, useValue: {} },
			],
		})
			.overrideGuard(MutationThrottleGuard)
			.useValue({ canActivate: () => true })
			.compile();
		controller = module.get(InvestigationsController);
	});

	type Input = { id: string; text: string; mode: "queue" | "now"; kind?: "chat" | "continue"; harness?: string; model?: string };
	// biome-ignore lint/suspicious/noExplicitAny: unwrap the oRPC procedure wrapper.
	function messageHandler(): (args: { input: Input }) => Promise<any> {
		// biome-ignore lint/suspicious/noExplicitAny: procedure map is loosely typed.
		const procs = controller.investigations() as Record<string, any>;
		return procs.message["~orpc"].handler;
	}

	it("queues a message on a running run", async () => {
		mockInvestigationsService.findById.mockResolvedValue(investigation("inv-1", "running"));
		mockDispatchService.sendMessage.mockReturnValue("queued");

		const result = await messageHandler()({ input: { id: "inv-1", text: "check the TTL", mode: "queue" } });

		expect(mockDispatchService.sendMessage).toHaveBeenCalledWith("inv-1", "check the TTL", "queue", [], undefined, expect.any(String));
		// The id its message_queued and operator_message events carry (#820).
		expect(result).toEqual({ state: "queued", messageId: expect.any(String) });
	});

	it("refuses a finished run without touching the bus", async () => {
		mockInvestigationsService.findById.mockResolvedValue(investigation("inv-1", "completed"));

		await expect(
			messageHandler()({ input: { id: "inv-1", text: "hi", mode: "now" } }),
		).rejects.toMatchObject({ code: "CONFLICT" });
		expect(mockDispatchService.sendMessage).not.toHaveBeenCalled();
	});

	it("retries while nothing holds the run yet, then refuses", async () => {
		mockInvestigationsService.findById.mockResolvedValue(investigation("inv-1", "pending"));
		mockDispatchService.sendMessage.mockReturnValue(null);

		await expect(
			messageHandler()({ input: { id: "inv-1", text: "hi", mode: "queue" } }),
		).rejects.toBeInstanceOf(ORPCError);
		expect(mockDispatchService.sendMessage).toHaveBeenCalledTimes(3);
	});

	it("answers sent once a retry finds the run holder", async () => {
		mockInvestigationsService.findById.mockResolvedValue(investigation("inv-1", "running"));
		mockDispatchService.sendMessage.mockReturnValueOnce(null).mockReturnValueOnce("sent");

		const result = await messageHandler()({ input: { id: "inv-1", text: "stop and look", mode: "now" } });

		expect(result).toEqual({ state: "sent" });
	});

	describe("a follow-up on a finished run (#747)", () => {
		let bin: string;
		beforeEach(() => {
			bin = mkdtempSync(join(tmpdir(), "pl-bin-"));
			for (const name of ["opencode", "dcode"]) {
				writeFileSync(join(bin, name), "#!/bin/sh\n");
				chmodSync(join(bin, name), 0o755);
			}
			vi.stubEnv("PATH", bin);
		});
		afterEach(() => {
			vi.unstubAllEnvs();
			rmSync(bin, { recursive: true, force: true });
		});
		const finished = (harness: string) => ({
			...investigation("inv-1", "completed"),
			harness,
			acpSessionId: "ses_abc",
			workspace: "{}",
		});

		it("answers resumed and queues the follow-up", async () => {
			mockInvestigationsService.findById.mockResolvedValue(finished("opencode"));
			mockDispatchService.resumeInvestigation.mockResolvedValue(true);

			const result = await messageHandler()({ input: { id: "inv-1", text: "why the pool?", mode: "queue" } });

			expect(result).toEqual({ state: "resumed" });
			expect(mockDispatchService.resumeInvestigation).toHaveBeenCalledWith("inv-1", "why the pool?", "queue", "chat", [], {});
			expect(mockDispatchService.sendMessage).not.toHaveBeenCalled();
		});

		it("continues a stopped run unless asked for a chat (R4.4)", async () => {
			mockInvestigationsService.findById.mockResolvedValue({ ...finished("opencode"), status: "cancelled" });
			mockDispatchService.resumeInvestigation.mockResolvedValue(true);

			await messageHandler()({ input: { id: "inv-1", text: "only the 14:02 deploy", mode: "queue" } });

			expect(mockDispatchService.resumeInvestigation).toHaveBeenCalledWith(
				"inv-1",
				"only the 14:02 deploy",
				"queue",
				"continue",
				[],
				{},
			);
		});

		it("answers CONFLICT when the run is not a stopped one and the message asks to continue (R4.4)", async () => {
			mockInvestigationsService.findById.mockResolvedValue(finished("opencode"));
			mockDispatchService.resumeInvestigation.mockRejectedValue(
				new FollowUpRefused("Only a stopped run can be continued."),
			);

			await expect(
				messageHandler()({ input: { id: "inv-1", text: "go on", mode: "queue", kind: "continue" } }),
			).rejects.toMatchObject({ code: "CONFLICT", message: "Only a stopped run can be continued." });
		});

		it("takes a follow-up on a harness that cannot reopen a session, and passes the chips' agent on", async () => {
			mockInvestigationsService.findById.mockResolvedValue(finished("deepagents"));
			mockDispatchService.resumeInvestigation.mockResolvedValue(true);

			await messageHandler()({ input: { id: "inv-1", text: "hi", mode: "queue", harness: "codex", model: "gpt-x" } });

			expect(mockDispatchService.resumeInvestigation).toHaveBeenLastCalledWith("inv-1", "hi", "queue", "chat", [], {
				harness: "codex",
				model: "gpt-x",
			});
		});

		it("refuses only a run that kept no workspace", async () => {
			mockInvestigationsService.findById.mockResolvedValue({ ...finished("opencode"), workspace: null });

			await expect(
				messageHandler()({ input: { id: "inv-1", text: "hi", mode: "queue" } }),
			).rejects.toMatchObject({
				code: "CONFLICT",
				message: "This run recorded no workspace, so there is nothing to continue from.",
			});
			expect(mockDispatchService.resumeInvestigation).not.toHaveBeenCalled();
		});

		it("continue on a cancelled chat, explicit or omitted, is refused; omitted means Ask on a chat (T16)", async () => {
			const chat = { ...finished("opencode"), kind: "chat", status: "cancelled" };
			mockInvestigationsService.findById.mockResolvedValue(chat);
			mockDispatchService.resumeInvestigation.mockResolvedValue(true);

			await messageHandler()({ input: { id: "inv-1", text: "and then?", mode: "queue" } });
			expect(mockDispatchService.resumeInvestigation).toHaveBeenLastCalledWith("inv-1", "and then?", "queue", "chat", [], {});

			mockDispatchService.resumeInvestigation.mockRejectedValue(
				new FollowUpRefused("A chat has no report to continue to. Ask, or start a new run to investigate."),
			);
			await expect(
				messageHandler()({ input: { id: "inv-1", text: "go on", mode: "queue", kind: "continue" } }),
			).rejects.toMatchObject({ code: "CONFLICT", message: expect.stringContaining("A chat has no report") });
		});

		it("omitted kind continues a failed reportless investigation, and Asks on a completed one (T16)", async () => {
			mockDispatchService.resumeInvestigation.mockResolvedValue(true);
			mockInvestigationsService.findById.mockResolvedValue({ ...finished("opencode"), status: "failed", error: "boom" });
			await messageHandler()({ input: { id: "inv-1", text: "try again", mode: "queue" } });
			expect(mockDispatchService.resumeInvestigation).toHaveBeenLastCalledWith("inv-1", "try again", "queue", "continue", [], {});

			mockInvestigationsService.findById.mockResolvedValue({ ...finished("opencode"), report: "{}" });
			await messageHandler()({ input: { id: "inv-1", text: "why?", mode: "queue" } });
			expect(mockDispatchService.resumeInvestigation).toHaveBeenLastCalledWith("inv-1", "why?", "queue", "chat", [], {});
		});

		it("refuses a second follow-up while the first holds the run", async () => {
			mockInvestigationsService.findById.mockResolvedValue(finished("opencode"));
			mockDispatchService.resumeInvestigation.mockResolvedValue(false);

			await expect(
				messageHandler()({ input: { id: "inv-1", text: "hi", mode: "queue" } }),
			).rejects.toMatchObject({ code: "CONFLICT", message: "A follow-up is already running." });
		});
	});
});

describe("messages on a live row (#673 w59, T15, OBJ-004)", () => {
	let controller: InvestigationsController;
	beforeEach(async () => {
		vi.clearAllMocks();
		const module: TestingModule = await Test.createTestingModule({
			controllers: [InvestigationsController],
			providers: [
				{ provide: InvestigationsService, useValue: mockInvestigationsService },
				{ provide: DispatchService, useValue: mockDispatchService },
				{ provide: TelemetryService, useValue: telemetryStub() },
				{ provide: AttachmentsService, useValue: { forJob: vi.fn(async () => []) } },
				{ provide: HarnessService, useValue: {} },
			],
		})
			.overrideGuard(MutationThrottleGuard)
			.useValue({ canActivate: () => true })
			.compile();
		controller = module.get(InvestigationsController);
	});
	// biome-ignore lint/suspicious/noExplicitAny: unwrap the oRPC procedure wrapper.
	const send = (input: { id: string; text: string; mode: "queue"; kind?: "chat" | "continue" }): Promise<any> =>
		// biome-ignore lint/suspicious/noExplicitAny: procedure map is loosely typed.
		(controller.investigations() as Record<string, any>).message["~orpc"].handler({ input });
	const live = (liveTurn: string | null, kind = "investigation") => ({
		...investigation("inv-1", "running"),
		kind,
		liveTurn,
	});

	it.each([
		["continue on an answer turn", live("answer"), "continue", "Run #3 is working on an answer; wait or stop it"],
		["chat on a report turn", live("report"), "chat", "Run #3 is working toward a report; wait or stop it"],
		["an explicit kind while the turn is not yet known", live(null, "chat"), "chat", "Run #3 is starting; wait"],
	] as const)("refuses %s with CONFLICT", async (_name, row, kind, message) => {
		mockInvestigationsService.findById.mockResolvedValue(row);

		await expect(send({ id: "inv-1", text: "hi", mode: "queue", kind })).rejects.toMatchObject({ code: "CONFLICT", message });
		expect(mockDispatchService.sendMessage).not.toHaveBeenCalled();
	});

	it("a retry that lands on a newer Ask turn is refused there, not delivered (#804 OBJ-032)", async () => {
		// The report turn's steer channel closed; during the retry delay it finished and an Ask was admitted.
		mockInvestigationsService.findById
			.mockResolvedValueOnce(live("report"))
			.mockResolvedValueOnce(live("answer"));
		mockDispatchService.sendMessage.mockReturnValueOnce(null).mockReturnValueOnce("conflict");

		await expect(send({ id: "inv-1", text: "finish the report", mode: "queue", kind: "continue" })).rejects.toMatchObject({
			code: "CONFLICT",
			message: "Run #3 is working on an answer; wait or stop it",
		});
		expect(mockDispatchService.sendMessage).toHaveBeenCalledTimes(2);
		for (const call of mockDispatchService.sendMessage.mock.calls) expect(call[4]).toBe("continue");
	});

	it("a matching kind, or no kind at all, steers the live turn", async () => {
		mockDispatchService.sendMessage.mockReturnValue("queued");
		mockInvestigationsService.findById.mockResolvedValue(live("answer"));
		await expect(send({ id: "inv-1", text: "also the TTL", mode: "queue", kind: "chat" })).resolves.toEqual({ state: "queued", messageId: expect.any(String) });

		mockInvestigationsService.findById.mockResolvedValue(live(null));
		await expect(send({ id: "inv-1", text: "also the TTL", mode: "queue" })).resolves.toEqual({ state: "queued", messageId: expect.any(String) });
		expect(mockDispatchService.sendMessage).toHaveBeenCalledTimes(2);
	});
});

describe("InvestigationsController.handoff (#849)", () => {
	let controller: InvestigationsController;

	beforeEach(async () => {
		vi.clearAllMocks();
		const module: TestingModule = await Test.createTestingModule({
			controllers: [InvestigationsController],
			providers: [
				{ provide: InvestigationsService, useValue: mockInvestigationsService },
				{ provide: DispatchService, useValue: mockDispatchService },
				{ provide: TelemetryService, useValue: telemetryStub() },
				{ provide: AttachmentsService, useValue: { forJob: vi.fn(async () => []) } },
				{ provide: HarnessService, useValue: {} },
			],
		})
			.overrideGuard(MutationThrottleGuard)
			.useValue({ canActivate: () => true })
			.compile();
		controller = module.get(InvestigationsController);
	});

	function handoffHandler(): (a: { input: { id: string; harness?: string } }) => Promise<unknown> {
		return (
			controller.investigations() as unknown as Record<
				string,
				{ "~orpc": { handler: (a: { input: { id: string; harness?: string } }) => Promise<unknown> } }
			>
		).handoff["~orpc"].handler;
	}

	it("handoff-L11: load route reports preflight, access level and note", async () => {
		const finished = {
			...investigation("inv-1", "completed"),
			harness: "opencode",
			workspace: "{}",
			endReason: null,
		};
		mockInvestigationsService.findById.mockResolvedValue(finished);
		mockDispatchService.planFollowUp.mockResolvedValue({
			route: "load",
			harness: "opencode",
			preflight: { problem: "OpenCode is not signed in.", fix: "Sign in: opencode auth login." },
		});
		mockDispatchService.followUpLevel.mockResolvedValue("workspace-write");
		mockDispatchService.afterRestart.mockResolvedValue(false);

		const result = await handoffHandler()({ input: { id: "inv-1", harness: "opencode" } });

		expect(result).toEqual({
			route: "load",
			harness: "opencode",
			carried: "the agent's own session",
			omitted: null,
			accessLevel: "workspace-write",
			preflight: { problem: "OpenCode is not signed in.", fix: "Sign in: opencode auth login." },
			note: null,
		});
	});

	it("handoff-L11: refuses a running run with CONFLICT", async () => {
		mockInvestigationsService.findById.mockResolvedValue(investigation("inv-1", "running"));

		await expect(handoffHandler()({ input: { id: "inv-1" } })).rejects.toMatchObject({
			code: "CONFLICT",
		});
	});

	it("handoff-L11: a completed run whose workspace is null rejects with exact message", async () => {
		mockInvestigationsService.findById.mockResolvedValue({
			...investigation("inv-1", "completed"),
			workspace: null,
		});

		await expect(handoffHandler()({ input: { id: "inv-1" } })).rejects.toMatchObject({
			code: "CONFLICT",
			message: "This run recorded no workspace, so there is nothing to continue from.",
		});
	});
});

describe("InvestigationsController rate limit", () => {
	function contextFor(method: string, path: string): ExecutionContext {
		return {
			switchToHttp: () => ({
				getRequest: () => ({ method, path, ip: "127.0.0.1", headers: {} }),
				getResponse: () => ({ header: () => undefined }),
			}),
			getClass: () => InvestigationsController,
			getHandler: () => InvestigationsController.prototype.investigations,
		} as unknown as ExecutionContext;
	}

	async function guardAllowingOne(): Promise<MutationThrottleGuard> {
		const guard = new MutationThrottleGuard(
			{ throttlers: [{ name: "default", ttl: 60_000, limit: 1 }] },
			new ThrottlerStorageService(),
			new Reflector(),
		);
		await guard.onModuleInit();
		return guard;
	}

	it("is guarded by the mutation throttle", () => {
		expect(Reflect.getMetadata(GUARDS_METADATA, InvestigationsController)).toEqual([MutationThrottleGuard]);
	});

	it("never throttles reading a run", async () => {
		const guard = await guardAllowingOne();
		for (const path of ["/api/investigations/inv-1", "/api/investigations/inv-1/status", "/api/investigations/inv-1/events"]) {
			for (let i = 0; i < 5; i++) {
				await expect(guard.canActivate(contextFor("GET", path))).resolves.toBe(true);
			}
		}
	});

	it("throttles starting and steering a run", async () => {
		const guard = await guardAllowingOne();
		for (const path of ["/api/investigations", "/api/investigations/inv-1/messages"]) {
			await expect(guard.canActivate(contextFor("POST", path))).resolves.toBe(true);
			await expect(guard.canActivate(contextFor("POST", path))).rejects.toBeInstanceOf(ThrottlerException);
		}
	});
});
