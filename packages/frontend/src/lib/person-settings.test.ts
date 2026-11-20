// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { afterEach, describe, expect, it, vi } from "vitest";
import { writePersonSetting } from "./person-settings";

const calls: Array<{
	values: Record<string, string>;
	done: () => void;
}> = [];
vi.mock("@/lib/api/orpc-client", () => ({
	orpc: {
		settings: {
			person: {
				update: {
					call: (input: { values: Record<string, string> }) =>
						new Promise<void>((done) => {
							calls.push({ values: { ...input.values }, done });
						}),
				},
			},
		},
	},
}));

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("writePersonSetting", () => {
	afterEach(() => {
		calls.length = 0;
	});

	// A drag writes on every step; racing saves landed an older width last (#1154).
	it("keeps one save in flight and sends the latest set after it", async () => {
		writePersonSetting("pl.panelWidth", "400");
		writePersonSetting("pl.panelWidth", "420");
		writePersonSetting("pl.panelWidth", "440");
		expect(calls.map((c) => c.values["pl.panelWidth"])).toEqual(["400"]);
		calls[0]?.done();
		await flush();
		expect(calls.map((c) => c.values["pl.panelWidth"])).toEqual(["400", "440"]);
		calls[1]?.done();
		await flush();
		expect(calls).toHaveLength(2);
	});
});
