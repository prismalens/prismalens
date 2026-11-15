#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Rebuilds the bundled model catalogue from the models.dev snapshot, nightly in
 * `agent-release-watch.yml` and in the pin-bump PR: each harness's models (from the providers its registry entry names), each
 * model's maker (`model-makers.json`, with every provider's name). The app never fetches models.dev (#1101).
 *
 *   sync-models.mjs [--from api.json] [--date YYYY-MM-DD]
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { makerLetters } from "../packages/@prismalens/config/src/providers/model-makers.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIR = join(ROOT, "packages/@prismalens/config/src/providers");
export const SOURCE = "https://models.dev/api.json";
/** Older models drop out of the fallback list; an agent's own list still shows them. */
const WINDOW_DAYS = 548;

const usable = (m) =>
	m.tool_call === true &&
	(m.modalities?.input ?? ["text"]).includes("text") &&
	(m.modalities?.output ?? ["text"]).includes("text");

export function build(api, sources, date) {
	const cutoff = Date.parse(date) - WINDOW_DAYS * 86_400_000;
	const makers = {};
	const maker = (id) => {
		const name = api[id]?.name ?? id;
		makers[id] ??= { name, letters: makerLetters(name) };
		return id;
	};
	const harnesses = {};
	for (const [harness, src] of Object.entries(sources)) {
		const models = [];
		for (const provider of src.providers) {
			for (const m of Object.values(api[provider]?.models ?? {})) {
				if (!usable(m)) continue;
				if (Date.parse(m.release_date ?? date) < cutoff) continue;
				const free = m.cost?.input === 0 && m.cost?.output === 0;
				models.push({
					id: src.prefixed ? `${provider}/${m.id}` : m.id,
					name: m.name,
					status:
						m.status === "deprecated"
							? "legacy"
							: src.freeIsTraining && free
								? "training"
								: "current",
					maker: maker(m.canonical_model_id?.split("/")[0] ?? provider),
				});
			}
		}
		models.sort((a, b) => a.id.localeCompare(b.id));
		harnesses[harness] = { models };
	}
	const providers = Object.fromEntries(
		Object.keys(api)
			.sort()
			.map((id) => [id, { name: api[id].name }]),
	);
	const updatedAt = `${date}T00:00:00Z`;
	return {
		catalogue: { version: 1, updatedAt, source: SOURCE, harnesses },
		makers: {
			updatedAt,
			source: SOURCE,
			makers: Object.fromEntries(Object.entries(makers).sort()),
			providers,
		},
	};
}

const same = (a, b) =>
	JSON.stringify({ ...a, updatedAt: 0 }) ===
	JSON.stringify({ ...b, updatedAt: 0 });

async function main() {
	const { values } = parseArgs({
		options: { from: { type: "string" }, date: { type: "string" } },
	});
	const api = values.from
		? JSON.parse(readFileSync(values.from, "utf8"))
		: await (await fetch(SOURCE)).json();
	const date = values.date ?? new Date().toISOString().slice(0, 10);
	const sources = JSON.parse(
		readFileSync(join(DIR, "catalogue-sources.json"), "utf8"),
	);
	const out = build(api, sources, date);
	for (const [file, data] of [
		["model-catalogue.json", out.catalogue],
		["model-makers.json", out.makers],
	]) {
		const path = join(DIR, file);
		const before = existsSync(path)
			? JSON.parse(readFileSync(path, "utf8"))
			: null;
		// An unchanged snapshot keeps its date, so the nightly opens no empty PR.
		if (before && same(before, data)) data.updatedAt = before.updatedAt;
		writeFileSync(path, `${JSON.stringify(data, null, "\t")}\n`);
	}
	const counts = Object.entries(out.catalogue.harnesses)
		.map(([h, v]) => `${h} ${v.models.length}`)
		.join(", ");
	console.log(`model-catalogue.json from ${SOURCE} on ${date}: ${counts}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
