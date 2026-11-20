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
import { checkModules, entryModules } from "./registry.gen";
import manifestText from "./registry.manifest.json?raw";

const manifest = JSON.parse(manifestText) as Manifest;

describe("the registry kernel's guards", () => {
	it("passes every generic and per-kind guard over the committed manifest", async () => {
		const checked = Object.fromEntries(
			await Promise.all(
				Object.entries(checkModules).map(
					async ([file, load]) => [file, await load()] as const,
				),
			),
		);
		const problems = formatProblems(
			runGuards(
				kinds,
				manifest,
				collect(kinds, { ...entryModules, ...checked }),
			),
		);
		expect(problems).toEqual([]);
	});
});
