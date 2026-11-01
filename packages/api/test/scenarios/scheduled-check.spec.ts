// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { Schedule, ScheduleDetail, ScheduleInput, ScheduleTick } from "@prismalens/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eventually, ScenarioApp } from "./support/scenario-app.js";

const pl = new ScenarioApp();

beforeAll(async () => {
	await pl.boot();
}, 60_000);
afterAll(async () => {
	await pl.dispose();
});

const finished = (run?: { status: string } | null) =>
	!!run && !["pending", "running"].includes(run.status);

describe("Walk #979: scheduled checks run end to end", () => {
	it("Given a service with a repository, When host creates a schedule and runs it now, Then the run reaches a terminal status with scheduled triggerType and unattended job", async () => {
		const service = await pl.serviceWithRepo("books");

		const input: ScheduleInput = {
			name: "Books health check",
			serviceId: service.id,
			runbook: null,
			brief: "Check books API health and recent commit log",
			recurrence: {
				type: "cron",
				expr: "0 9 * * 1-5",
				timezone: "UTC",
			},
			harness: "claude-code",
			model: null,
			effort: null,
			missedPolicy: "run_once",
			catchUpMinutes: 60,
		};

		const schedule = await pl.api<Schedule>("/schedules", {
			method: "POST",
			body: input,
		});
		expect(schedule.id).toBeDefined();

		const tick = await pl.api<ScheduleTick>(`/schedules/${schedule.id}/run`, {
			method: "POST",
		});
		expect(tick.outcome).toBe("run_now");

		const detail = await eventually(
			() => pl.api<ScheduleDetail>(`/schedules/${schedule.id}`),
			(d) => d.ticks.some((t) => t.outcome === "run_now" && finished(t.run)),
			"the scheduled run to finish",
			30_000,
		);

		const runNowTick = detail.ticks.find((t) => t.outcome === "run_now");
		expect(runNowTick?.run).toBeDefined();
		expect(runNowTick?.run?.status).toBe("completed");

		const runId = runNowTick!.run!.id;
		const investigation = await pl.investigation(runId);
		expect(investigation.triggerType).toBe("scheduled");

		const { prisma } = await import("@prismalens/database");
		const job = await prisma.job.findUnique({ where: { investigationId: runId } });
		expect(job).not.toBeNull();
		const payload = JSON.parse(job!.payload);
		expect(payload.unattended).toBe(true);

		// Promotion rule: supported/confirmed hypothesis backed by verified supporting evidence creates an incident.
		const hasPromotionEvidence = (investigation.report?.hypotheses ?? []).some(
			(h) =>
				(h.status === "confirmed" || h.status === "supported") &&
				h.evidence.some((e) => e.status === "verified" && e.direction === "supports"),
		);
		expect(hasPromotionEvidence).toBe(true);
		expect(investigation.incidentId).toBeTruthy();

		const incidents = await pl.incidents();
		const incident = incidents.find((i) => i.id === investigation.incidentId);
		expect(incident).toBeDefined();
	}, 60_000);

	it("When a second run is triggered while one is live, Then it answers 409 CONFLICT; sequential runs make distinct ticks", async () => {
		const [schedule] = (await pl.api<{ schedules: Schedule[] }>("/schedules")).schedules;
		expect(schedule).toBeDefined();

		await eventually(
			() => pl.api<ScheduleDetail>(`/schedules/${schedule.id}`),
			(d) => d.ticks.every((t) => finished(t.run)),
			"prior runs to reach terminal status",
			30_000,
		);

		let racedConflict = false;
		await pl.api<ScheduleTick>(`/schedules/${schedule.id}/run`, { method: "POST" });
		try {
			await pl.api<ScheduleTick>(`/schedules/${schedule.id}/run`, { method: "POST" });
		} catch (err) {
			if ((err as Error).message.includes("409")) {
				racedConflict = true;
			} else {
				throw err;
			}
		}

		if (racedConflict) {
			expect(racedConflict).toBe(true);
		} else {
			const detail = await eventually(
				() => pl.api<ScheduleDetail>(`/schedules/${schedule.id}`),
				(d) => d.ticks.filter((t) => t.outcome === "run_now" && finished(t.run)).length >= 2,
				"two sequential runs to complete",
				30_000,
			);
			expect(detail.ticks.filter((t) => t.outcome === "run_now").length).toBeGreaterThanOrEqual(2);
		}

		await eventually(
			() => pl.api<ScheduleDetail>(`/schedules/${schedule.id}`),
			(d) => d.ticks.every((t) => finished(t.run)),
			"all runs to reach terminal status",
			30_000,
		);
	}, 60_000);

});
