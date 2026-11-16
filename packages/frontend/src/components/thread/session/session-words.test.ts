// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { ThreadSession } from "@prismalens/contracts";
import { describe, expect, it } from "vitest";
import {
	cacheWord,
	compactionLine,
	countdown,
	limitLine,
	meterLine,
	meterPercent,
	meterTone,
	needsColdPrompt,
	tokenCount,
	type ThreadLimit,
} from "./session-words";

const clock = (at: string) => at.slice(11, 16);

describe("meterTone", () => {
	it.each([
		[69, "neutral"],
		[70, "warn"],
		[90, "warn"],
		[91, "danger"],
	] as const)("meterTone(%i) gives %s", (percent, expected) => {
		expect(meterTone(percent)).toBe(expected);
	});

	it.each([
		[74, 85, "neutral"],
		[75, 85, "warn"],
		[84, 85, "warn"],
		[85, 85, "danger"],
		[86, 85, "danger"],
		[69, 80, "neutral"],
		[70, 80, "warn"],
		[80, 80, "danger"],
	] as const)("meterTone(%i, %i) boundaries give %s (#1101)", (percent, autoAt, expected) => {
		expect(meterTone(percent, autoAt)).toBe(expected);
	});
});

describe("meterPercent", () => {
	it.each([
		[142_000, 200_000, 71],
		[5, 0, 0],
		[300, 200, 100],
	])("meterPercent(%i, %i) is %i", (used, size, expected) => {
		expect(meterPercent(used, size)).toBe(expected);
	});
});

describe("tokenCount and meterLine", () => {
	it.each([
		[950, "950"],
		[18_000, "18k"],
		[142_400, "142k"],
		[1_200_000, "1.2M"],
		[12_000_000, "12M"],
	])("tokenCount(%i) gives %s", (n, expected) => {
		expect(tokenCount(n)).toBe(expected);
	});

	it("meterLine(142000, 200000) is 142k of 200k", () => {
		expect(meterLine(142_000, 200_000)).toBe("142k of 200k");
	});
});

describe("cacheWord", () => {
	it.each([
		["warm" as const, "Cache warm"],
		["cold" as const, "Cache cold"],
		["unknown" as const, null],
	])("cacheWord(%s) gives %s", (cache, expected) => {
		expect(cacheWord(cache)).toBe(expected);
	});
});

describe("needsColdPrompt at now = 2026-11-11T12:00:00Z", () => {
	const now = new Date("2026-11-11T12:00:00.000Z");

	it("cold with 50000 tokens gives true", () => {
		const session: Pick<ThreadSession, "cache" | "contextTokens" | "lastActivityAt"> = {
			cache: "cold",
			contextTokens: 50_000,
			lastActivityAt: "2026-11-11T12:00:00.000Z",
		};
		expect(needsColdPrompt(session, now)).toBe(true);
	});

	it("cold with 49999 gives false", () => {
		const session: Pick<ThreadSession, "cache" | "contextTokens" | "lastActivityAt"> = {
			cache: "cold",
			contextTokens: 49_999,
			lastActivityAt: "2026-11-11T12:00:00.000Z",
		};
		expect(needsColdPrompt(session, now)).toBe(false);
	});

	it("unknown, 50000 tokens, last activity 61 minutes earlier gives true", () => {
		const session: Pick<ThreadSession, "cache" | "contextTokens" | "lastActivityAt"> = {
			cache: "unknown",
			contextTokens: 50_000,
			lastActivityAt: new Date(now.getTime() - 61 * 60_000).toISOString(),
		};
		expect(needsColdPrompt(session, now)).toBe(true);
	});

	it("unknown, 59 minutes earlier gives false", () => {
		const session: Pick<ThreadSession, "cache" | "contextTokens" | "lastActivityAt"> = {
			cache: "unknown",
			contextTokens: 50_000,
			lastActivityAt: new Date(now.getTime() - 59 * 60_000).toISOString(),
		};
		expect(needsColdPrompt(session, now)).toBe(false);
	});

	it("warm gives false", () => {
		const session: Pick<ThreadSession, "cache" | "contextTokens" | "lastActivityAt"> = {
			cache: "warm",
			contextTokens: 50_000,
			lastActivityAt: new Date(now.getTime() - 120 * 60_000).toISOString(),
		};
		expect(needsColdPrompt(session, now)).toBe(false);
	});
});

describe("limitLine", () => {
	it("resuming gives Usage limit reached · resumes 15:45", () => {
		const fixture: ThreadLimit = {
			since: "2026-11-11T15:00:00.000Z",
			attempts: 1,
			autoResume: true,
			resetsAt: "2026-11-11T15:43:00.000Z",
			nextAttemptAt: "2026-11-11T15:45:00.000Z",
		};
		expect(limitLine(fixture, clock)).toBe("Usage limit reached · resumes 15:45");
	});

	it("retrying with maxAttempts 6, attempts 2, nextAttemptAt and resetsAt null gives Usage limit reached · trying again at 16:10 (2 of 6)", () => {
		const fixture: ThreadLimit = {
			since: "2026-11-11T15:00:00.000Z",
			attempts: 2,
			maxAttempts: 6,
			autoResume: true,
			resetsAt: null,
			nextAttemptAt: "2026-11-11T16:10:00.000Z",
		};
		expect(limitLine(fixture, clock)).toBe(
			"Usage limit reached · trying again at 16:10 (2 of 6)",
		);
	});

	it("retrying with maxAttempts 4 and attempts 3 gives Usage limit reached · trying again at 16:10 (3 of 4)", () => {
		const fixture: ThreadLimit = {
			since: "2026-11-11T15:00:00.000Z",
			attempts: 3,
			maxAttempts: 4,
			autoResume: true,
			resetsAt: null,
			nextAttemptAt: "2026-11-11T16:10:00.000Z",
		};
		expect(limitLine(fixture, clock)).toBe(
			"Usage limit reached · trying again at 16:10 (3 of 4)",
		);
	});

	it("retrying without maxAttempts gives Usage limit reached · trying again at 16:10 (try 2)", () => {
		const fixture: ThreadLimit = {
			since: "2026-11-11T15:00:00.000Z",
			attempts: 2,
			autoResume: true,
			resetsAt: null,
			nextAttemptAt: "2026-11-11T16:10:00.000Z",
		};
		expect(limitLine(fixture, clock)).toBe(
			"Usage limit reached · trying again at 16:10 (try 2)",
		);
	});

	it("off with resetsAt gives Usage limit reached · resets 15:45", () => {
		const fixture: ThreadLimit = {
			since: "2026-11-11T15:00:00.000Z",
			attempts: 1,
			autoResume: false,
			resetsAt: "2026-11-11T15:45:00.000Z",
		};
		expect(limitLine(fixture, clock)).toBe("Usage limit reached · resets 15:45");
	});

	it("off with resetsAt null gives Usage limit reached · reset time unknown", () => {
		const fixture: ThreadLimit = {
			since: "2026-11-11T15:00:00.000Z",
			attempts: 1,
			autoResume: false,
			resetsAt: null,
		};
		expect(limitLine(fixture, clock)).toBe(
			"Usage limit reached · reset time unknown",
		);
	});

	it("gave up with attempts 7 gives Stopped trying after 6 tries", () => {
		const fixture: ThreadLimit = {
			since: "2026-11-11T15:00:00.000Z",
			attempts: 7,
			autoResume: true,
			resetsAt: null,
			gaveUp: true,
		};
		expect(limitLine(fixture, clock)).toBe("Stopped trying after 6 tries");
	});

	it("gave up with attempts 2 gives Stopped trying after 1 try", () => {
		const fixture: ThreadLimit = {
			since: "2026-11-11T15:00:00.000Z",
			attempts: 2,
			autoResume: true,
			resetsAt: null,
			gaveUp: true,
		};
		expect(limitLine(fixture, clock)).toBe("Stopped trying after 1 try");
	});
});

describe("countdown", () => {
	it("countdown to 10 minutes and 5 seconds ahead gives 10:05", () => {
		expect(
			countdown("2026-11-11T12:10:05.000Z", Date.parse("2026-11-11T12:00:00.000Z")),
		).toBe("10:05");
	});

	it("one hour and 2 seconds ahead gives 1:00:02", () => {
		expect(
			countdown("2026-11-11T13:00:02.000Z", Date.parse("2026-11-11T12:00:00.000Z")),
		).toBe("1:00:02");
	});

	it("a past time gives null", () => {
		expect(
			countdown("2026-11-11T11:59:59.000Z", Date.parse("2026-11-11T12:00:00.000Z")),
		).toBeNull();
	});
});

describe("compactionLine", () => {
	it("started gives Compacting", () => {
		expect(compactionLine({ phase: "started" })).toBe("Compacting");
	});

	it("completed with before 142000 and after 18000 gives Compacted · 142k to 18k tokens", () => {
		expect(
			compactionLine({
				phase: "completed",
				before: 142_000,
				after: 18_000,
			}),
		).toBe("Compacted · 142k to 18k tokens");
	});

	it("completed without sizes gives Compacted", () => {
		expect(compactionLine({ phase: "completed" })).toBe("Compacted");
	});

	it("failed gives Compaction failed", () => {
		expect(compactionLine({ phase: "failed" })).toBe("Compaction failed");
	});
});
