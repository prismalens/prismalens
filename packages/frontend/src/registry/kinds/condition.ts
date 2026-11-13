// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { defineKind } from "@prismalens/registry";
import type { SurfaceId } from "@/components/kit/actions";
import type { CategoryId } from "../closed/category";
import type { SimulatorId } from "../closed/simulator";
import type { WalkId } from "../closed/walk";
import { defineCondition } from "../defines";
import { matrix, provenance, simulated, staged, stamped } from "../guards";
import type { ConditionId } from "../registry.gen";
import { dottedId, said, text, ymd, z } from "./schema";

/** Who asked for an entry, when, and in what words. */
export interface Said {
	date: string;
	quote: string;
	where: string;
}

/** A page whose ceiling differs from the metric's, with who set it and when. */
export interface PageCeiling {
	page: string;
	max: number;
	said: Said;
}

/** What passes: a metric under a ceiling (per page where one is set), or a state a person or a case checks. */
export type Measure =
	| {
			metric: string;
			max: number;
			unit?: string;
			pages?: readonly PageCeiling[];
	  }
	| { state: string };

/** An atomic, simulated real-life state: one simulator induces it, one measure says whether it holds, per surface. */
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
	verdict: "check" | "reviewed" | "both";
	/** The CI case that covers it, or debt while the climb lasts. */
	ci: { debt: "climb" } | { case: string };
	status: "active" | "parked";
	/**
	 * Puts the app into the condition when `pnpm sim` starts it. `run` may use {url};
	 * `live` says where a person finds it. Required while active (G6).
	 */
	stage?: { run: string; live: string };
	/** A condition that happens during a walk (a drop, a clock skip): `pnpm sim` fires it, never a person. */
	trigger?: { run: string; on: "schedule" | "button"; atS?: number | "mid" };
	/**
	 * Measures the staged condition and writes its stamp; `pnpm sim up --measure` runs it after
	 * every stage. It may use {url}, {slowUrl} and {thread} (the first thread a stage printed).
	 */
	probe?: { run: string };
	pairsWith?: readonly ConditionId[];
	/** A surface it skips for now, with why and until when. */
	waivers?: readonly { surface: SurfaceId; reason: string; until: string }[];
}

export type ConditionDef = ConditionSpec & { readonly kind: "condition" };

export const condition = defineKind({
	name: "condition",
	suffix: ".conditions.ts",
	about:
		"A simulated real-life state (a slow link, a usage limit, a huge diff): one simulator induces it, a stage puts the app into it, one measure says whether it holds, and every surface its walks visit needs a case.",
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
		"sim",
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
				z.object({
					metric: text,
					max: z.number(),
					unit: z.optional(text),
					pages: z.optional(
						z.array(z.object({ page: text, max: z.number(), said })),
					),
				}),
				z.object({ state: text }),
			]),
		),
		verdict: z.enum(["check", "reviewed", "both"]),
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
		probe: z.optional(z.object({ run: text })),
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
	runtime: false,
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
	verdict: "reviewed",
	ci: { debt: "climb" },
	status: "parked",
});`,
	},
});
