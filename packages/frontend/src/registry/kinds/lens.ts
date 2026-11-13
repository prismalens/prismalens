// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { defineKind } from "@prismalens/registry";
import { defineLens } from "../defines";
import { provenance } from "../guards";
import type { ConditionId } from "../registry.gen";
import type { Said } from "./condition";
import { dottedId, said, text, z } from "./schema";

/** A holistic review angle: it groups conditions or names a check, and gives reviewers its rubric. */
export interface LensSpec {
	/** `area.name`, e.g. `eng.security`. */
	id: string;
	group: "real-life" | "product" | "engineering";
	said: Said;
	conditions: readonly ConditionId[];
	/** A script that measures it, what it measures and the budget it stays within. */
	check?: { script: string; measure: string; budget: number | string };
	/** What a reviewer looks for through this lens. */
	rubric: string;
	status: "active" | "parked";
}

export type LensDef = LensSpec & { readonly kind: "lens" };

export const lens = defineKind({
	name: "lens",
	suffix: ".lenses.ts",
	about:
		"A holistic review angle (security, CI cost, test honesty, settings defaults): it groups conditions or names a check, and carries the reviewer's rubric. It has no pass/fail of its own.",
	keywords: [
		"lens",
		"review",
		"angle",
		"security",
		"cost",
		"rubric",
		"holistic",
		"audit",
		"quality",
	],
	schema: z.object({
		kind: z.literal("lens"),
		id: dottedId,
		group: z.enum(["real-life", "product", "engineering"]),
		said,
		conditions: z.array(text),
		check: z.optional(
			z.object({
				script: text,
				measure: text,
				budget: z.union([z.number(), text]),
			}),
		),
		rubric: text,
		status: z.enum(["active", "parked"]),
	}),
	refs: { conditions: "condition" },
	guards: [provenance],
	runtime: false,
	define: defineLens,
	scaffold: {
		dir: "src/registry/lenses",
		imports: ['import { define } from "@/registry/define";'],
		test: false,
		entry: `export const {{name}} = define.lens({
	id: "{{id}}",
	group: "engineering",
	said: { date: "{{date}}", quote: "{{said}}", where: "{{where}}" },
	conditions: [],
	rubric: "{{label}}: what a reviewer looks for.",
	status: "parked",
});`,
	},
});
