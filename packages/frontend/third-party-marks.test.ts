// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { readNotice } from "./third-party-notices.ts";

describe("agent marks notices", () => {
	it("records the package every bundled mark comes from, with its licence", () => {
		const imports = readFileSync(
			resolve(__dirname, "src/components/agent/AgentMark.tsx"),
			"utf8",
		).match(/from "simple-icons"/);
		expect(imports).not.toBeNull();
		const notice = readNotice(resolve(__dirname, "node_modules/simple-icons"));
		expect(notice.name).toBe("simple-icons");
		expect(notice.license).toBe("CC0-1.0");
		expect(notice.text.length).toBeGreaterThan(0);
	});
});
