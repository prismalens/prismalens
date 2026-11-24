// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ScenarioApp } from "./support/scenario-app.js";

const pl = new ScenarioApp();

beforeAll(async () => {
	await pl.boot();
}, 60_000);
afterAll(async () => {
	await pl.dispose();
});

interface Source {
	id: string;
	label: string;
	status: string;
	baseUrl?: string | null;
	lastErrorMessage: string | null;
}

describe("Settings, Alert sources (study-v3 §7)", () => {
	it("Given a source added by URL, When it is listed, Then its URL and its own error read back", async () => {
		const integration = await pl.api<{ id: string }>("/integrations", {
			method: "POST",
			body: { templateId: "alertmanager", label: "Alertmanager" },
		});
		const made = await pl.api<{ id: string }>("/integrations/connections", {
			method: "POST",
			body: {
				integrationId: integration.id,
				label: "Lab Alertmanager",
				credentials: {},
				connectionConfig: { baseUrl: "http://127.0.0.1:9" },
			},
		});
		await pl.api(`/integrations/connections/${made.id}/test`, { method: "POST" });

		const list = await pl.api<Source[]>("/integrations/connections");
		const row = list.find((c) => c.id === made.id);
		expect(row?.baseUrl).toBe("http://127.0.0.1:9");
		expect(row?.status).toBe("ERROR");
		// A URL-only source's network error is not a secret; it says what failed.
		expect(row?.lastErrorMessage).not.toBe(
			"Connection error occurred. Check logs for details.",
		);
		expect(row?.lastErrorMessage).toBeTruthy();
	});
});
