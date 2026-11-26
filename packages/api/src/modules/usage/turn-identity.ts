// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	BUNDLED_MODEL_CATALOGUE,
	HARNESS_REGISTRY,
	type HarnessId,
	modelIdentity,
	modelMakerId,
} from "@prismalens/config/harness";
import {
	type ModelIdentity,
	ModelIdentitySchema,
	type TurnUsage,
} from "@prismalens/contracts";

/** What a thread's own events say before a turn: the session's agent and the selected model. */
export interface TurnContext {
	harness: string | null;
	model: string | null;
}

/** Moves the context past one stored event: a session opening or an accepted model switch. */
export function advanceContext(ctx: TurnContext, event: string): TurnContext {
	try {
		const e = JSON.parse(event) as Record<string, unknown>;
		if (e.kind === "session_opened")
			return {
				harness: typeof e.harness === "string" ? e.harness : ctx.harness,
				// `null` says no model is in effect; an absent key says nothing.
				model:
					typeof e.model === "string" || e.model === null ? e.model : ctx.model,
			};
		if (
			e.kind === "session_config" &&
			e.option === "model" &&
			e.accepted === true &&
			typeof e.value === "string"
		)
			return { ...ctx, model: e.value };
	} catch {
		// Not an event this reads.
	}
	return ctx;
}

/**
 * A turn's identity: the one it recorded, else read from evidence only (#1180, §5.3's
 * backfill). The run env is not known now, so a vendor's provider stays `unknown`.
 */
export function turnIdentity(
	usage: TurnUsage & { identity?: unknown },
	ctx: TurnContext,
	threadHarness: string | null,
): ModelIdentity {
	const stored = ModelIdentitySchema.safeParse(usage.identity);
	if (stored.success) return stored.data;
	const agent = ctx.harness
		? { value: ctx.harness, source: "reported" as const }
		: threadHarness
			? { value: threadHarness, source: "thread" as const }
			: { value: null, source: "unknown" as const };
	const model = usage.model
		? { value: usage.model, source: "reported" as const }
		: ctx.model
			? { value: ctx.model, source: "selected" as const }
			: { value: null, source: "unknown" as const };
	const facts = agent.value
		? (HARNESS_REGISTRY[agent.value as HarnessId] ?? null)
		: null;
	return modelIdentity(facts, {
		agent,
		model,
		env: null,
		maker:
			agent.value && model.value
				? modelMakerId(
						BUNDLED_MODEL_CATALOGUE,
						agent.value,
						model.value,
						facts?.vendor,
					)
				: null,
	});
}
