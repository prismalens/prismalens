// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import { prefilter } from "./thread-search.service.js";

describe("thread-window prefilter", () => {
	it('Case-sensitive "pool" gives SQL containing instr(event, and values ["pool"]', () => {
		const res = prefilter("pool", true);
		expect(res).not.toBeNull();
		expect(res!.sql).toContain("instr(event,");
		expect(res!.values).toEqual(["pool"]);
	});

	it('Case-blind "Pool" gives lower(event) and the value "pool"', () => {
		const res = prefilter("Pool", false);
		expect(res).not.toBeNull();
		expect(res!.sql).toContain("lower(event)");
		expect(res!.values).toContain("pool");
	});

	it('Case-blind "kick" also holds the K (U+212A) alternative, and "pin" holds the İ (U+0130) one', () => {
		const kickRes = prefilter("kick", false);
		expect(kickRes).not.toBeNull();
		expect(kickRes!.values).toContain("kick");
		expect(kickRes!.values).toContain("K");
		expect(kickRes!.sql).toContain("instr(event,");

		const pinRes = prefilter("pin", false);
		expect(pinRes).not.toBeNull();
		expect(pinRes!.values).toContain("pin");
		expect(pinRes!.values).toContain("İ");
		expect(pinRes!.sql).toContain("instr(event,");
	});

	it('A query holding ", \\ or a newline gives null. A case-blind non-ASCII query gives null', () => {
		expect(prefilter('quote"word', true)).toBeNull();
		expect(prefilter("back\\slash", true)).toBeNull();
		expect(prefilter("new\nline", true)).toBeNull();
		expect(prefilter("ümlaut", false)).toBeNull();
	});
});
