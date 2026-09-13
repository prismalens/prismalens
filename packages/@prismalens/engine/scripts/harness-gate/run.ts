// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { DRIVERS } from "./drivers.js";
import { makeFixture } from "./fixture.js";
import { REQUIREMENTS } from "./requirements.js";
import { judge } from "./verdict.js";

const { values } = parseArgs({
	options: {
		driver: { type: "string" },
		isolate: { type: "boolean", default: false },
		runs: { type: "string", default: "3" },
		model: {
			type: "string",
			default: process.env.GATE_MODEL ?? "gpt-oss:120b-cloud",
		},
		"base-url": {
			type: "string",
			default: process.env.GATE_BASE_URL ?? "http://localhost:11434",
		},
		"keep-fixtures": { type: "boolean", default: false },
	},
});

const driver = values.driver ? DRIVERS[values.driver] : undefined;
if (!driver) {
	console.error(`--driver must be one of: ${Object.keys(DRIVERS).join(", ")}`);
	process.exit(2);
}

const opts = {
	model: values.model,
	baseUrl: values["base-url"],
	isolate: values.isolate,
	timeoutMs: 300_000,
};
const runs = Number(values.runs);
const tally: Record<string, number> = {};
for (let i = 1; i <= runs; i++) {
	const fx = makeFixture();
	const rows = judge(await driver.run(fx, opts), fx);
	for (const [id, pass] of Object.entries(rows))
		tally[id] = (tally[id] ?? 0) + (pass ? 1 : 0);
	console.log(
		`run ${i}/${runs}: ${Object.entries(rows)
			.map(([id, pass]) => `${id}=${pass ? "pass" : "FAIL"}`)
			.join(" ")}`,
	);
	if (!values["keep-fixtures"])
		rmSync(fx.root, {
			recursive: true,
			force: true,
			maxRetries: 5,
			retryDelay: 200,
		});
}

const result = {
	driver: driver.id,
	config: driver.config(opts),
	model: opts.model,
	endpoint: opts.baseUrl.includes("localhost")
		? "local Anthropic-compatible (Ollama)"
		: "remote",
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
