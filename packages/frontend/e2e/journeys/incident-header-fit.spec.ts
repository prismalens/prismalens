// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { expect } from "@playwright/test";
import { test } from "../steps/fixtures";
import {
	fireIncident,
	LIVE,
	sidewaysFaults,
	visit,
	waitForRun,
} from "../steps/product";
import { hideQueryDevtools } from "./live-stream-fixtures";

// With the panel open at 1280 the page is ~570 px wide, but the header hid its firing text by
// the viewport, so ⋯ scrolled 16 px past the page's edge (#1238, the design matrix's incident-panel).
// The overflow grows with the firing text's age; at 1030, still lg, the rail and panel leave ~545 px, short of it at any age.
test.use({ viewport: { width: 1030, height: 800 } });

test("the incident header keeps ⋯ in reach with the panel open on a narrow page (#1238)", async ({
	page,
	agents,
	alertmanager,
	deliverWebhook,
}) => {
	await hideQueryDevtools(page);
	agents.install(["claude-agent-acp"], "claude");
	await page.request.post("/api/settings/harness/check", {
		data: { id: "claude-code" },
	});
	await page.request.patch("/api/settings/harness", {
		data: { harness: "claude-code" },
	});
	const done = await fireIncident(page, alertmanager, deliverWebhook, {
		name: "BooklogrApiLatencyP99High",
		service: LIVE,
		severity: "critical",
		session: "success",
	});
	await waitForRun(page, done.id, (r) => r.status === "completed", "done");
	await visit(page, `/incidents/${done.id}`);
	await page.getByTestId("transcript-report-overview").click();
	await expect(page.getByTestId("run-details-incident")).toBeVisible();

	const header = await page.getByTestId("incident-header").boundingBox();
	const more = await page.getByTestId("header-more").boundingBox();
	expect(more && header && more.x + more.width).toBeLessThanOrEqual(
		(header?.x ?? 0) + (header?.width ?? 0),
	);
	expect(
		(await sidewaysFaults(page)).filter((f) => f.includes("header-more")),
	).toEqual([]);
});
