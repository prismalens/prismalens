// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	type ModelIdentity,
	type ModelPrice,
	type ModelPrices,
	ModelPricesSchema,
	type TurnUsage,
} from "@prismalens/contracts";
import type { PrismaService } from "../../core/prisma/prisma.service.js";

const KEY = "USAGE_PRICES";

/** Settings → Usage → Prices: the stored list, or none when the row is missing or unreadable. */
export async function readPrices(
	prisma: Pick<PrismaService, "setting">,
): Promise<ModelPrices> {
	const row = await prisma.setting.findUnique({ where: { key: KEY } });
	try {
		const parsed = ModelPricesSchema.safeParse(JSON.parse(row?.value ?? ""));
		return parsed.success ? parsed.data : { prices: [] };
	} catch {
		return { prices: [] };
	}
}

/** Replaces the list; a second price for the same agent, provider and model keeps the last. */
export async function writePrices(
	prisma: Pick<PrismaService, "setting">,
	next: ModelPrices,
): Promise<ModelPrices> {
	const byKey = new Map<string, ModelPrice>();
	for (const p of ModelPricesSchema.parse(next).prices)
		byKey.set(JSON.stringify([p.agent, p.provider, p.model]), p);
	const value = JSON.stringify({ prices: [...byKey.values()] });
	await prisma.setting.upsert({
		where: { key: KEY },
		create: { key: KEY, value, type: "json", category: "usage" },
		update: { value },
	});
	return readPrices(prisma);
}

type Turn = Pick<ModelIdentity, "agent" | "provider" | "model">;

/**
 * The one price-match rule (#1180), for estimates and the per-model rows alike: agent and
 * model equal the price's, the model `reported` or `selected`. A provider-specific price
 * needs that provider `reported` or `inferred` and beats an `Any route` (provider null) one.
 */
export function matchPrice(
	prices: readonly ModelPrice[],
	turn: Turn,
): ModelPrice | null {
	const agent = turn.agent.value;
	const model = turn.model.value;
	if (!agent || !model || model === "mixed") return null;
	if (turn.model.source !== "reported" && turn.model.source !== "selected")
		return null;
	const same = prices.filter((p) => p.agent === agent && p.model === model);
	const provider =
		turn.provider.source === "reported" || turn.provider.source === "inferred"
			? turn.provider.value
			: null;
	return (
		(provider && same.find((p) => p.provider === provider)) ||
		same.find((p) => p.provider === null) ||
		null
	);
}

/** Tokens x price / 1e6; cache tokens without their own price go at the input price, thoughts at output. */
export function estimateCost(usage: TurnUsage, price: ModelPrice): number {
	const m = price.perMillion;
	return (
		((usage.inputTokens ?? 0) * m.input +
			((usage.outputTokens ?? 0) + (usage.thoughtTokens ?? 0)) * m.output +
			(usage.cacheReadTokens ?? 0) * (m.cacheRead ?? m.input) +
			(usage.cacheWriteTokens ?? 0) * (m.cacheWrite ?? m.input)) /
		1e6
	);
}
