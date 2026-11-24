// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import { parseProviderList } from "./harness-doctor.js";

describe("parseProviderList", () => {
	it("reads the provider names from an agent CLI's coloured auth list", () => {
		const out =
			"\u001b[0m\u001b[32mGoogle        OAuth                       stored\u001b[0m\r\nOllama Cloud  Ollama Cloud                stored\r\n";
		expect(parseProviderList(out)).toEqual(["Google", "Ollama Cloud"]);
	});

	it("reads none from a list with no providers in it", () => {
		expect(parseProviderList("┌  Credentials\n│\n└  0 credentials\n")).toEqual(
			[],
		);
	});
});
