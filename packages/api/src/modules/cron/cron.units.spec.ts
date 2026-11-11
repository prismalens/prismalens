// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { afterEach, describe, expect, it, vi } from "vitest";
import { cronTools } from "../gateway/tools/cron.js";
import { PrFeedService } from "../threads/pr-feed.service.js";
import { CronService, cronScheduleError, cronView } from "./cron.service.js";

afterEach(() => vi.useRealTimers());

const NOW = new Date("2026-11-11T12:00:00Z");

describe("cron seams (#1024 surface F)", () => {
	it("Given four fields, Then the schedule is refused with the five-field message; Given Feb 30, Then it never runs", () => {
		expect(cronScheduleError("0 9 * *", NOW)).toBe(
			"A cron expression has five fields: minute, hour, day of month, month, day of week.",
		);
		expect(cronScheduleError("0 9 30 2 *", NOW)).toBe("This cron expression never runs.");
	});

	it("Given a thread that is gone, When cron_create runs, Then it is refused as invalid input with next 'Finish without a cron job.'", async () => {
		const svc = new CronService(
			{ investigation: { findUnique: vi.fn().mockResolvedValue(null) } } as never,
			{} as never,
		);
		expect(await svc.create("gone", { schedule: "0 9 * * *", prompt: "Check", recurring: true }, NOW)).toEqual({
			error: "This thread is gone.",
			code: "invalid_input",
			next: "Finish without a cron job.",
		});
	});

	it("Given a fired one-shot job, Then its view has no next fire and no expiry", () => {
		const created = new Date("2026-11-10T09:00:00Z");
		expect(
			cronView({
				id: "j1",
				investigationId: "t1",
				name: "once",
				schedule: "0 9 * * *",
				prompt: "Check",
				recurring: false,
				nextAt: null,
				expiresAt: null,
				lastFiredAt: created,
				pendingSince: null,
				skipped: 0,
				createdAt: created,
			}),
		).toEqual({
			id: "j1",
			name: "once",
			schedule: "0 9 * * *",
			prompt: "Check",
			recurring: false,
			next: null,
			expires: null,
			pending: false,
			lastFiredAt: created.toISOString(),
			skipped: 0,
			createdAt: created.toISOString(),
		});
	});

	it("Given a refused create, When cron_create runs, Then the tool fails with the service's code, message and next", async () => {
		const create = cronTools({
			create: vi.fn().mockResolvedValue({
				error: "This thread already has 3 cron jobs.",
				code: "limit_reached",
				next: "Delete one with `cron_delete`.",
			}),
			list: vi.fn(),
			remove: vi.fn(),
		}).find((t) => t.name === "cron_create");
		if (!create) throw new Error("cron_create is not served");
		const r = await create.run(create.input.parse({ schedule: "0 9 * * *", prompt: "Check" }), {
			runId: "t1",
			signal: new AbortController().signal,
		});
		expect(r).toEqual({
			failure: {
				error: "limit_reached",
				message: "This thread already has 3 cron jobs.",
				next: "Delete one with `cron_delete`.",
			},
		});
	});

	it("When the cron and PR status services start, Then each runs its pass on its beat; When they stop, Then the passes stop", async () => {
		vi.useFakeTimers();
		const cron = new CronService({} as never, {} as never);
		const feed = new PrFeedService({} as never, {} as never, {} as never, {} as never);
		const cronTick = vi.spyOn(cron, "tick").mockResolvedValue(undefined);
		const feedTick = vi.spyOn(feed, "tick").mockResolvedValue(undefined);
		cron.onModuleInit();
		feed.onModuleInit();
		await vi.advanceTimersByTimeAsync(1_000);
		expect(cronTick).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(119_000);
		expect(cronTick).toHaveBeenCalledTimes(5);
		expect(feedTick).toHaveBeenCalledTimes(1);
		cron.onModuleDestroy();
		feed.onModuleDestroy();
		await vi.advanceTimersByTimeAsync(240_000);
		expect(cronTick).toHaveBeenCalledTimes(5);
		expect(feedTick).toHaveBeenCalledTimes(1);
	});
});
