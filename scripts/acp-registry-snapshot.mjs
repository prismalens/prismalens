#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Writes packages/@prismalens/config/src/acp-registry.json from the public ACP registry,
 * at release time only: the app never fetches it and installs nothing (#848, ADR 0003 §4).
 * Source: the agentclientprotocol/registry repository, served aggregated from REGISTRY_URL.
 *
 *   node scripts/acp-registry-snapshot.mjs [--from <registry.json> [--icons <dir of <id>.svg>]]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { makerLetters } from "../packages/@prismalens/config/src/providers/model-makers.ts";

export const REGISTRY_URL =
	"https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json";
const DECISIONS = join(
	dirname(fileURLToPath(import.meta.url)),
	"..",
	"packages/@prismalens/config/src/acp-mark-terms.json",
);
const MARKS_OUT = join(
	dirname(fileURLToPath(import.meta.url)),
	"..",
	"packages/@prismalens/config/src/acp-marks.json",
);
const OUT = join(
	dirname(fileURLToPath(import.meta.url)),
	"..",
	"packages/@prismalens/config/src/acp-registry.json",
);

// Registry text is untrusted: a part outside these charsets drops its line (#848).
const SAFE_ARG = /^[\w@%+=:,./-]+$/;
const SAFE_PACKAGE = /^[\w@%+=:,./][\w@%+=:,./-]*$/;
const SAFE_ARCHIVE = /^https:\/\/[\w.~%+:,=/-]+$/;
const SAFE_PLATFORM = /^[\w-]+$/;

const command = (tool, pkg, args) => {
	const parts = [...tool, pkg, ...args];
	return typeof pkg === "string" &&
		SAFE_PACKAGE.test(pkg) &&
		parts.every((p) => typeof p === "string" && SAFE_ARG.test(p))
		? parts.join(" ")
		: null;
};

/** The lines a person copies to install one agent; a binary names its archive per platform. */
export function installOf(distribution = {}) {
	const lines = [];
	const argsOf = (d) => (Array.isArray(d.args) ? d.args : []);
	for (const [tool, d] of [
		[["npx", "-y"], distribution.npx],
		[["uvx"], distribution.uvx],
	]) {
		const line = d && command(tool, d.package, argsOf(d));
		if (line) lines.push(line);
	}
	for (const [platform, b] of Object.entries(distribution.binary ?? {}))
		if (SAFE_PLATFORM.test(platform) && SAFE_ARCHIVE.test(b?.archive ?? ""))
			lines.push(`${platform}: ${b.archive}`);
	return lines;
}

/**
 * Each agent's mark: its registry icon only where `acp-mark-terms.json` records that the
 * owner's terms allow it (#1101), else its letters. Icons are drawn as a CSS mask, so
 * the SVG never runs and always takes the theme's colour.
 */
export function markOf(id, name, icons, decisions) {
	const d = decisions[id];
	const svg = icons[id];
	if (
		d?.use === "logo" &&
		typeof svg === "string" &&
		/^\s*(?:<\?xml[^>]*\?>\s*)?<svg[\s>]/.test(svg) &&
		svg.length < 16_384
	)
		return {
			icon: `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`,
			source: d.source,
			terms: d.terms,
		};
	return {
		letters: d?.letters ?? makerLetters(name),
		withheld: d?.line ?? "Its owner's terms are not read yet.",
		...(d?.terms ? { terms: d.terms } : {}),
	};
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
	const decisions = JSON.parse(readFileSync(DECISIONS, "utf8"));
	// Only the icons a decision allows are fetched.
	const iconsAt = process.argv.indexOf("--icons");
	const icons = {};
	for (const a of registry.agents ?? [])
		if (decisions[a.id]?.use === "logo")
			icons[a.id] =
				iconsAt > 0
					? readFileSync(join(process.argv[iconsAt + 1], `${a.id}.svg`), "utf8")
					: SAFE_ARCHIVE.test(a.icon ?? "")
						? await fetch(a.icon, { signal: AbortSignal.timeout(30_000) }).then(
								(r) => (r.ok ? r.text() : null),
							)
						: null;
	const entries = snapshotOf(registry);
	writeFileSync(OUT, `${JSON.stringify(entries, null, "\t")}\n`);
	// The marks sit apart from the entries so the app shell reads them without the registry's schema.
	const marks = Object.fromEntries(
		registry.agents
			.filter((a) => typeof a.id === "string" && typeof a.name === "string")
			.sort((x, y) => x.id.localeCompare(y.id))
			.map((a) => [a.id, markOf(a.id, a.name, icons, decisions)]),
	);
	const taken = new Map();
	for (const [id, m] of Object.entries(marks)) {
		if (!m.letters) continue;
		// Two agents on one tile can't be told apart: give one `letters` in acp-mark-terms.json.
		if (taken.has(m.letters))
			throw new Error(
				`${id} and ${taken.get(m.letters)} share the tile ${m.letters}`,
			);
		taken.set(m.letters, id);
	}
	writeFileSync(MARKS_OUT, `${JSON.stringify(marks, null, "\t")}\n`);
	console.log(
		`acp-registry.json: ${entries.length} agents from ${at > 0 ? process.argv[at + 1] : REGISTRY_URL}`,
	);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1])
	await main();
