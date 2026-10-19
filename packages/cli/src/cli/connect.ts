// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * `pl connect <category> <vendor>`: the web connect flow without the browser
 * (#848). The same descriptor drives both: test and discover, print the
 * capability table, then save only when every required probe passed.
 */
import { readFileSync } from "node:fs";
import {
	type ProbeReport,
	SOURCE_TYPES,
	type SourcesOverview,
	sourceTypeBySlug,
} from "@prismalens/contracts/schemas";
import { defineCommand } from "citty";
import consola from "consola";
import { SourcesClientError, sourcesClient } from "./sources-client.js";
import {
	agentCanCall,
	draftFromArgs,
	probeTable,
	vendorList,
} from "./sources-format.js";

export default defineCommand({
	meta: {
		name: "connect",
		description: `Connect a data source the agent reads during investigations (${vendorList()})`,
	},
	args: {
		category: {
			type: "positional",
			description: "metrics, logs or scm",
			required: true,
		},
		vendor: {
			type: "positional",
			description: "The source type; may be left out when the category has one",
			required: false,
		},
		url: {
			type: "string",
			description: "The source's URL (default: the detected one)",
		},
		"auth-kind": {
			type: "string",
			description:
				"none, bearer, basic, header or mtls (default: inferred from the flags below)",
		},
		"token-env": {
			type: "string",
			description: "Env var holding a bearer token",
		},
		username: { type: "string", description: "Basic auth user" },
		"password-env": {
			type: "string",
			description: "Env var holding the basic auth password",
		},
		"header-name": { type: "string", description: "Custom header name" },
		"header-value-env": {
			type: "string",
			description: "Env var holding the header value",
		},
		cert: { type: "string", description: "mTLS client certificate file (PEM)" },
		key: { type: "string", description: "mTLS client key file (PEM)" },
		ca: { type: "string", description: "mTLS CA file (PEM)" },
		"service-label": {
			type: "string",
			description:
				"The label that names a service (default: the discovered one)",
		},
		label: { type: "string", description: "A name for this source" },
		"use-detected": {
			type: "boolean",
			description: "Use the token the instance found in its own environment",
		},
		"test-only": {
			type: "boolean",
			description: "Probe and print; save nothing",
		},
	},
	async run({ args }) {
		const inCategory = SOURCE_TYPES.filter((t) => t.category === args.category);
		const slug =
			args.vendor ??
			(inCategory.length === 1 ? inCategory[0]?.slug : undefined);
		const type = slug && sourceTypeBySlug(String(args.category), String(slug));
		if (!type) {
			consola.error(`Name a source to connect: ${vendorList()}`);
			process.exit(1);
		}
		try {
			const client = await sourcesClient();
			const overview = args.url
				? null
				: await client.get<SourcesOverview>("/sources");
			const detected = overview?.detected.find(
				(d) => d.type === type.id && !type.detect.tokenEnv,
			)?.url;
			const draft = draftFromArgs(
				type,
				{
					url: args.url,
					authKind: args["auth-kind"],
					tokenEnv: args["token-env"],
					username: args.username,
					passwordEnv: args["password-env"],
					headerName: args["header-name"],
					headerValueEnv: args["header-value-env"],
					cert: args.cert,
					key: args.key,
					ca: args.ca,
					serviceLabel: args["service-label"],
					label: args.label,
					useDetected: args["use-detected"],
				},
				process.env,
				(p) => readFileSync(p, "utf8"),
				detected,
			);
			if (detected && !args.url)
				consola.info(`Using the detected ${draft.url}`);
			const report = await client.post<ProbeReport>("/sources/test", draft);
			consola.log(probeTable(report));
			if (!report.ok) {
				consola.error("A required probe failed; nothing was saved.");
				process.exit(1);
			}
			if (args["test-only"]) return;
			const saved = await client.post<{ connectionId: string }>(
				"/sources/connect",
				{
					...draft,
					serviceLabel:
						draft.serviceLabel ?? report.discovered.serviceLabel ?? undefined,
				},
			);
			consola.success(`Connected ${type.vendor} (${saved.connectionId}).`);
			const can = agentCanCall(type);
			if (can) consola.log(can);
		} catch (e) {
			if (e instanceof SourcesClientError || e instanceof Error) {
				consola.error(e.message);
				process.exit(1);
			}
			throw e;
		}
	},
});
