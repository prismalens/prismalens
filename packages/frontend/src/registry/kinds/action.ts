// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { defineKind } from "@prismalens/registry";
import { defineAction } from "@/components/kit/actions";
import { labelled, reachable } from "../guards";
import { dottedId, fn, icon, text, z } from "./schema";

export const action = defineKind({
	name: "action",
	suffix: ".actions.ts",
	about:
		"Something a user runs on an object: a menu row, a palette entry or a key. A surface places it by id.",
	schema: z.object({
		kind: z.literal("action"),
		id: dottedId,
		label: z.union([text, fn]),
		icon,
		destructive: z.optional(z.boolean()),
		when: z.optional(fn),
		disabled: z.optional(fn),
		checked: z.optional(fn),
		run: fn,
	}),
	refs: {},
	guards: [labelled, reachable],
	define: defineAction,
	aliases: ["defineAction"],
	index: "ActionObjects",
	keywords: [
		"menu",
		"right-click",
		"context",
		"palette",
		"command",
		"run",
		"button",
		"shortcut",
		"key",
		"do",
		"verb",
	],
	scaffold: {
		dir: "src/components/{{object}}",
		imports: [
			'import { CircleDashed } from "lucide-react";',
			'import { define } from "@/registry/define";',
		],
		entry: `export const {{name}} = define.action({
	id: "{{id}}",
	label: "{{label}}",
	icon: CircleDashed,
	run: () => undefined,
});`,
		object: {
			imports: [
				'import { defineObject, type Facts } from "@/components/kit/actions";',
			],
			entry: `/** What a {{object}}'s actions run with: replace with what they need. */
export interface {{Object}}Ctx {
	facts: Facts;
}

/** The {{object}} object: the context its actions run with. */
export const {{object}}Object = defineObject<{{Object}}Ctx>("{{object}}");`,
		},
	},
});
