// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	collect,
	formatProblems,
	type Manifest,
	runGuards,
} from "@prismalens/registry";
import { describe, expect, it } from "vitest";
import { kinds } from "./kinds";
import { entryModules } from "./registry.gen";
import manifestText from "./registry.manifest.json?raw";

const manifest = JSON.parse(manifestText) as Manifest;

/**
 * Inventory surfaces not registered yet (#1125). The list only shrinks:
 * registering one fails this test until it is removed here.
 */
const UNREACHED = ["browser.tab", "incident.row", "alert.row"] as const;

describe("the registry kernel's guards", () => {
	it("passes every generic and per-kind guard over the committed manifest", () => {
		const problems = formatProblems(
			runGuards(kinds, manifest, collect(kinds, entryModules)),
		);
		expect(problems).toEqual([]);
	});

	it("still lists only unregistered surfaces as unreached", () => {
		const registered = new Set(
			(manifest.entries.surface ?? []).map((s) => s.id),
		);
		expect(UNREACHED.filter((id) => registered.has(id))).toEqual([]);
	});
});
