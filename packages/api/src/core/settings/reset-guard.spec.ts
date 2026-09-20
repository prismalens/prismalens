// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * A reset and a starting run, racing (#662 review).
 *
 * SQLite serialises writers and `startOrGet` does its check and its insert in
 * one transaction, so the count+delete of a reset and a create cannot
 * interleave. What is left is ordering: a create that commits *after* the reset
 * commits lands on an incident the reset just deleted and fails on the foreign
 * key. These cover both ends of that — the flag that refuses a create before it
 * starts, and the P2003 that catches the one already in flight.
 */

import { ORPCError } from "@orpc/nest";
import { describe, expect, it, vi } from "vitest";
import type { OverlayService } from "../../modules/overlay/overlay.service.js";
import type { TimelineService } from "../../modules/timeline/timeline.service.js";
import { InvestigationsService } from "../../modules/investigations/investigations.service.js";
import { InvestigationsController } from "../../modules/investigations/investigations.controller.js";
import type { DispatchService } from "../../infrastructure/dispatch/dispatch.service.js";
import type { PrismaService } from "../prisma/prisma.service.js";
import { ResetInProgressError, SettingsService } from "./settings.service.js";
import { telemetryStub } from "../../../test/factories/index.js";

/** A Prisma client whose only job is to let one reset transaction run. */
function prismaWith(
	transaction: (fn: (tx: unknown) => Promise<unknown>) => Promise<unknown>,
) {
	return { $transaction: transaction } as unknown as PrismaService;
}

type SettingsStub = Pick<
	SettingsService,
	"isResetting" | "resetGeneration" | "resetSince"
>;

/** A settings service that never resets, for the cases that are not about one. */
const quiet = (isResetting = false): SettingsStub => ({
	isResetting: () => isResetting,
	resetGeneration: () => 0,
	resetSince: () => isResetting,
});

function investigations(options: {
	settings: SettingsStub;
	transaction?: () => Promise<unknown>;
}) {
	const prisma = prismaWith(
		(options.transaction ?? (async () => ({}))) as never,
	);
	return new InvestigationsService(
		prisma,
		{ create: vi.fn() } as unknown as TimelineService,
		{} as OverlayService,
		options.settings as SettingsService,
	);
}

describe("the resetting flag", () => {
	it("is set for the duration of a reset and cleared after it", async () => {
		const seen: boolean[] = [];
		const service = new SettingsService(
			prismaWith(async (fn) => {
				seen.push(service.isResetting());
				return fn({
					recommendation: { deleteMany: vi.fn() },
					investigation: { deleteMany: vi.fn(), count: async () => 0 },
					timelineEntry: { deleteMany: vi.fn() },
					incident: { deleteMany: vi.fn() },
					alert: { deleteMany: vi.fn() },
					event: { deleteMany: vi.fn() },
				});
			}),
		);

		expect(service.isResetting()).toBe(false);
		await service.resetData();
		expect(seen).toEqual([true]);
		expect(service.isResetting()).toBe(false);
	});

	it("moves the generation on every reset, including one that throws", async () => {
		let fail = false;
		const service = new SettingsService(
			prismaWith(async (fn) => {
				if (fail) throw new Error("database is locked");
				return fn({
					recommendation: { deleteMany: vi.fn() },
					investigation: { deleteMany: vi.fn(), count: async () => 0 },
					timelineEntry: { deleteMany: vi.fn() },
					incident: { deleteMany: vi.fn() },
					alert: { deleteMany: vi.fn() },
					event: { deleteMany: vi.fn() },
				});
			}),
		);

		const start = service.resetGeneration();
		expect(service.resetSince(start)).toBe(false);

		await service.resetData();
		expect(service.resetSince(start)).toBe(true);

		// A reset that throws may still have deleted rows, so it counts too.
		const afterFirst = service.resetGeneration();
		fail = true;
		await expect(service.resetData()).rejects.toThrow("database is locked");
		expect(service.resetSince(afterFirst)).toBe(true);
	});

	it("is cleared even when the reset throws", async () => {
		const service = new SettingsService(
			prismaWith(async () => {
				throw new Error("database is locked");
			}),
		);

		await expect(service.resetData()).rejects.toThrow("database is locked");
		expect(service.isResetting()).toBe(false);

		await expect(service.factoryReset()).rejects.toThrow("database is locked");
		expect(service.isResetting()).toBe(false);
	});
});

describe("creating a run while a reset is in progress", () => {
	it("is refused before the transaction is even opened", async () => {
		const transaction = vi.fn();
		const service = investigations({
			settings: quiet(true),
			transaction: transaction as never,
		});

		await expect(service.startOrGet({ incidentId: "inc-1" })).rejects.toThrow(
			ResetInProgressError,
		);
		expect(transaction).not.toHaveBeenCalled();
	});

	it("starts normally once the reset has finished", async () => {
		let resetting = true;
		const service = investigations({
			settings: {
				isResetting: () => resetting,
				resetGeneration: () => 0,
				resetSince: () => resetting,
			},
			transaction: async () => ({
				investigation: { id: "inv-1", incidentId: "inc-1" },
				created: true,
			}),
		});

		await expect(service.startOrGet({ incidentId: "inc-1" })).rejects.toThrow(
			ResetInProgressError,
		);
		resetting = false;
		await expect(
			service.startOrGet({ incidentId: "inc-1" }),
		).resolves.toMatchObject({ created: true });
	});

	/**
	 * The create that was already inside its transaction when the flag went up.
	 * SQLite answers with a foreign key violation because the incident is gone;
	 * that is the same situation, so it gets the same answer rather than a 500.
	 */
	it("turns the foreign key violation of a deleted incident into the same error", async () => {
		// A reset that started and finished while the create was in flight:
		// `isResetting()` is false again by now, but the generation moved.
		let generation = 0;
		const service = investigations({
			settings: {
				isResetting: () => false,
				resetGeneration: () => generation,
				resetSince: (g: number) => g !== generation,
			},
			transaction: async () => {
				generation = 1;
				throw Object.assign(new Error("Foreign key constraint violated"), {
					code: "P2003",
				});
			},
		});

		await expect(service.startOrGet({ incidentId: "inc-1" })).rejects.toThrow(
			ResetInProgressError,
		);
	});

	/**
	 * #662 review (claude lane): `incidentId` is validated as a UUID and not for
	 * existence, so a stale or mistyped one hits the same P2003. Answering that
	 * with "a reset is in progress" is wrong and unactionable — retrying never
	 * helps — and on the webhook path, which swallows this error, a genuine
	 * referential problem would disappear into a log line.
	 */
	it("re-throws a foreign key violation when no reset happened", async () => {
		const service = investigations({
			settings: quiet(false),
			transaction: async () => {
				throw Object.assign(new Error("Foreign key constraint violated"), {
					code: "P2003",
				});
			},
		});

		const failure = await service
			.startOrGet({ incidentId: "no-such-incident" })
			.catch((e: unknown) => e);
		expect(failure).not.toBeInstanceOf(ResetInProgressError);
		expect((failure as Error).message).toMatch(/Foreign key/);
	});

	it("does not swallow an unrelated database error", async () => {
		const service = investigations({
			settings: quiet(false),
			transaction: async () => {
				throw Object.assign(new Error("unique constraint"), { code: "P2002" });
			},
		});

		await expect(service.startOrGet({ incidentId: "inc-1" })).rejects.toThrow(
			"unique constraint",
		);
	});

	it("reaches the caller as CONFLICT, not as a 500", async () => {
		const investigationsService = {
			startOrGet: vi.fn(async () => {
				throw new ResetInProgressError();
			}),
		} as unknown as InvestigationsService;
		const controller = new InvestigationsController(
			investigationsService,
			{} as DispatchService,
			telemetryStub(),
		);
		const create = (
			controller.investigations() as unknown as Record<
				string,
				{ "~orpc": { handler: (a: { input: unknown }) => Promise<unknown> } }
			>
		).create["~orpc"].handler;

		const failure = await create({ input: { incidentId: "inc-1" } }).catch(
			(e: unknown) => e,
		);
		expect(failure).toBeInstanceOf(ORPCError);
		expect(failure).toMatchObject({ code: "CONFLICT" });
		expect((failure as ORPCError<never, never>).message).toMatch(
			/reset is in progress/i,
		);
	});
});

describe("a status update that lands after a reset", () => {
	/**
	 * A run that was already executing when the reset committed still reports
	 * its terminal state. The row is gone, so the write cannot land — the thing
	 * that must not happen is the dispatcher crashing on it.
	 */
	it("returns null instead of throwing when the row no longer exists", async () => {
		const service = investigations({
			settings: quiet(false),
		});
		(service as unknown as { prisma: unknown }).prisma = {
			investigation: {
				update: async () => {
					throw Object.assign(new Error("Record to update not found"), {
						code: "P2025",
					});
				},
			},
		};

		await expect(
			service.updateStatusInternal("inv-gone", "failed", undefined, "boom"),
		).resolves.toBe(null);
	});
});
