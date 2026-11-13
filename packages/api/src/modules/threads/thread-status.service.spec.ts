// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ScenarioApp } from "../../../test/scenarios/support/scenario-app.js";
import { ThreadStatusService } from "./thread-status.service.js";

const pl = new ScenarioApp();

beforeAll(async () => {
	await pl.boot();
}, 60_000);

afterAll(async () => {
	await pl.dispose();
});

async function createThread(title = "test thread", status = "completed", over: Record<string, unknown> = {}): Promise<string> {
	const prisma = await pl.prisma();
	const row = await prisma.investigation.create({
		data: {
			kind: "chat",
			status,
			title,
			lastTurnOutcome: "answered",
			...over,
		},
	});
	return row.id;
}

describe("ThreadStatusService (#1101)", () => {
	it("an open tool ask (tool_asks row, status open) makes a completed thread 'approval'", async () => {
		const prisma = await pl.prisma();
		const threadId = await createThread("completed with tool ask", "completed");
		const now = new Date();
		const askId = randomUUID();

		const askPayload = {
			askId,
			threadId,
			kind: "permission",
			title: "Tool Permission Ask",
			openedAt: now.toISOString(),
			source: { kind: "tool", tool: "test-tool", requestId: "req-1" },
			requiresHost: true,
			permission: {
				toolKind: "execute",
				options: [
					{
						optionId: "opt-1",
						name: "Allow once",
						kind: "allow_once",
					},
				],
			},
		};

		await prisma.toolAsk.create({
			data: {
				askId,
				threadId,
				ask: JSON.stringify(askPayload),
				status: "open",
				openedAt: now,
			},
		});

		const service = pl.resolve<ThreadStatusService>(ThreadStatusService)!;
		const statuses = await service.statuses([
			{
				id: threadId,
				status: "completed",
				awaitingApprovalAt: null,
				autoPause: null,
				lastActivityAt: now,
			},
		], now);

		expect(statuses.get(threadId)).toEqual({ status: "approval" });
	});

	it("an old ThreadWait row makes nothing wait on a thread (#1101 cat 2, 561805422)", async () => {
		const prisma = await pl.prisma();
		const targetId = await createThread("Target Worker", "running");
		const waiterId = await createThread("Waiter Thread", "completed");
		const now = new Date();
		await prisma.threadWait.create({ data: { waiterId, targetId } });

		const service = pl.resolve<ThreadStatusService>(ThreadStatusService)!;
		const statuses = await service.statuses([
			{
				id: waiterId,
				status: "completed",
				awaitingApprovalAt: null,
				autoPause: null,
				lastActivityAt: now,
			},
		], now);

		expect(statuses.get(waiterId)).toEqual({ status: "done" });
	});
	it("a PrWatch gives kind 'pr' with the PR number", async () => {
		const prisma = await pl.prisma();
		const threadId = await createThread("pr watching thread", "completed");
		const now = new Date();

		const prNumber = 1234;
		const pr = await prisma.pullRequest.create({
			data: {
				investigationId: threadId,
				host: "github",
				url: `https://github.com/acme/repo/pull/${prNumber}`,
				repo: "acme/repo",
				number: prNumber,
				title: "Feature PR",
				source: "branch",
				state: "open",
				headSha: "head123",
			},
		});

		await prisma.prWatch.create({
			data: {
				investigationId: threadId,
				prId: pr.id,
				until: "checks_done",
				expiresAt: new Date(now.getTime() + 60_000),
			},
		});

		const service = pl.resolve<ThreadStatusService>(ThreadStatusService)!;
		const statuses = await service.statuses([
			{
				id: threadId,
				status: "completed",
				awaitingApprovalAt: null,
				autoPause: null,
				lastActivityAt: now,
			},
		], now);

		expect(statuses.get(threadId)).toEqual({
			status: "waiting",
			waitingOn: {
				kind: "pr",
				number: 1234,
				until: "checks_done",
			},
		});
	});

	it("a pending agent ThreadWake gives kind 'wake'", async () => {
		const prisma = await pl.prisma();
		const threadId = await createThread("agent wake thread", "completed");
		const now = new Date();
		const wakeAt = new Date(now.getTime() + 300_000);

		await prisma.threadWake.create({
			data: {
				investigationId: threadId,
				kind: "agent",
				at: wakeAt,
				reason: "periodic check",
				state: "pending",
			},
		});

		const service = pl.resolve<ThreadStatusService>(ThreadStatusService)!;
		const statuses = await service.statuses([
			{
				id: threadId,
				status: "completed",
				awaitingApprovalAt: null,
				autoPause: null,
				lastActivityAt: now,
			},
		], now);

		expect(statuses.get(threadId)).toEqual({
			status: "waiting",
			waitingOn: {
				kind: "wake",
				at: wakeAt.toISOString(),
			},
		});
	});

	it("a CronJob gives kind 'cron'", async () => {
		const prisma = await pl.prisma();
		const threadId = await createThread("cron thread", "completed");
		const now = new Date();
		const nextAt = new Date(now.getTime() + 1800_000);

		await prisma.cronJob.create({
			data: {
				investigationId: threadId,
				name: "test-cron",
				prompt: "run every 30 mins",
				schedule: "*/30 * * * *",
				nextAt,
			},
		});

		const service = pl.resolve<ThreadStatusService>(ThreadStatusService)!;
		const statuses = await service.statuses([
			{
				id: threadId,
				status: "completed",
				awaitingApprovalAt: null,
				autoPause: null,
				lastActivityAt: now,
			},
		], now);

		expect(statuses.get(threadId)).toEqual({
			status: "waiting",
			waitingOn: {
				kind: "cron",
				schedule: "*/30 * * * *",
				nextAt: nextAt.toISOString(),
			},
		});
	});

	it("a pending limit wake on a failed thread gives 'limited'", async () => {
		const prisma = await pl.prisma();
		const threadId = await createThread("limit wake thread", "failed");
		const now = new Date();

		await prisma.threadWake.create({
			data: {
				investigationId: threadId,
				kind: "limit",
				at: now,
				reason: "rate limit reached",
				state: "pending",
				payload: JSON.stringify({ mode: "rate_limited" }),
			},
		});

		const service = pl.resolve<ThreadStatusService>(ThreadStatusService)!;
		const statuses = await service.statuses([
			{
				id: threadId,
				status: "failed",
				awaitingApprovalAt: null,
				autoPause: null,
				lastActivityAt: now,
			},
		], now);

		expect(statuses.get(threadId)).toEqual({
			status: "limited",
			mode: "rate_limited",
		});
	});

	it("a skipped limit wake with payload {blocked:true,mode:'key_rejected'} gives 'blocked'", async () => {
		const prisma = await pl.prisma();
		const threadId = await createThread("blocked limit wake thread", "failed");
		const now = new Date();

		await prisma.threadWake.create({
			data: {
				investigationId: threadId,
				kind: "limit",
				at: now,
				reason: "key rejected",
				state: "skipped",
				payload: JSON.stringify({ blocked: true, mode: "key_rejected" }),
			},
		});

		const service = pl.resolve<ThreadStatusService>(ThreadStatusService)!;
		const statuses = await service.statuses([
			{
				id: threadId,
				status: "failed",
				awaitingApprovalAt: null,
				autoPause: null,
				lastActivityAt: now,
			},
		], now);

		expect(statuses.get(threadId)).toEqual({
			status: "blocked",
			mode: "key_rejected",
		});
	});

	it("openAsks returns the tool ask with ended:false", async () => {
		const prisma = await pl.prisma();
		const threadId = await createThread("tool ask open thread", "completed");
		const now = new Date();
		const askId = randomUUID();

		const askPayload = {
			askId,
			threadId,
			kind: "permission",
			title: "Tool Permission Ask",
			openedAt: now.toISOString(),
			source: { kind: "tool", tool: "test-tool", requestId: "req-open" },
			requiresHost: true,
			permission: {
				toolKind: "execute",
				options: [
					{
						optionId: "opt-1",
						name: "Allow once",
						kind: "allow_once",
					},
				],
			},
		};

		await prisma.toolAsk.create({
			data: {
				askId,
				threadId,
				ask: JSON.stringify(askPayload),
				status: "open",
				openedAt: now,
			},
		});

		const service = pl.resolve<ThreadStatusService>(ThreadStatusService)!;
		const threadAsks = await service.openAsks();
		const item = threadAsks.asks.find((a: any) => a.ask.askId === askId);

		expect(item?.ended).toBe(false);
	});
});
