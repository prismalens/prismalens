// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { HARNESS_REGISTRY, type HarnessId } from "@prismalens/config/harness";
import { LIMIT_WINDOWS } from "@prismalens/contracts";
import { type LimitRead, readAgentLimits } from "@prismalens/engine";
import { z } from "zod";
import type { HarnessService } from "../../core/harness/harness.service.js";
import type { HarnessModelsService } from "../../core/harness/harness-models.service.js";
import type { PrismaService } from "../../core/prisma/prisma.service.js";

export const LIMIT_READS_KEY = "AGENT_LIMIT_READS";
/** A panel that opens finds the newest read older than this and starts one (#1180). */
export const LIMIT_READ_FRESH_MS = 5 * 60 * 1000;

const LimitReadSchema = z.object({
	account: z.string().nullable(),
	at: z.string().datetime(),
	windows: z.array(
		z.object({
			key: z.string(),
			window: z.enum(LIMIT_WINDOWS).nullable(),
			type: z.string().nullable(),
			usedPercent: z.number().min(0).max(100).nullable(),
			resetsAt: z.string().datetime().nullable(),
			status: z.string().nullable(),
		}),
	),
});

/** The Setting row: per agent, the last read that answered and the last try, either way. */
const LimitReadsSchema = z.record(
	z.string(),
	z.object({
		account: z.string().nullable(),
		/** The HARNESS_CHECKS runtime key the kept read ran under. */
		runtime: z.string(),
		ok: LimitReadSchema.nullable(),
		tried: z.object({
			at: z.string().datetime(),
			outcome: z.enum(["ok", "failed"]),
		}),
	}),
);
export type LimitReads = z.infer<typeof LimitReadsSchema>;
export type LimitReadEntry = LimitReads[string];

/** What a read needs from the agent's Settings, and how its account and runtime are known now. */
export interface LimitSource {
	/** Its spawn inputs and the runtime key they make; null when it has none. */
	inputs(agent: HarnessId): Promise<{
		runtime: Parameters<typeof readAgentLimits>[1];
		key: string;
	} | null>;
	/** The runtime key a check or read of `agent` would run under now; null when not known. */
	currentKey(agent: HarnessId): string | null;
	/** The account the last check found, keyed like a read's: its email, else its label. */
	checkedAccount(
		agent: HarnessId,
	): { account: string | null; at: string } | null;
	read(
		agent: HarnessId,
		runtime: Parameters<typeof readAgentLimits>[1],
	): Promise<LimitRead | null>;
}

export const LIMIT_SOURCE = Symbol("LIMIT_SOURCE");

/** The source a running host uses: the agent's runtime from Settings and its last check. */
export function harnessLimitSource(
	harness: Pick<HarnessService, "runtimeFor">,
	models: Pick<HarnessModelsService, "snapshot" | "checked">,
	read: LimitSource["read"] = (agent, runtime) =>
		readAgentLimits(agent, runtime),
): LimitSource {
	const currentKey = (agent: HarnessId) =>
		models.snapshot().agents[agent]?.runtime ?? null;
	return {
		async inputs(agent) {
			const r = await harness.runtimeFor(agent);
			return {
				runtime: {
					env: r.env,
					...(r.policy ? { policy: r.policy } : {}),
					...(r.binaryPath ? { binaryPath: r.binaryPath } : {}),
				},
				key: currentKey(agent) ?? "",
			};
		},
		currentKey,
		checkedAccount(agent) {
			const c = models.checked(agent);
			if (!c) return null;
			return {
				account: c.account ? (c.account.email ?? c.account.label) : null,
				at: c.at,
			};
		},
		read,
	};
}

export async function readLimitReads(
	prisma: Pick<PrismaService, "setting">,
): Promise<LimitReads> {
	const row = await prisma.setting.findUnique({
		where: { key: LIMIT_READS_KEY },
	});
	try {
		const parsed = LimitReadsSchema.safeParse(JSON.parse(row?.value ?? ""));
		return parsed.success ? parsed.data : {};
	} catch {
		return {};
	}
}

/** Records one try: an answer replaces the kept read; a failure keeps it and moves `tried`. */
export async function recordLimitRead(
	prisma: Pick<PrismaService, "setting">,
	agent: HarnessId,
	runtime: string,
	read: LimitRead | null,
	at: string,
): Promise<LimitReadEntry> {
	const all = await readLimitReads(prisma);
	const prev = all[agent];
	const entry: LimitReadEntry = read
		? {
				account: read.account,
				runtime,
				ok: read,
				tried: { at, outcome: "ok" },
			}
		: {
				account: prev?.account ?? null,
				runtime: prev?.runtime ?? runtime,
				ok: prev?.ok ?? null,
				tried: { at, outcome: "failed" },
			};
	all[agent] = entry;
	const value = JSON.stringify(all);
	await prisma.setting.upsert({
		where: { key: LIMIT_READS_KEY },
		create: { key: LIMIT_READS_KEY, value, type: "json", category: "usage" },
		update: { value },
	});
	return entry;
}

/** Whether `agent` has a read before any run at all. */
export const readsBeforeRun = (agent: string): boolean =>
	!!HARNESS_REGISTRY[agent as HarnessId]?.limitsBeforeRun;
