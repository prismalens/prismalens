#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Writes packages/@prismalens/config/src/acp-registry.json from the public ACP registry,
 * at release time only: the app never fetches it and installs nothing (#848, ADR 0003 §4).
 * Source: the agentclientprotocol/registry repository, served aggregated from REGISTRY_URL.
 *
 *   node scripts/acp-registry-snapshot.mjs [--from <registry.json>]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const REGISTRY_URL =
	"https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json";
const OUT = join(
	dirname(fileURLToPath(import.meta.url)),
	"..",
	"packages/@prismalens/config/src/acp-registry.json",
);

const quote = (arg) => (/^[\w@%+=:,./-]+$/.test(arg) ? arg : `'${arg}'`);
const command = (...parts) => parts.flat().filter(Boolean).map(quote).join(" ");

/** The lines a person copies to install one agent; a binary names its archive per platform. */
export function installOf(distribution = {}) {
	const lines = [];
	if (distribution.npx)
		lines.push(
			command(
				"npx",
				"-y",
				distribution.npx.package,
				distribution.npx.args ?? [],
			),
		);
	if (distribution.uvx)
		lines.push(
			command("uvx", distribution.uvx.package, distribution.uvx.args ?? []),
		);
	for (const [platform, b] of Object.entries(distribution.binary ?? {}))
		if (b?.archive) lines.push(`${platform}: ${b.archive}`);
	return lines;
}

/** `{ id, name, description, install }` per agent, by name. */
export function snapshotOf(registry) {
	if (!registry || !Array.isArray(registry.agents))
		throw new Error("the registry has no agents array");
	return registry.agents
		.filter((a) => typeof a.id === "string" && typeof a.name === "string")
		.map((a) => ({
			id: a.id,
			name: a.name,
			description: typeof a.description === "string" ? a.description : "",
			install: installOf(a.distribution),
		}))
		.filter((a) => a.install.length > 0)
		.sort(
			(x, y) => x.name.localeCompare(y.name, "en") || x.id.localeCompare(y.id),
		);
}

async function main() {
	const at = process.argv.indexOf("--from");
	const registry =
		at > 0
			? JSON.parse(readFileSync(process.argv[at + 1], "utf8"))
			: await fetch(REGISTRY_URL, { signal: AbortSignal.timeout(30_000) }).then(
					(r) => {
						if (!r.ok) throw new Error(`${REGISTRY_URL} answered ${r.status}`);
						return r.json();
					},
				);
	const entries = snapshotOf(registry);
	writeFileSync(OUT, `${JSON.stringify(entries, null, "\t")}\n`);
	console.log(
		`acp-registry.json: ${entries.length} agents from ${at > 0 ? process.argv[at + 1] : REGISTRY_URL}`,
	);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1])
	await main();
