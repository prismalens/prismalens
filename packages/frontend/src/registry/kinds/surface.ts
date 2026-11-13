// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { defineKind } from "@prismalens/registry";
import { defineSurface } from "@/components/kit/actions";
import { galleryStates, labelled, rendered } from "../guards";
import { plainId, states, text, z } from "./schema";

const menu = z.optional(z.array(z.string()));

export const surface = defineKind({
	name: "surface",
	suffix: ".surface.ts",
	about:
		"An object on screen with menus: right-click, its ⋯ and the palette list the actions it places. Rendered as <Surface id>.",
	schema: z.object({
		kind: z.literal("surface"),
		id: plainId,
		object: z.optional(text),
		label: text,
		menus: z.object({ context: menu, more: menu }),
		states,
		marks: z.array(z.string()),
	}),
	refs: { "menus.context": "action", "menus.more": "action" },
	guards: [labelled, galleryStates, rendered],
	define: defineSurface,
	aliases: ["defineSurface"],
	index: "SurfaceObjects",
	keywords: [
		"object",
		"row",
		"card",
		"header",
		"pane",
		"panel",
		"item",
		"screen",
		"thing",
		"menus",
		"list",
	],
	scaffold: {
		dir: "src/components/{{object}}",
		imports: ['import { define } from "@/registry/define";'],
		entry: `export const {{name}} = define.surface({
	id: "{{id}}",
	label: "{{label}} actions",
	menus: { more: [] },
	states: { default: "{{slug}}", phone: "{{slug}}" },
	marks: [],
});`,
		declare: {
			module: "@/components/kit/actions",
			interface: "SurfaceObjects",
			line: '"{{id}}": "{{object}}";',
		},
	},
	uses: { components: ["Surface", "SurfaceMore"], attribute: "data-surface" },
});
