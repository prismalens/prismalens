// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Anti-drift guard (ADR-0017 Amendment 2): the reported read-only fidelity MECHANISM
 * must be DERIVED from the same deny-list the claude-code runner enforces
 * (`HARNESS_REGISTRY["claude-code"].readOnlyDeny`, which `claude-code-runner.ts` spreads
 * into `disallowedTools`). One SSOT → honest fidelity can never claim a guarantee the
 * runner no longer delivers. Hermetic (no network/LLM).
 */
import {
	HARNESS_REGISTRY,
	resolvePermissionOutcome,
} from "@prismalens/config/harness";
import { describe, expect, it } from "vitest";

describe("read-only fidelity derives from the enforced deny-list (ADR-0017 Amdt 2)", () => {
	it("claude-code read-only mechanism lists EVERY tool in the registry deny-list", () => {
		const deny = HARNESS_REGISTRY["claude-code"].readOnlyDeny ?? [];
		expect(deny.length).toBeGreaterThan(0);
		const { fidelity, mechanism } = resolvePermissionOutcome(
			"claude-code",
			"read-only",
		);
		expect(fidelity).toBe("enforced");
		// The mechanism is generated from `deny`, so it cannot drift from what's enforced.
		for (const tool of deny) expect(mechanism).toContain(tool);
	});

	it("deepagents read-only is cooperative (no per-tool deny-list to derive from)", () => {
		expect(HARNESS_REGISTRY.deepagents.readOnlyDeny).toBeUndefined();
		expect(resolvePermissionOutcome("deepagents", "read-only").fidelity).toBe(
			"cooperative",
		);
	});

	it("auto/dangerous apply no floor → advisory", () => {
		expect(resolvePermissionOutcome("claude-code", "auto").fidelity).toBe(
			"advisory",
		);
		expect(resolvePermissionOutcome("claude-code", "dangerous").fidelity).toBe(
			"advisory",
		);
	});
});
