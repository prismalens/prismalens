// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { existsSync, readFileSync } from "node:fs";
import type { Manifest } from "@prismalens/registry";
import { describe, expect, it } from "vitest";
import { kinds } from "./kinds";
import manifestText from "./registry.manifest.json?raw";

const manifest = JSON.parse(manifestText) as Manifest;
const biome = JSON.parse(
	readFileSync(new URL("../../../../biome.json", import.meta.url), "utf8"),
) as { plugins: { path: string; includes?: string[] }[] };
const plugins = new URL("../../biome-plugins/registry/", import.meta.url);

/** What a kind needs before it counts as added: `pnpm new kind` writes all but the first entry. */
function gaps(name: string, suffix: string): string[] {
	const out: string[] = [];
	const k = manifest.kinds[name];
	if (!k) return [`${name}: no manifest section; run pnpm registry gen`];
	if (!(manifest.entries[name]?.length ?? 0))
		out.push(`${name}: no entry; add one with pnpm new ${name} <object>.<name>`);
	if (!k.keywords.length) out.push(`${name}: no keywords for pnpm registry where`);
	if (!k.scaffold) out.push(`${name}: no scaffold for pnpm new`);
	const l1 = biome.plugins.find((p) => p.path.endsWith(`/l1-${name}.grit`));
	if (!l1 || !existsSync(new URL(`l1-${name}.grit`, plugins)))
		out.push(`${name}: no L1 lint plugin in biome.json`);
	else if (!l1.includes?.includes(`!packages/frontend/src/**/*${suffix}`))
		out.push(`${name}: its L1 plugin does not exclude *${suffix}`);
	return out;
}

describe("the registry kernel's self-test", () => {
	it("gives every kind a manifest section, an entry, a where entry, a scaffold and an L1 placement", () => {
		expect(kinds.flatMap((k) => gaps(k.name, k.suffix))).toEqual([]);
	});

	it("lists every kind file's kind in the kinds list", () => {
		expect(Object.keys(manifest.kinds).sort()).toEqual(
			kinds.map((k) => k.name).sort(),
		);
	});
});
