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
import { DispatchService } from "../../infrastructure/dispatch/dispatch.service.js";
import { InvestigationsController } from "./investigations.controller.js";
import { InvestigationsService } from "./investigations.service.js";
import { GitHubCommentService } from "../delivery/github-comment.service.js";
import { TelemetryService } from "../../core/telemetry/telemetry.service.js";
import { telemetryStub } from "../../../test/factories/index.js";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const mockInvestigationsService = {
	findById: vi.fn(),
};

const mockDispatchService = {
	sendMessage: vi.fn(),
	resumeInvestigation: vi.fn(),
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
				{ provide: GitHubCommentService, useValue: { post: vi.fn() } },
			],
		})
			.overrideGuard(MutationThrottleGuard)
			.useValue({ canActivate: () => true })
			.compile();
		controller = module.get(InvestigationsController);
	});

	type Input = { id: string; text: string; mode: "queue" | "now" };
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

		expect(mockDispatchService.sendMessage).toHaveBeenCalledWith("inv-1", "check the TTL", "queue");
		expect(result).toEqual({ state: "queued" });
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
			expect(mockDispatchService.resumeInvestigation).toHaveBeenCalledWith("inv-1", "why the pool?", "queue");
			expect(mockDispatchService.sendMessage).not.toHaveBeenCalled();
		});

		it("refuses a harness that cannot reopen a session with the registry's words", async () => {
			mockInvestigationsService.findById.mockResolvedValue(finished("deepagents"));

			await expect(
				messageHandler()({ input: { id: "inv-1", text: "hi", mode: "queue" } }),
			).rejects.toMatchObject({
				code: "CONFLICT",
				message: "deepagents can't reopen a finished session, so a new run starts from the report.",
			});
			expect(mockDispatchService.resumeInvestigation).not.toHaveBeenCalled();
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
