// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import { entryOf as entry } from "@/components/kit/registry";
import { GITLESS_WHY, NO_PROJECT_WHY } from "@/components/shell/app.actions";

const rowFor = (
	is: { noProject?: boolean; gitless?: boolean; sending?: boolean } = {},
) => {
	const e = entry("app.sendTestAlert", {
		facts: { is: { sendTestAlert: true, ...is } },
	});
	if (!e || "separator" in e) throw new Error("expected an action row");
	return e;
};

describe("app.sendTestAlert", () => {
	it("is disabled with the reason when the workspace has no project", () => {
		const row = rowFor({ noProject: true });

		expect(row.disabled).toBe(true);
		expect(row.why).toBe(NO_PROJECT_WHY);
	});

	it("is disabled with the reason when the project is a folder with no git", () => {
		const row = rowFor({ gitless: true });

		expect(row.disabled).toBe(true);
		expect(row.why).toBe(GITLESS_WHY);
	});

	it("is disabled without a reason while a test alert is being sent", () => {
		const row = rowFor({ sending: true });

		expect(row.disabled).toBe(true);
		expect(row.why).toBeUndefined();
	});

	it("is enabled and named when nothing blocks it", () => {
		const row = rowFor();

		expect(row.disabled).toBe(false);
		expect(row.label).toBe("Send a test alert");
	});

	it("is not listed where no Send a test alert is mounted", () => {
		expect(entry("app.sendTestAlert", { facts: { is: {} } })).toBeNull();
	});
});
