// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Each agent's pin lives beside its descriptor in `providers/src/agent/<id>/pin.json`: the CLI
 * package, version and channel, the adapter it moves with, and a Python pin's extras and
 * constraints. Every script reads pins through here, so there is no second list.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const AGENTS_DIR = "packages/@prismalens/providers/src/agent";
/** Days a release soaks before its pin moves, unless its pin.json says otherwise. */
export const DEFAULT_RELEASE_AGE_DAYS = 3;

/** Every agent with a pin, in folder order: `{ agent, cli: { package, version, channel }, adapter?, with?, constraints?, minimumReleaseAgeDays }`. */
export function agentPins(root = ROOT) {
	const dir = join(root, AGENTS_DIR);
	return readdirSync(dir, { withFileTypes: true })
		.filter((e) => e.isDirectory() && existsSync(join(dir, e.name, "pin.json")))
		.map((e) => {
			const pin = JSON.parse(
				readFileSync(join(dir, e.name, "pin.json"), "utf8"),
			);
			return {
				agent: e.name,
				...pin,
				minimumReleaseAgeDays:
					pin.minimumReleaseAgeDays ?? DEFAULT_RELEASE_AGE_DAYS,
			};
		})
		.sort((a, b) => a.agent.localeCompare(b.agent));
}

/** The pin file of one agent, repo-relative. */
export const pinFile = (agent) => `${AGENTS_DIR}/${agent}/pin.json`;

/** `{ [cli package]: version }`, the shape the lock and probe scripts key on. */
export const readPins = (root = ROOT) =>
	Object.fromEntries(
		agentPins(root).map((p) => [p.cli.package, p.cli.version]),
	);

/** Python pins and the packages installed beside the CLI: `{ [cli package]: extras }`. */
export const pythonPins = (root = ROOT) =>
	Object.fromEntries(
		agentPins(root)
			.filter((p) => p.cli.channel === "pypi")
			.map((p) => [p.cli.package, p.with ?? []]),
	);

/** What a Python pin needs that its channel does not cap: `{ [cli package]: constraints }`. */
export const pythonConstraints = (root = ROOT) =>
	Object.fromEntries(
		agentPins(root)
			.filter((p) => p.constraints?.length)
			.map((p) => [p.cli.package, p.constraints]),
	);
