// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Hermetic tests for the internal bulk-append endpoint (ADR-0018 B.4): each event is
 * validated with CanonicalEventSchema; invalid ones are DROPPED + logged (never a
 * 500), valid ones forwarded to the idempotent service insert. A malformed envelope
 * is a 400. The service is a spy — no DB.
 */
import { BadRequestException, Logger } from "@nestjs/common";
import type { CanonicalEvent } from "@prismalens/contracts";
import type { InvestigationsService } from "../../modules/investigations/investigations.service.js";
import { InternalInvestigationsController } from "./internal-investigations.controller.js";

const RUN_ID = "33333333-3333-4333-8333-333333333333";
const INV_ID = "11111111-1111-4111-8111-111111111111";

function stepEvent(seq: number): CanonicalEvent {
	return {
		kind: "agent_step",
		runId: RUN_ID,
		branchId: "branch-1",
		path: [],
		seq,
		ts: "2026-07-05T00:00:00.000Z",
		text: "",
		toolCalls: [],
	};
}

function makeController() {
	const service = {
		appendEvents: vi.fn().mockResolvedValue({ inserted: 0, duplicates: 0 }),
		clearEvents: vi.fn().mockResolvedValue(0),
	};
	const controller = new InternalInvestigationsController(
		service as unknown as InvestigationsService,
	);
	return { controller, service };
}

describe("InternalInvestigationsController.appendEvents (bulk-append)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.spyOn(Logger.prototype, "warn").mockImplementation(() => {});
	});

	it("forwards only the valid events and reports accepted vs dropped", async () => {
		const { controller, service } = makeController();

		const result = await controller.appendEvents(INV_ID, {
			events: [stepEvent(1), { kind: "garbage" }, stepEvent(2)],
		});

		expect(result).toEqual({ accepted: 2, dropped: 1 });
		expect(service.appendEvents).toHaveBeenCalledTimes(1);
		const [, forwarded] = service.appendEvents.mock.calls[0];
		expect(forwarded).toHaveLength(2);
		expect(forwarded.map((e: CanonicalEvent) => e.seq)).toEqual([1, 2]);
	});

	it("never 500s on a batch of only-invalid events — it drops them all, inserts nothing", async () => {
		const { controller, service } = makeController();

		const result = await controller.appendEvents(INV_ID, {
			events: [{ kind: "nope" }, { totally: "wrong" }],
		});

		expect(result).toEqual({ accepted: 0, dropped: 2 });
		expect(service.appendEvents).not.toHaveBeenCalled();
	});

	it("accepts an empty batch as a no-op", async () => {
		const { controller, service } = makeController();

		const result = await controller.appendEvents(INV_ID, { events: [] });

		expect(result).toEqual({ accepted: 0, dropped: 0 });
		expect(service.appendEvents).not.toHaveBeenCalled();
	});

	it("rejects a malformed envelope with a 400 (distinct from a per-event drop)", async () => {
		const { controller } = makeController();

		await expect(
			controller.appendEvents(INV_ID, { notEvents: true }),
		).rejects.toBeInstanceOf(BadRequestException);
	});
});

describe("InternalInvestigationsController.clearEvents (retry fresh-record)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.spyOn(Logger.prototype, "warn").mockImplementation(() => {});
	});

	it("deletes the durable record and reports the deleted count", async () => {
		const { controller, service } = makeController();
		service.clearEvents.mockResolvedValue(7);

		const result = await controller.clearEvents(INV_ID);

		expect(service.clearEvents).toHaveBeenCalledWith(INV_ID);
		expect(result).toEqual({ deleted: 7 });
	});

	it("is a no-op when there is nothing to clear (0 rows)", async () => {
		const { controller, service } = makeController();
		service.clearEvents.mockResolvedValue(0);

		const result = await controller.clearEvents(INV_ID);

		expect(result).toEqual({ deleted: 0 });
	});

	it("processes PATCH :id/status with ValidationPipe through NestJS app", async () => {
		const { Test } = await import("@nestjs/testing");
		const { ValidationPipe } = await import("@nestjs/common");
		const { InvestigationsService } = await import(
			"../../modules/investigations/investigations.service.js"
		);
		const { ConfigService } = await import("@nestjs/config");
		const service = {
			updateStatusInternal: vi
				.fn()
				.mockResolvedValue({ id: INV_ID, status: "running" }),
		};
		const moduleRef = await Test.createTestingModule({
			controllers: [InternalInvestigationsController],
			providers: [
				{ provide: InvestigationsService, useValue: service },
				{
					provide: ConfigService,
					useValue: { get: vi.fn().mockReturnValue("test-secret") },
				},
			],
		}).compile();
		const app = moduleRef.createNestApplication();
		app.useGlobalPipes(
			new ValidationPipe({
				whitelist: true,
				transform: true,
				forbidNonWhitelisted: true,
			}),
		);
		await app.init();
		const server = app.getHttpServer();
		await new Promise<void>((resolve) => server.listen(0, resolve));
		const addr = server.address();
		const port = typeof addr === "object" && addr ? addr.port : 0;

		const response = await fetch(
			`http://127.0.0.1:${port}/internal/investigations/${INV_ID}/status`,
			{
				method: "PATCH",
				headers: {
					"Content-Type": "application/json",
					"X-Internal-Secret": "test-secret",
				},
				body: JSON.stringify({
					status: "running",
					harnessThreadId: RUN_ID,
				}),
			},
		);

		expect(response.status).toBe(200);
		const data = await response.json();
		expect(data).toEqual({ id: INV_ID, status: "running" });
		await app.close();
	});
});
