#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Moves each agent's `tested` in its pin.json to the pins CI installs, for the pin-bump PR
 * (#914), so `harness-pins.test.ts` holds once the bump's CI is green. A moved pin says no
 * real-model run backs it yet; the PR's recording checkbox is that run.
 *
 *   agent-tested.mjs [--date YYYY-MM-DD]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { agentPins, pinFile, ROOT } from "./agent-pins.mjs";

/** The tested pair a pin's CI proves: the adapter with its CLI as companion, or the CLI alone. */
export const wanted = (pin) =>
	pin.adapter
		? { version: pin.adapter.version, companion: pin.cli.version }
		: { version: pin.cli.version };

/**
 * The pin with `tested` on its wanted versions, or null when it already is or never had one.
 * A Python pin's `tested` is recorded by hand: its CLI reports no version in initialize (#634).
 */
export function retest(pin, date) {
	if (!pin.tested || pin.cli.channel !== "npm") return null;
	const want = wanted(pin);
	if (
		pin.tested.version === want.version &&
		pin.tested.companion === want.companion
	)
		return null;
	return { ...pin, tested: { ...want, date } };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
	const { values } = parseArgs({ options: { date: { type: "string" } } });
	const date = values.date ?? new Date().toISOString().slice(0, 10);
	const moved = [];
	for (const { agent } of agentPins()) {
		const file = join(ROOT, pinFile(agent));
		const next = retest(JSON.parse(readFileSync(file, "utf8")), date);
		if (!next) continue;
		writeFileSync(file, `${JSON.stringify(next, null, "\t")}\n`);
		moved.push(agent);
	}
	console.log(
		moved.length
			? `tested moved on ${moved.join(", ")}`
			: "every tested pin already follows its pins",
	);
}
