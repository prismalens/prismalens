// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The sidebar's thread list, Home and the Search palette (#1020): starting a
 * thread, settling, renaming and stopping from a row, and reaching places.
 */
import { expect, type Page, test } from "@playwright/test";
import { hideQueryDevtools } from "./live-stream-fixtures";

const THREAD_ID = "f5555555-5555-4555-8555-555555555555";
const RUN_ID = "f6666666-6666-4666-8666-666666666666";

async function addProject(page: Page): Promise<string> {
	await page.goto("/projects?add=1");
	await page.getByTestId("add-project-source").fill(process.cwd());
	await page.getByTestId("add-project-submit").click();
	await expect(page.getByTestId("project-page")).toBeVisible();
	return page.url().split("/projects/")[1] ?? "";
}

/** Answers POST /threads and records what the page sent. */
async function captureStart(page: Page): Promise<Record<string, unknown>[]> {
	const started: Record<string, unknown>[] = [];
	await page.route(
		(url) => url.pathname === "/api/threads",
		async (route) => {
			if (route.request().method() !== "POST") return route.fallback();
			started.push(route.request().postDataJSON() as Record<string, unknown>);
			await route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify({
					investigationId: THREAD_ID,
					jobId: "job-list-1",
					queued: true,
				}),
			});
		},
	);
	return started;
}

const threadRow = (over: Record<string, unknown> = {}) => ({
	id: RUN_ID,
	incidentId: null,
	serviceId: null,
	scheduleId: null,
	repositoryId: null,
	subject: "none",
	status: "completed",
	kind: "chat",
	title: "Why does checkout cache miss",
	accessLevel: null,
	harness: null,
	model: null,
	effort: null,
	startedAt: null,
	completedAt: new Date().toISOString(),
	summary: null,
	rootCause: null,
	rootCauseCategory: null,
	error: null,
	awaitingApprovalAt: null,
	origin: "local",
	schemaVersion: 1,
	createdAt: new Date().toISOString(),
	updatedAt: new Date().toISOString(),
	section: "active",
	lastActivityAt: new Date().toISOString(),
	lastVisitedAt: null,
	settledAt: null,
	unseen: true,
	latestText: "It misses after the nightly flush",
	projectName: null,
	titleSetBy: null,
	serviceName: null,
	...over,
});
type Row = ReturnType<typeof threadRow>;

/** Serves GET /threads/feed: one unit per row, from whatever `rows` returns for the request. */
async function serveFeed(
	page: Page,
	rows: (params: URLSearchParams) => Row[],
	nextCursor: (params: URLSearchParams) => number | null = () => null,
) {
	await page.route(
		(url) => url.pathname === "/api/threads/feed",
		async (route) => {
			const params = new URL(route.request().url()).searchParams;
			const list = rows(params);
			const count = (s: string) => list.filter((r) => r.section === s).length;
			await route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify({
					units: list.map((r) => ({
						section: r.section,
						incident: null,
						threads: [r],
					})),
					nextCursor: nextCursor(params),
					counts: {
						needs: count("needs"),
						active: count("active"),
						settled: count("settled"),
					},
				}),
			});
		},
	);
}

/** A sidebar row's title: the row's link also carries its state words for screen readers. */
const rowTitle = (page: Page) =>
	page.getByTestId("thread-row").locator("span[dir=auto]");

/** The list renders only once the app has hydrated and read the feed, so keys and clicks land. */
const hydrated = (page: Page) =>
	expect(page.getByTestId("thread-list")).toBeVisible();

test.describe("#1020 — thread list and Home", () => {
	test.beforeEach(({ page }) => hideQueryDevtools(page));

	test("a. New on a project starts the thread there and opens its page", async ({
		page,
	}) => {
		const started = await captureStart(page);
		const projectId = await addProject(page);
		await page.getByTestId("nav-new").click();
		await expect(page).toHaveURL(/\/new/);
		await expect(page.getByTestId("home")).toBeVisible({ timeout: 15_000 });
		await page.getByTestId("composer-subject").click();
		await expect(
			page.getByRole("menuitemradio", { name: "No project" }),
		).toBeVisible();
		await expect(
			page.getByRole("menuitem", { name: "Add project" }),
		).toBeVisible();
		await expect(
			page.getByRole("menuitem", { name: "Add a service" }),
		).toBeVisible();
		await page.getByTestId(`subject-project-${projectId}`).click();
		await expect(page).toHaveURL(new RegExp(`project=${projectId}`));
		// An incident carries a service, not a project, so Incident is off here.
		await expect(page.getByTestId("composer-incident")).toBeDisabled();
		await page.getByTestId("composer-input").fill("Tidy the retry helper");
		await page.getByTestId("composer-input").press("Enter");
		await expect(page).toHaveURL(new RegExp(`/threads/${THREAD_ID}`));
		expect(started[0]).toMatchObject({
			subject: { kind: "project", repositoryId: projectId },
			text: "Tidy the retry helper",
		});
	});

	test("b. Home with Incident on creates the incident and investigates the text; /threads/new still leads there", async ({
		page,
	}) => {
		let investigated: Record<string, unknown> | null = null;
		await page.route(
			(url) => /\/api\/incidents\/[^/]+\/investigate$/.test(url.pathname),
			async (route) => {
				investigated = route.request().postDataJSON() as Record<
					string,
					unknown
				>;
				const incidentId = route.request().url().split("/")[5] ?? "";
				await route.fulfill({
					status: 200,
					contentType: "application/json",
					body: JSON.stringify({
						incidentId,
						investigationId: RUN_ID,
						jobId: "job-inc-1",
						queued: true,
					}),
				});
			},
		);
		await page.goto("/threads/new?incident=true&none=true");
		await expect(page).toHaveURL(/\/new\?.*incident=true/);
		await expect(page.getByTestId("new-thread-page")).toBeVisible({
			timeout: 15_000,
		});
		await expect(page.getByTestId("composer-incident")).toHaveAttribute(
			"aria-pressed",
			"true",
		);
		await page.getByTestId("composer-severity").click();
		await page.getByTestId("severity-critical").click();
		await page
			.getByTestId("composer-input")
			.fill("Checkout returns 502 since noon\nSeen on every region");
		await page.getByTestId("composer-input").press("Enter");
		await expect(page).toHaveURL(
			new RegExp(`/incidents/[^/]+/conversation\\?investigation=${RUN_ID}`),
		);
		expect(investigated).toMatchObject({
			brief: "Checkout returns 502 since noon\nSeen on every region",
		});
		const incidentId = page.url().split("/incidents/")[1]?.split("/")[0];
		const incident = await page.request.get(`/api/incidents/${incidentId}`);
		expect(await incident.json()).toMatchObject({
			title: "Checkout returns 502 since noon",
			severity: "critical",
		});
	});

	test("b2. the composer's slash commands turn Incident on, as an investigation or a note", async ({
		page,
	}) => {
		await page.goto("/new?none=true");
		const input = page.getByTestId("composer-input");
		await expect(input).toBeVisible({ timeout: 15_000 });
		const incident = page.getByTestId("composer-incident");
		await expect(incident).toHaveAttribute("aria-pressed", "false");

		await input.fill("/");
		await expect(page.getByTestId("composer-slash-investigate")).toBeVisible();
		await page.getByTestId("composer-slash-investigate").click();
		await expect(incident).toHaveAttribute("aria-pressed", "true");
		await expect(page.getByTestId("composer-severity")).toBeVisible();
		await expect(page.getByTestId("composer-note")).toHaveCount(0);

		await input.fill("/no");
		await page.getByTestId("composer-slash-note").click();
		await expect(page.getByTestId("composer-note")).toHaveText("Note only");
	});

	test("c. a thread settles from its row, and Undo brings it back", async ({
		page,
	}) => {
		let settledAt: string | null = null;
		const settles: unknown[] = [];
		await serveFeed(page, () => [
			threadRow(
				settledAt !== null
					? { section: "settled", unseen: false, settledAt }
					: {},
			),
		]);
		let answer = () => {};
		const answered = new Promise<void>((r) => {
			answer = r;
		});
		await page.route(
			(url) => url.pathname === `/api/threads/${RUN_ID}/settle`,
			async (route) => {
				const body = route.request().postDataJSON() as { settled: boolean };
				settles.push(body);
				settledAt = body.settled ? new Date().toISOString() : null;
				if (body.settled) await answered;
				await route.fulfill({
					status: 200,
					contentType: "application/json",
					body: JSON.stringify({
						ids: [RUN_ID],
						previous: body.settled ? [{ id: RUN_ID, settledAt: null }] : [],
					}),
				});
			},
		);

		await page.goto("/incidents");
		const recents = page.getByTestId("thread-section-recents");
		const row = recents.getByTestId("thread-row");
		await expect(row).toHaveAttribute("data-state", "new");
		await expect(row).toHaveAttribute("data-id", RUN_ID);
		await recents.getByTestId("thread-row-wrap").hover();
		await expect(recents.getByTestId("thread-stop")).toHaveCount(0);
		await recents.getByTestId("thread-settle").click();
		// Undo waits for Settle's answer: without it, it would not know what to restore.
		await expect(page.getByTestId("settle-undo")).toBeDisabled();
		await expect(row).toHaveCount(0);
		answer();
		await expect(page.getByTestId("settle-undo")).toBeEnabled();
		await expect(recents.getByTestId("settle-undo-line")).toContainText(
			"Settled Why does checkout cache miss",
		);
		await expect(row).toHaveCount(0);
		await page.getByTestId("settle-undo").click();
		await expect(row).toBeVisible();
		await expect(page.getByTestId("settle-undo-line")).toHaveCount(0);
		// Undo sends back what Settle answered, so each thread returns exactly (#1020).
		expect(settles).toEqual([
			{ settled: true },
			{ settled: false, restore: [{ id: RUN_ID, settledAt: null }] },
		]);
	});

	test("c2. a live thread offers Stop on its row instead of Settle", async ({
		page,
	}) => {
		const cancelled: string[] = [];
		await serveFeed(page, () => [
			threadRow({
				status: "running",
				completedAt: null,
				startedAt: new Date().toISOString(),
				unseen: false,
			}),
		]);
		await page.route(
			(url) => url.pathname === `/api/investigations/${RUN_ID}/cancel`,
			async (route) => {
				cancelled.push(route.request().method());
				await route.fulfill({
					status: 200,
					contentType: "application/json",
					body: JSON.stringify(threadRow({ status: "cancelled" })),
				});
			},
		);
		await page.goto("/incidents");
		const wrap = page
			.getByTestId("thread-section-recents")
			.getByTestId("thread-row-wrap");
		await expect(wrap.getByTestId("thread-row")).toHaveAttribute(
			"data-state",
			"working",
		);
		await wrap.hover();
		await expect(wrap.getByTestId("thread-settle")).toHaveCount(0);
		await wrap.getByTestId("thread-stop").click();
		await expect.poll(() => cancelled).toEqual(["POST"]);
	});

	test("d. Search finds a thread and places by name", async ({ page }) => {
		await serveFeed(page, (params) =>
			params.get("search") === "cache" ? [threadRow()] : [],
		);
		await page.goto("/incidents");
		await hydrated(page);
		await page.getByTestId("nav-search").click();
		await expect(page.getByTestId("thread-search")).toBeVisible();
		await page.getByTestId("thread-search-input").fill("cache");
		await expect(page.getByTestId("thread-search-result")).toHaveText(
			/Why does checkout cache miss/,
		);
		await page.getByTestId("thread-search-input").fill("serv");
		const services = page
			.getByTestId("thread-search-place")
			.filter({ hasText: "Services" });
		await expect(services).toHaveCount(1);
		await services.click();
		await expect(page.getByTestId("thread-search")).toHaveCount(0);
		await expect(page).toHaveURL(/\/services/);
	});

	test("e. Search reaches a match past its first page with More results", async ({
		page,
	}) => {
		const cursors: string[] = [];
		const searching = (p: URLSearchParams) => p.get("search") === "retry";
		await serveFeed(
			page,
			(params) => {
				if (!searching(params)) return [];
				const cursor = params.get("cursor") ?? "0";
				cursors.push(cursor);
				const ids =
					cursor === "0" ? Array.from({ length: 20 }, (_, i) => i) : [20];
				return ids.map((i) =>
					threadRow({
						id: `f7777777-7777-4777-8777-${String(i).padStart(12, "0")}`,
						title: `Retry thread ${i}`,
					}),
				);
			},
			(params) =>
				searching(params) && (params.get("cursor") ?? "0") === "0" ? 20 : null,
		);
		await page.goto("/incidents");
		await hydrated(page);
		await page.keyboard.press("Control+k");
		await page.getByTestId("thread-search-input").fill("retry");
		await expect(page.getByTestId("thread-search-result")).toHaveCount(20);
		await page.getByTestId("thread-search-more").click();
		await expect(page.getByTestId("thread-search-result")).toHaveCount(21);
		await expect(
			page
				.getByTestId("thread-search-result")
				.filter({ hasText: "Retry thread 20" }),
		).toBeVisible();
		await expect(page.getByTestId("thread-search-more")).toHaveCount(0);
		expect(cursors).toContain("20");
	});

	test("f. Search opens with the sidebar hidden, on Settings, and reaches the terminal", async ({
		page,
	}) => {
		await page.goto("/incidents");
		await hydrated(page);
		await page.keyboard.press("[");
		await expect(page.getByTestId("sidebar")).toHaveCount(0);
		await expect(page.getByTestId("sidebar-show")).toBeVisible();
		await page.keyboard.press("Control+k");
		await expect(page.getByTestId("thread-search")).toBeVisible();
		await page.keyboard.press("Escape");
		await page.getByTestId("sidebar-show").click();

		await page.getByTestId("nav-settings").click();
		await expect(page.getByTestId("settings-frame")).toBeVisible({
			timeout: 15_000,
		});
		// Settings keeps the same sidebar: no separate back bar.
		await expect(page.getByTestId("sidebar")).toBeVisible();
		await expect(page.getByTestId("settings-back")).toHaveCount(0);
		await page.keyboard.press("Control+k");
		await expect(page.getByTestId("thread-search")).toBeVisible();
		await page.getByTestId("thread-search-input").fill("term");
		await page.getByTestId("thread-search-action-terminal").click();
		await expect(
			page.getByTestId("panel-bottom").getByTestId("terminal-panel"),
		).toBeVisible();
	});

	test("h. Settings sets how many quiet days settle a thread", async ({
		page,
	}) => {
		await page.goto("/incidents");
		await hydrated(page);
		await page.getByTestId("nav-settings").click();
		const days = page.getByTestId("general-settle-days");
		await expect(days).toHaveText(/3 days/);
		await days.click();
		await page.getByRole("option", { name: "7 days" }).click();
		await expect(days).toHaveText(/7 days/);
		await page.reload();
		await expect(page.getByTestId("general-settle-days")).toHaveText(/7 days/);
		await page.getByTestId("general-settle-days").click();
		await page.getByRole("option", { name: "3 days" }).click();
		await expect(page.getByTestId("general-settle-days")).toHaveText(/3 days/);
	});

	test("i. Rename from a row keeps the typed name as plain text", async ({
		page,
	}) => {
		let title = "Why does checkout cache miss";
		const sent: unknown[] = [];
		await serveFeed(page, () => [threadRow({ title, unseen: false })]);
		await page.route(
			(url) => url.pathname === `/api/threads/${RUN_ID}/title`,
			async (route) => {
				const body = route.request().postDataJSON() as { title: string };
				sent.push(body);
				title = body.title;
				await route.fulfill({
					status: 200,
					contentType: "application/json",
					body: JSON.stringify({ id: RUN_ID, title }),
				});
			},
		);
		await page.goto("/incidents");
		const row = page.getByTestId("thread-row-wrap").first();
		await row.hover();
		await row.getByTestId("thread-rename").click();
		const input = page.getByTestId("thread-rename-input");
		await expect(input).toBeFocused();
		await input.fill("<b>Cache</b> misses");
		await input.press("Enter");
		await expect(rowTitle(page).first()).toHaveText("<b>Cache</b> misses");
		await expect(page.getByTestId("thread-row").locator("b")).toHaveCount(0);
		expect(sent).toEqual([{ title: "<b>Cache</b> misses" }]);
		await page.getByTestId("thread-row-wrap").first().hover();
		await page.getByTestId("thread-rename").first().click();
		await page.getByTestId("thread-rename-input").fill("dropped");
		await page.getByTestId("thread-rename-input").press("Escape");
		await expect(rowTitle(page).first()).toHaveText("<b>Cache</b> misses");
		expect(sent).toHaveLength(1);
	});

	test("j. J and K move through the rows and Enter opens the focused one", async ({
		page,
	}) => {
		const ids = [0, 1, 2].map(
			(i) => `f8888888-8888-4888-8888-${String(i).padStart(12, "0")}`,
		);
		await serveFeed(page, () =>
			ids.map((id, i) =>
				threadRow({
					id,
					title: `Row ${i}`,
					unseen: false,
					lastActivityAt: new Date(Date.now() - i * 60_000).toISOString(),
				}),
			),
		);
		await page.goto("/incidents");
		const rows = page
			.getByTestId("thread-section-recents")
			.getByTestId("thread-row");
		await expect(rows).toHaveCount(3);
		await page.evaluate(() =>
			(document.activeElement as HTMLElement | null)?.blur(),
		);
		await page.keyboard.press("j");
		await expect(rows.nth(0)).toBeFocused();
		await page.keyboard.press("j");
		await expect(rows.nth(1)).toBeFocused();
		await page.keyboard.press("j");
		await page.keyboard.press("j");
		await expect(rows.nth(2)).toBeFocused();
		await page.keyboard.press("k");
		await expect(rows.nth(1)).toBeFocused();
		await page.keyboard.press("Enter");
		await expect(page).toHaveURL(new RegExp(`/threads/${ids[1]}$`));
	});

	test.describe("on a phone", () => {
		test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

		test("g. the menu opens Search, which reaches Automation by touch", async ({
			page,
		}) => {
			await page.goto("/incidents");
			const strip = page.getByTestId("topbar");
			await expect(strip.getByTestId("strip-new")).toBeVisible();
			await expect(page.getByTestId("sidebar")).toBeHidden();
			const menu = page.getByTestId("phone-menu");
			// The server-rendered strip shows before it hydrates; tap until the menu opens.
			await expect(async () => {
				await strip.getByTestId("strip-menu").tap();
				await expect(menu).toBeVisible({ timeout: 1000 });
			}).toPass({ timeout: 15_000 });
			for (const id of [
				"menu-new",
				"menu-search",
				"menu-threads",
				"menu-automation",
				"menu-services",
				"menu-settings",
			])
				await expect(menu.getByTestId(id)).toBeVisible();
			await menu.getByTestId("menu-search").tap();
			await expect(menu).toHaveCount(0);
			await expect(page.getByTestId("thread-search")).toBeVisible();
			// A phone has no bottom panel, so Terminal is not offered.
			await page.getByTestId("thread-search-input").fill("term");
			await expect(
				page.getByTestId("thread-search-action-terminal"),
			).toHaveCount(0);
			await page.getByTestId("thread-search-input").fill("auto");
			await page
				.getByTestId("thread-search-place")
				.filter({ hasText: "Automation" })
				.tap();
			await expect(page).toHaveURL(/\/automation/);
			await expect(page.getByTestId("automation-page")).toBeVisible();
		});

		test("g2. the strip shows what waits on you and leads to it", async ({
			page,
		}) => {
			await serveFeed(page, () => [
				threadRow({
					status: "running",
					completedAt: null,
					awaitingApprovalAt: new Date().toISOString(),
					section: "needs",
				}),
			]);
			await page.goto("/incidents");
			const waiting = page.getByTestId("strip-waiting");
			// The count is the ask mark and a number; its words are the label (e0ee7d639).
			await expect(waiting).toHaveText("1");
			await expect(waiting).toHaveAttribute("aria-label", "1 waiting for you");
			await waiting.tap();
			await expect(page).toHaveURL(/\/threads\?state=waiting/);
			await expect(page.getByTestId("threads-page")).toBeVisible();
		});
	});
});
