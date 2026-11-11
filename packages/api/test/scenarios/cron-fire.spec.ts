// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CronService } from "../../src/modules/cron/cron.service.js";
import type { SessionLifecycleService } from "../../src/modules/wakes/session-lifecycle.service.js";
import { eventually, ScenarioApp } from "./support/scenario-app.js";

const pl = new ScenarioApp();

beforeAll(async () => {
	await pl.boot();
}, 60_000);

afterAll(async () => {
	await pl.dispose();
});

describe("Cron job fire scenario (#1024 surface F)", () => {
	it("a cron job on a finished thread fires and resumes it with text starting Scheduled: <name>", async () => {
		const { CronService } = await import("../../src/modules/cron/cron.service.js");
		const { SessionLifecycleService } = await import("../../src/modules/wakes/session-lifecycle.service.js");

		const prisma = await pl.prisma();
		const now = new Date();
		const promptText = "Inspect memory usage and error rates";
		const jobName = "nightly check";

		// Create finished thread
		const thread = await prisma.investigation.create({
			data: {
				kind: "chat",
				status: "completed",
				harness: "claude-code",
				title: "Finished cron thread",
				lastTurnOutcome: "answered",
				workspace: JSON.stringify({
					layout: "single",
					cwd: pl.workspace,
					repos: [],
				}),
			},
		});

		// Create a due cron job on the finished thread
		const cronJob = await prisma.cronJob.create({
			data: {
				investigationId: thread.id,
				name: jobName,
				schedule: "0 0 * * *",
				prompt: promptText,
				recurring: true,
				nextAt: now,
			},
		});

		// 1. Cron tick picks up the due job and schedules the cron wake
		const cronService = pl.resolve<CronService>(CronService)!;
		await cronService.tick(now);

		const scheduledWake = await prisma.threadWake.findFirst({
			where: { investigationId: thread.id, kind: "cron", state: "pending" },
		});
		expect(scheduledWake).not.toBeNull();
		const expectedFireText = `Scheduled: ${jobName}\n${promptText}`;
		expect(scheduledWake?.reason).toBe(expectedFireText);

		// 2. Session lifecycle fires the wake and resumes the finished thread
		const lifecycle = pl.resolve<SessionLifecycleService>(SessionLifecycleService)!;
		await lifecycle.process(now);

		// Wake marked done
		const wakeAfter = await prisma.threadWake.findUnique({ where: { id: scheduledWake!.id } });
		expect(wakeAfter?.state).toBe("done");

		// Thread resumed with the prompt text and completes
		await eventually(
			() => pl.api<{ status: string }>(`/investigations/${thread.id}`),
			(i) => i.status === "completed",
			"the resumed cron turn to finish",
			30_000,
		);

		// Delivered text starts with Scheduled: <name>
		const events = await prisma.investigationEvent.findMany({
			where: { investigationId: thread.id },
			orderBy: { seq: "asc" },
		});
		const msgEvent = events.find((e) => e.event.includes('"kind":"operator_message"'));
		expect(msgEvent).toBeDefined();
		const parsedEvent = JSON.parse(msgEvent?.event ?? "{}") as { text?: string };
		expect(parsedEvent.text?.startsWith(`Scheduled: ${jobName}`)).toBe(true);
		expect(parsedEvent.text).toBe(expectedFireText);
	}, 90_000);
});
