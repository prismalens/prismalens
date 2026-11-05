// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { expect, type Page } from "@playwright/test";
import { test } from "../steps/fixtures";
import {
	fireIncident,
	LIVE,
	visit,
	waitFor,
	waitForRun,
} from "../steps/product";

/**
 * The run strip's Retry run and Resume actions (#1020, commit 0ff09f98).
 */

// This stack cannot restart mid-test, so the failed run reads as interrupted via API routing.
async function readAsInterrupted(page: Page, runId: string) {
	await page.route(
		(url) =>
			url.pathname.startsWith("/api/incidents") ||
			url.pathname.startsWith("/api/investigations"),
		async (route) => {
			if (route.request().method() !== "GET") return route.fallback();
			const res = await route.fetch();
			const body = await res.json().catch(() => null);
			if (route.request().url().includes(`/api/investigations/${runId}`)) {
				if (body) {
					body.endReason = "interrupted";
					body.error = "Not resumed: Resume after a restart is off.";
				}
			} else {
				const incidents = Array.isArray(body?.data) ? body.data : [body];
				for (const i of incidents)
					for (const r of i?.investigations ?? [])
						if (r.id === runId) {
							r.endReason = "interrupted";
							r.error = "Not resumed: Resume after a restart is off.";
						}
			}
			await route.fulfill({ response: res, json: body });
		},
	);
}

test.describe("Run strip retry (#1020)", () => {
	test("a failed investigation's run page shows Retry run and starts a new run", async ({
		page,
		alertmanager,
		deliverWebhook,
		unique,
	}) => {
		const made = await fireIncident(page, alertmanager, deliverWebhook, {
			name: unique("RunRetryFailed"),
			service: LIVE,
			session: "failure",
		});
		const run = await waitForRun(
			page,
			made.id,
			(r) => r.status === "failed",
			"the run to end failed",
		);

		await visit(
			page,
			`/incidents/${made.id}/conversation?investigation=${run.id}`,
		);
		await expect(page.getByTestId("run-page")).toBeVisible();
		await expect(page.getByTestId("run-strip-label")).toContainText("failed");

		const retry = page.getByTestId("run-strip-retry");
		await expect(retry).toBeVisible();
		await expect(retry).toHaveText("Retry run");

		await retry.click();

		await expect(page.getByTestId("run-strip-label")).not.toContainText(
			"failed",
		);
		const menu = page.getByTestId("runs-menu");
		await expect(menu).toBeVisible();
		await menu.click();
		await expect(page.getByTestId("runs-menu-item")).toHaveCount(2);
	});

	test("an interrupted run shows Resume and no Retry run", async ({
		page,
		alertmanager,
		deliverWebhook,
		unique,
	}) => {
		const made = await fireIncident(page, alertmanager, deliverWebhook, {
			name: unique("RunRetryInterrupted"),
			service: LIVE,
			session: "failure",
		});
		const run = await waitForRun(
			page,
			made.id,
			(r) => r.status === "failed",
			"the run to end failed",
		);
		await readAsInterrupted(page, run.id);

		await visit(
			page,
			`/incidents/${made.id}/conversation?investigation=${run.id}`,
		);
		await expect(page.getByTestId("run-page")).toBeVisible();
		await expect(page.getByTestId("run-strip-resume")).toBeVisible();
		await expect(page.getByTestId("run-strip-retry")).not.toBeVisible();
	});

	test("a live run shows neither Resume nor Retry run", async ({
		page,
		alertmanager,
		deliverWebhook,
		unique,
	}) => {
		const made = await fireIncident(page, alertmanager, deliverWebhook, {
			name: unique("RunRetryLive"),
			service: LIVE,
			session: "live",
		});
		const run = await waitForRun(
			page,
			made.id,
			(r) => r.status === "running",
			"the run to be running",
		);

		await visit(
			page,
			`/incidents/${made.id}/conversation?investigation=${run.id}`,
		);
		await expect(page.getByTestId("run-page")).toBeVisible();
		await expect(page.getByTestId("run-strip-stop")).toBeVisible();
		await expect(page.getByTestId("run-strip-resume")).not.toBeVisible();
		await expect(page.getByTestId("run-strip-retry")).not.toBeVisible();
	});

	test("a failed plain chat shows no Retry run", async ({ page, unique }) => {
		const made = await page.request.post("/api/incidents", {
			data: { title: unique("ChatFailed"), tags: ["chat"] },
		});
		expect(made.ok(), await made.text()).toBe(true);
		const { id } = (await made.json()) as { id: string };

		const started = await page.request.post(`/api/incidents/${id}/chat`, {
			data: { text: "What broke? fake-session:failure" },
		});
		expect(started.ok(), await started.text()).toBe(true);
		const { investigationId } = (await started.json()) as {
			investigationId: string;
		};

		await waitFor(async () => {
			const r = await page.request.get(
				`/api/investigations/${investigationId}`,
			);
			const run = (await r.json()) as {
				status: string;
				kind: string;
			};
			return run.kind === "chat" && run.status === "failed" ? run : undefined;
		}, "the chat to fail");

		await visit(
			page,
			`/incidents/${id}/conversation?investigation=${investigationId}`,
		);
		await expect(page.getByTestId("run-page")).toBeVisible();
		await expect(page.getByTestId("run-strip-label")).toContainText("failed");
		await expect(page.getByTestId("run-strip-retry")).not.toBeVisible();
	});
});
