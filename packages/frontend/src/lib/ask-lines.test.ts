// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { PendingAsk } from "@prismalens/contracts";
import { describe, expect, it } from "vitest";
import {
	alwaysLine,
	askSubject,
	waitedFor,
	whyAsked,
} from "./ask-lines.js";

const makeAsk = (over: Partial<PendingAsk> = {}): PendingAsk => ({
	askId: "11111111-1111-4111-8111-111111111111",
	threadId: "22222222-2222-4222-8222-222222222222",
	kind: "permission",
	requiresHost: false,
	source: { kind: "agent" },
	title: "Ask Title",
	openedAt: "2026-11-12T12:00:00.000Z",
	...over,
});

describe("ask-lines (#1101 category 8)", () => {
	it("askSubject", () => {
		// Command in permission
		const askCmd = makeAsk({
			permission: {
				command: "git status",
				options: [],
				toolKind: null,
			},
		});
		expect(askSubject(askCmd)).toBe("git status");

		// Detail fallback
		const askDetail = makeAsk({
			detail: "Delete the database",
		});
		expect(askSubject(askDetail)).toBe("Delete the database");

		// Input fallback
		const askInput = makeAsk({
			permission: {
				input: "{\"flag\": true}",
				options: [],
				toolKind: null,
			},
		});
		expect(askSubject(askInput)).toBe("{\"flag\": true}");

		// Null fallback
		const askEmpty = makeAsk();
		expect(askSubject(askEmpty)).toBe(null);
	});

	it("whyAsked", () => {
		// Tool ask
		const toolAsk = makeAsk({ source: { kind: "tool", tool: "test-tool", requestId: "r1" } });
		expect(whyAsked(toolAsk, null)).toBe("PrismaLens tools always ask the host first.");

		// Question ask
		const questionAsk = makeAsk({ kind: "question" });
		expect(whyAsked(questionAsk, null)).toBe("The agent asked you directly; no mode skips a question.");

		// Plan variant permission
		const planAsk = makeAsk({
			kind: "permission",
			permission: {
				variant: "plan",
				options: [],
				toolKind: null,
			},
		});
		expect(whyAsked(planAsk, null)).toBe("The agent finished planning and waits for your go.");

		// AccessLevel provided
		const askWithLevel = makeAsk();
		expect(whyAsked(askWithLevel, "supervised")).toBe("Asked because this thread runs in Ask always.");

		// No AccessLevel
		expect(whyAsked(askWithLevel, null)).toBe("Asked because the agent's own mode asks first.");
	});

	// 3d891b694: an agent's ask offers Always only when the agent offered allow_always;
	// PrismaLens's own tool asks still remember by identity.
	it("alwaysLine", () => {
		// No identity or plan variant -> null
		const noIdAsk = makeAsk();
		expect(alwaysLine(noIdAsk)).toBe(null);

		const planAsk = makeAsk({
			permission: {
				identity: "id-123",
				variant: "plan",
				options: [],
				toolKind: null,
			},
		});
		expect(alwaysLine(planAsk)).toBe(null);

		// An agent's ask with an identity but no allow_always on offer -> null
		const noOfferAsk = makeAsk({
			permission: { identity: "id-123", options: [], toolKind: null },
		});
		expect(alwaysLine(noOfferAsk)).toBe(null);

		// An agent's ask whose agent offered allow_always
		const offeredAsk = makeAsk({
			permission: {
				options: [
					{ optionId: "allow", name: "Allow", kind: "allow_once" },
					{ optionId: "always", name: "Always", kind: "allow_always" },
				],
				toolKind: null,
			},
		});
		expect(alwaysLine(offeredAsk)).toBe(
			"The agent stops asking for this in this thread.",
		);

		const tool = { kind: "tool" as const, tool: "pl_cron_create", requestId: "r1" };
		// A tool's ask with a pattern
		const patternAsk = makeAsk({
			source: tool,
			permission: {
				identity: "id-123",
				pattern: "git *",
				options: [],
				toolKind: null,
			},
		});
		expect(alwaysLine(patternAsk)).toBe("Always allows git * in this thread from now on.");

		// A tool's ask without a pattern (exact action)
		const exactAsk = makeAsk({
			source: tool,
			permission: {
				identity: "id-123",
				options: [],
				toolKind: null,
			},
		});
		expect(alwaysLine(exactAsk)).toBe("Always allows this exact action in this thread from now on.");
	});

	// b03f1e07d: an ask's wait reads in the kit's one relative format.
	it("waitedFor", () => {
		const now = Date.parse("2026-11-12T12:00:00.000Z");

		// Just now (< 1 min)
		expect(waitedFor(new Date(now - 30_000).toISOString(), now)).toBe("now");

		// 3 min (< 60 min)
		expect(waitedFor(new Date(now - 3 * 60_000).toISOString(), now)).toBe("3m");

		// 2 h (< 24 h)
		expect(waitedFor(new Date(now - 2 * 3600_000).toISOString(), now)).toBe("2h");

		// 3 d (>= 24 h)
		expect(waitedFor(new Date(now - 3 * 86400_000).toISOString(), now)).toBe("3d");
	});
});
