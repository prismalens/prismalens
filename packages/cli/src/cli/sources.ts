// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/** `pl sources` and `pl sources test`: what the agent can reach, from the same view as the web page (#848). */
import {
	type ProbeReport,
	type SourcesOverview,
	sourceType,
} from "@prismalens/contracts/schemas";
import { defineCommand } from "citty";
import consola from "consola";
import { sourcesClient } from "./sources-client.js";
import { overviewTable, probeTable } from "./sources-format.js";

const fail = (e: unknown): never => {
	consola.error(e instanceof Error ? e.message : String(e));
	process.exit(1);
};

const test = defineCommand({
	meta: {
		name: "test",
		description: "Re-run the read-only probes for one source, or for every one",
	},
	args: {
		id: {
			type: "positional",
			required: false,
			description: "A source id from `pl sources --ids`",
		},
	},
	async run({ args }) {
		try {
			const client = await sourcesClient();
			const ids = args.id
				? [String(args.id)]
				: (await client.get<SourcesOverview>("/sources")).categories
						.flatMap((c) => c.sources)
						.filter((s) => sourceType(s.kind))
						.map((s) => s.id);
			let broken = false;
			for (const id of ids) {
				const report = await client.post<ProbeReport>(
					`/sources/${id}/test`,
					{},
				);
				consola.log(
					`\n${sourceType(report.type)?.vendor ?? report.type} ${id}`,
				);
				consola.log(probeTable(report));
				broken ||= !report.ok;
			}
			if (!ids.length)
				consola.info("Nothing to test. Connect one with `pl connect`.");
			if (broken) process.exit(1);
		} catch (e) {
			fail(e);
		}
	},
});

export default defineCommand({
	meta: {
		name: "sources",
		description:
			"List what investigations can read, per category; exits 1 when a connected source is unreachable",
	},
	args: {
		ids: { type: "boolean", description: "Print each source's id" },
	},
	subCommands: { test },
	async run({ args, rawArgs }) {
		if (rawArgs[0] === "test") return;
		try {
			const o = await (await sourcesClient()).get<SourcesOverview>("/sources");
			consola.log(overviewTable(o));
			if (args.ids)
				for (const s of o.categories.flatMap((c) => c.sources))
					consola.log(`${s.id}  ${s.label}`);
			if (o.categories.some((c) => c.status === "unreachable")) process.exit(1);
		} catch (e) {
			fail(e);
		}
	},
});
