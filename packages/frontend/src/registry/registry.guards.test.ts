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

describe("the registry kernel's guards", () => {
	it("passes every generic and per-kind guard over the committed manifest", () => {
		const manifest = JSON.parse(manifestText) as Manifest;
		const problems = formatProblems(
			runGuards(kinds, manifest, collect(kinds, entryModules)),
		);
		expect(problems).toEqual([]);
	});
});
