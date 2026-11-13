// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { defineKind, entry } from "@prismalens/registry";
import type { SurfaceId } from "@/components/kit/actions";
import type { CategoryId } from "../closed/category";
import type { SimulatorId } from "../closed/simulator";
import type { WalkId } from "../closed/walk";
import { matrix, provenance, simulated, staged, stamped } from "../guards";
import type { ConditionId } from "../registry.gen";
import { dottedId, said, text, ymd, z } from "./schema";

/** Who asked for an entry, when, and in what words. */
export interface Said {
	date: string;
	quote: string;
	where: string;
}

/** What passes: a metric under a ceiling, or a state a judge or a case checks. */
export type Measure =
	| { metric: string; max: number; unit?: string }
	| { state: string };

/** An atomic, simulated real-life state: one simulator induces it, one measure judges it, per surface. */
export interface ConditionSpec {
	/** `area.name`, e.g. `net.slow-link`. */
	id: string;
	group: "real-life" | "product" | "engineering";
	said: Said;
	/** The walks it runs in (their surfaces follow) and the categories it scores. */
	appliesTo: {
		walks: "all" | readonly WalkId[];
		categories: "all" | readonly CategoryId[];
	};
	simulator: SimulatorId;
	/** What the simulator applies, e.g. `{ rttMs: 400 }`; a stamp carries it unchanged. */
	profile: Readonly<Record<string, unknown>>;
	measure: readonly Measure[];
	verdict: "check" | "judged" | "both";
	/** The CI case that covers it, or debt while the climb lasts. */
	ci: { debt: "climb" } | { case: string };
	status: "active" | "parked";
	/**
	 * Puts the app into the condition before judging starts; `pnpm judge-env up` runs it.
	 * `run` may use {url}; `live` says where a judge finds it. Required while active (G6).
	 */
	stage?: { run: string; live: string };
	/** A condition that happens during a walk (a drop, a clock skip): the env fires it, never a judge. */
	trigger?: { run: string; on: "schedule" | "button"; atS?: number | "mid" };
	pairsWith?: readonly ConditionId[];
	/** A surface it skips for now, with why and until when. */
	waivers?: readonly { surface: SurfaceId; reason: string; until: string }[];
}

export type ConditionDef = ConditionSpec & { readonly kind: "condition" };

export function defineCondition(spec: ConditionSpec): ConditionDef {
	return entry("condition", spec);
}

export const condition = defineKind({
	name: "condition",
	suffix: ".conditions.ts",
	about:
		"A simulated real-life state (a slow link, a usage limit, a huge diff): one simulator induces it, one measure judges it, and every surface its walks visit needs a case.",
	keywords: [
		"condition",
		"simulate",
		"simulated",
		"network",
		"slow",
		"limit",
		"failure",
		"real-life",
		"requirement",
		"judge",
	],
	schema: z.object({
		kind: z.literal("condition"),
		id: dottedId,
		group: z.enum(["real-life", "product", "engineering"]),
		said,
		appliesTo: z.object({
			walks: z.union([z.literal("all"), z.array(text)]),
			categories: z.union([z.literal("all"), z.array(text)]),
		}),
		simulator: text,
		profile: z.record(z.string(), z.unknown()),
		measure: z.array(
			z.union([
				z.object({ metric: text, max: z.number(), unit: z.optional(text) }),
				z.object({ state: text }),
			]),
		),
		verdict: z.enum(["check", "judged", "both"]),
		ci: z.union([
			z.object({ debt: z.literal("climb") }),
			z.object({ case: text }),
		]),
		status: z.enum(["active", "parked"]),
		stage: z.optional(z.object({ run: text, live: text })),
		trigger: z.optional(
			z.object({
				run: text,
				on: z.enum(["schedule", "button"]),
				atS: z.optional(z.union([z.number(), z.literal("mid")])),
			}),
		),
		pairsWith: z.optional(z.array(text)),
		waivers: z.optional(
			z.array(z.object({ surface: text, reason: text, until: ymd })),
		),
	}),
	refs: {
		simulator: "simulator",
		"appliesTo.walks": "walk",
		"appliesTo.categories": "category",
		pairsWith: "condition",
	},
	guards: [provenance, matrix, simulated, stamped, staged],
	define: defineCondition,
	scaffold: {
		dir: "src/registry/conditions",
		imports: ['import { define } from "@/registry/define";'],
		test: false,
		entry: `export const {{name}} = define.condition({
	id: "{{id}}",
	group: "real-life",
	said: { date: "{{date}}", quote: "{{said}}", where: "{{where}}" },
	appliesTo: { walks: "all", categories: [] },
	simulator: "unbuilt",
	profile: {},
	measure: [],
	verdict: "judged",
	ci: { debt: "climb" },
	status: "parked",
});`,
	},
});
