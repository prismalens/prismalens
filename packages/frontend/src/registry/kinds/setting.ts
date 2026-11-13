// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { defineKind } from "@prismalens/registry";
import type { SurfaceId } from "@/components/kit/actions";
import type { SettingsTab } from "@/components/settings/SettingsFrame";
import { defineSetting } from "../defines";
import { drawnOnItsPage, labelled } from "../guards";
import { dottedId, text, z } from "./schema";

/** One setting a person can find and change: where it lives, what it does, what it shapes. */
export interface SettingSpec {
	/** `page.name`, e.g. `models.newThread`. */
	id: string;
	page: SettingsTab;
	/** The row's or group's test id, which is also its anchor; absent opens the page's top. */
	anchor?: string;
	/** The row's name, as search lists it. */
	label: string;
	/** One plain sentence on what it does. */
	sentence: string;
	/** Other words a person might type for it. */
	also?: string;
	/** The stored settings key it reads and writes, when it has one. */
	key?: string;
	/** The surfaces whose look or behaviour it changes. */
	surfaces?: readonly SurfaceId[];
}

export type SettingDef = SettingSpec & { readonly kind: "setting" };

export const setting = defineKind({
	name: "setting",
	suffix: ".settings.ts",
	about:
		"A setting: its page and anchor, its name and sentence for search, its stored key, and the surfaces it shapes.",
	schema: z.object({
		kind: z.literal("setting"),
		id: dottedId,
		page: text,
		anchor: z.optional(text),
		label: text,
		sentence: text,
		also: z.optional(text),
		key: z.optional(text),
		surfaces: z.optional(z.array(z.string())),
	}),
	refs: { surfaces: "surface" },
	guards: [labelled, drawnOnItsPage],
	uses: { calls: ["settingOf"] },
	define: defineSetting,
	keywords: [
		"setting",
		"preference",
		"option",
		"toggle",
		"configure",
		"default",
		"choice",
		"set",
	],
	scaffold: {
		dir: "src/components/settings",
		imports: ['import { define } from "@/registry/define";'],
		entry: `export const {{name}} = define.setting({
	id: "{{id}}",
	page: "{{object}}",
	label: "{{label}}",
	sentence: "{{label}}: one plain sentence on what it does.",
});`,
	},
});
