// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { defineKind } from "@prismalens/registry";
import { z } from "zod";
import { defineProvider, FAMILIES } from "../descriptor.ts";
import {
	aliasesFree,
	entryPointsDeclared,
	idInFamily,
	orderUnique,
	secretsMarked,
} from "./guards.ts";

const text = z.string().trim().min(1);
const zod = z.custom<z.ZodType>((v) => v instanceof z.ZodType, "a zod schema");

export const provider = defineKind({
	name: "provider",
	suffix: ".provider.ts",
	about:
		"A provider: an agent, code host, telemetry source or alert intake. Its id, name, mark, order, auth, operations and the entry points that offer it, read by the API, the engine and the UI.",
	keywords: [
		"provider",
		"integration",
		"code host",
		"git host",
		"agent",
		"telemetry",
		"source",
		"alert intake",
		"connection",
	],
	schema: z.object({
		kind: z.literal("provider"),
		id: text,
		family: z.enum(FAMILIES),
		name: text,
		mark: z.union([
			z.object({ brand: text }).strict(),
			z.object({ letters: z.string().regex(/^[A-Z0-9]{1,3}$/) }).strict(),
		]),
		order: z.number().int().nonnegative(),
		entryPoints: z.array(text),
		stored: z.optional(
			z.array(
				z.object({
					column: text,
					value: text,
					where: z.optional(z.object({ field: text, value: text })),
				}),
			),
		),
		aliases: z.optional(z.array(text)),
		skips: z.optional(z.array(z.object({ case: text, reason: text }))),
		auth: z.optional(
			z.object({
				schemes: z.optional(
					z.array(
						z.object({
							id: text,
							label: text,
							apply: z.union([
								z.object({ bearer: text }).strict(),
								z
									.object({ basic: z.object({ user: text, password: text }) })
									.strict(),
								z
									.object({ header: z.object({ name: text, value: text }) })
									.strict(),
							]),
							fields: z.record(z.string(), zod),
							scopes: z.optional(z.array(z.object({ scope: text, why: text }))),
							git: z.optional(z.object({ user: text })),
							needsTarget: z.optional(z.boolean()),
						}),
					),
				),
				methods: z.optional(
					z.array(
						z.object({
							id: text,
							label: text,
							steps: z
								.array(
									z.enum(["browser", "deviceCode", "terminal", "credentials"]),
								)
								.min(1),
							unattended: z.boolean(),
						}),
					),
				),
			}),
		),
		operations: z.optional(
			z.record(z.string(), z.object({ about: text, input: z.optional(zod) })),
		),
		config: z.optional(zod),
	}),
	refs: { entryPoints: "entryPoint" },
	guards: [
		idInFamily,
		orderUnique,
		entryPointsDeclared,
		secretsMarked,
		aliasesFree,
	],
	define: defineProvider,
	index: "ProviderFamilies",
	scaffold: {
		dir: "src/{{object}}/{{member}}",
		file: "src/{{object}}/{{member}}/{{member}}.provider.ts",
		imports: ['import { defineProvider } from "../../descriptor.ts";'],
		entry: `export const {{Member}} = defineProvider({
	id: "{{id}}",
	family: "{{object}}",
	name: "{{Member}}",
	mark: { letters: "{{Member}}".slice(0, 2).toUpperCase() },
	order: 1000,
	entryPoints: {{required}},
});`,
		variants: {
			agent: {
				imports: ['import { defineAgent, noModeLines } from "../family.ts";'],
				entry: `export const {{memberName}} = defineAgent({
	id: "{{id}}",
	family: "agent",
	name: "{{Member}}",
	mark: { letters: "{{Member}}".slice(0, 2).toUpperCase() },
	order: 1000,
	launch: "{{member}}",
	entryPoints: {{required}},
	stored: [
		{ column: "Run.harness", value: "{{member}}" },
		{ column: "Schedule.harness", value: "{{member}}" },
	],
	auth: { methods: [] },
	facts: {
		install: "TODO: the command that installs its CLI",
		loginHint: "TODO: how to sign it in",
		cacheTtlMinutes: null,
		autoCompactPercent: null,
		compactsWhenIdle: false,
		compactCommand: null,
		compactTakesFocus: false,
		lines: noModeLines("{{Member}}"),
	},
});`,
				files: [
					{
						path: "../agent-host/src/registry/agents/{{member}}.ts",
						template: `import type { AgentDescriptor } from "../agents.js";
import { noMode } from "../row.js";

export const {{memberName}} = {
	id: "{{member}}",
	label: "{{Member}}",
	binary: "TODO: the ACP binary on PATH",
	acpArgs: () => [],
	acpEnv: () => ({}),
	providerKeys: [],
	levels: noMode(),
	modeNames: {},
	modeMechanism: "none",
	modelVia: "acp",
} satisfies AgentDescriptor;`,
					},
				],
				next: [
					'Add "{{member}}" to AGENT_IDS and {{memberName}} to AGENT_ROWS in packages/@prismalens/agent-host/src/registry/agents.ts; its registry test holds that list to the folder.',
				],
			},
		},
		files: [
			{
				path: "src/{{object}}/{{member}}/fixtures/ok.json",
				template: '{ "status": 200, "body": {} }',
			},
			{
				path: "src/{{object}}/{{member}}/fixtures/rejected.json",
				template: '{ "status": 401, "body": {} }',
			},
		],
	},
});
