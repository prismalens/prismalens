// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import { cn } from "./utils";

describe("cn", () => {
	it("keeps a custom size beside a colour", () => {
		expect(cn("text-record text-muted-foreground")).toBe(
			"text-record text-muted-foreground",
		);
		expect(cn("text-meta", "text-sev-critical")).toBe(
			"text-meta text-sev-critical",
		);
	});

	it("lets a later size replace an earlier one", () => {
		expect(cn("text-sm", "text-record")).toBe("text-record");
		expect(cn("text-record", "text-meta")).toBe("text-meta");
	});
});
