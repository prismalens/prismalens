// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import { cn } from "./utils";

describe("cn", () => {
	it("keeps a custom size beside a colour", () => {
		expect(cn("text-body text-text-2")).toBe(
			"text-body text-text-2",
		);
		expect(cn("text-meta", "text-sev-critical")).toBe(
			"text-meta text-sev-critical",
		);
	});

	it("lets a later size replace an earlier one", () => {
		expect(cn("text-sm", "text-body")).toBe("text-body");
		expect(cn("text-body", "text-meta")).toBe("text-meta");
		expect(cn("text-title text-text-1", "text-heading")).toBe(
			"text-text-1 text-heading",
		);
	});
});
