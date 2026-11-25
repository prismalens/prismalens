// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { defineKind } from "@prismalens/registry";
import { z } from "zod";
import { defineEntryPoint, FAMILIES } from "../descriptor.ts";
import { entryPointShape } from "./guards.ts";

const text = z.string().trim().min(1);

export const entryPoint = defineKind({
	name: "entryPoint",
	suffix: ".entry-points.ts",
	about:
		"A place a family's members are offered, such as Add project or Settings → Code hosts: its family, whether every member must offer it, and the screen that renders it.",
	keywords: ["entry point", "where offered", "screen", "list of providers"],
	schema: z.object({
		kind: z.literal("entryPoint"),
		id: z.string().regex(/^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/),
		family: z.enum(FAMILIES),
		required: z.boolean(),
		about: text,
		screen: text,
	}),
	refs: {},
	guards: [entryPointShape],
	define: defineEntryPoint,
	scaffold: {
		dir: "src",
		imports: ['import { defineEntryPoint } from "./descriptor.ts";'],
		entry: `export const {{name}} = defineEntryPoint({
	id: "{{id}}",
	family: "agent",
	required: true,
	about: "{{label}}",
	screen: "packages/frontend/src/components/TODO.tsx",
});`,
		test: false,
	},
});
