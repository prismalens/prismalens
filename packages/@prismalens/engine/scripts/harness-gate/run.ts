// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { assertLoopback } from "./env.js";
import { DRIVERS } from "./registry.js";
import { REQUIREMENTS } from "./requirements.js";
import { runScenarios } from "./scenarios.js";

const { values } = parseArgs({
	options: {
		driver: { type: "string" },
		isolate: { type: "boolean", default: false },
		runs: { type: "string", default: "3" },
		model: {
			type: "string",
			default: process.env.GATE_MODEL ?? "gemma4:31b-cloud",
		},
		"base-url": {
			type: "string",
			default: process.env.GATE_BASE_URL ?? "http://localhost:11434",
		},
		"keep-fixtures": { type: "boolean", default: false },
		timeout: { type: "string", default: "300" },
	},
});

const driver = values.driver ? DRIVERS[values.driver] : undefined;
if (!driver) {
	console.error(`--driver must be one of: ${Object.keys(DRIVERS).join(", ")}`);
	process.exit(2);
}
assertLoopback(values["base-url"]);

const opts = {
	model: values.model,
	baseUrl: values["base-url"],
	isolate: values.isolate,
	timeoutMs: Number(values.timeout) * 1000,
	keepFixtures: values["keep-fixtures"],
};
const runs = Number(values.runs);
const tally: Record<string, number> = {};
for (let i = 1; i <= runs; i++) {
	const rows = await runScenarios(driver, opts);
	for (const [id, pass] of Object.entries(rows))
		tally[id] = (tally[id] ?? 0) + (pass ? 1 : 0);
	console.log(
		`run ${i}/${runs}: ${Object.entries(rows)
			.map(([id, pass]) => `${id}=${pass ? "pass" : "FAIL"}`)
			.join(" ")}`,
	);
}

const result = {
	driver: driver.id,
	config: driver.config(opts),
	model: opts.model,
	endpoint: "loopback Ollama",
	versions: driver.versions(),
	date: new Date().toISOString().slice(0, 10),
	runs,
	rows: Object.fromEntries(
		REQUIREMENTS.map((r) => [
			r.id,
			{
				tier: r.tier,
				passed: r.id in tally ? `${tally[r.id]}/${runs}` : "not probed",
			},
		]),
	),
};
const file = join(
	import.meta.dirname,
	"results",
	`${driver.id}${values.isolate ? ".isolated" : ""}.json`,
);
writeFileSync(file, `${JSON.stringify(result, null, "\t")}\n`);
console.log(`wrote ${file}`);
// Harness children and SSE streams can hold the event loop open after the last run.
process.exit(0);
