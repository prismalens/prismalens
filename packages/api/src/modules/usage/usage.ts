// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	TurnUsageSchema,
	type UsageBucket,
	type UsageDay,
	type UsageRange,
	type UsageTokens,
} from "@prismalens/contracts";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** How far back each range reaches, and the size of its chart's step. */
export const RANGE_SPAN: Record<
	UsageRange,
	{ ms: number; step: "hour" | "day" }
> = {
	"24h": { ms: DAY_MS, step: "hour" },
	"7d": { ms: 7 * DAY_MS, step: "day" },
	"30d": { ms: 30 * DAY_MS, step: "day" },
};

/** The bucket key of an instant: the UTC hour (`…T13:00:00.000Z`) or the UTC day (`YYYY-MM-DD`). */
export function bucketKey(at: Date, step: "hour" | "day"): string {
	if (step === "day") return at.toISOString().slice(0, 10);
	return new Date(Math.floor(at.getTime() / HOUR_MS) * HOUR_MS).toISOString();
}

/** Every bucket from `since` to `until`, oldest first, so the chart has no holes. */
export function bucketKeys(
	since: Date,
	until: Date,
	step: "hour" | "day",
): string[] {
	const size = step === "hour" ? HOUR_MS : DAY_MS;
	const keys: string[] = [];
	for (
		let t = Math.floor(since.getTime() / size) * size;
		t <= until.getTime();
		t += size
	)
		keys.push(bucketKey(new Date(t), step));
	return keys;
}

export const emptyBucket = (currency = "USD"): UsageBucket => ({
	turns: 0,
	tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	cost: { amount: null, currency, unpricedTurns: 0 },
});

/** One `turn_usage` event's payload, or null when it is not one or does not parse. */
export function readTurnUsage(event: string) {
	try {
		const raw = JSON.parse(event) as { kind?: unknown; usage?: unknown };
		if (raw.kind !== "turn_usage") return null;
		const parsed = TurnUsageSchema.safeParse(raw.usage);
		return parsed.success ? parsed.data : null;
	} catch {
		return null;
	}
}

/** Adds one turn to a bucket; the total is the agent's own when it gave one. */
export function addTurn(
	bucket: UsageBucket,
	usage: NonNullable<ReturnType<typeof readTurnUsage>>,
): void {
	const t: UsageTokens = bucket.tokens;
	const input = usage.inputTokens ?? 0;
	const output = usage.outputTokens ?? 0;
	const cacheRead = usage.cacheReadTokens ?? 0;
	const cacheWrite = usage.cacheWriteTokens ?? 0;
	t.input += input;
	t.output += output;
	t.cacheRead += cacheRead;
	t.cacheWrite += cacheWrite;
	t.total +=
		usage.totalTokens ??
		input + output + cacheRead + cacheWrite + (usage.thoughtTokens ?? 0);
	bucket.turns += 1;
	if (usage.cost && usage.cost.currency === bucket.cost.currency)
		bucket.cost.amount = (bucket.cost.amount ?? 0) + usage.cost.amount;
	else bucket.cost.unpricedTurns += 1;
}

export const dayOf = (bucket: UsageBucket, day: string): UsageDay => ({
	...bucket,
	day,
});
