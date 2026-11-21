// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Thread list journeys (more) (#1020): the sidebar's Waiting for you and
 * Recents, its doors, an incident's threads as one row, and the Threads
 * page's filters.
 */
import { expect, type Page, test } from "@playwright/test";
import { hideQueryDevtools } from "./live-stream-fixtures";

const RUN_ID = "f6666666-6666-4666-8666-666666666666";
const id = (n: number) =>
	`f9999999-9999-4999-8999-${String(n).padStart(12, "0")}`;

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
	unseen: false,
	latestText: "It misses after the nightly flush",
	projectName: null,
	titleSetBy: null,
	serviceName: null,
	...over,
});
type Row = ReturnType<typeof threadRow>;
interface Unit {
	section: string;
	incident: Record<string, unknown> | null;
	threads: Row[];
}

/** Serves GET /threads/feed from whatever `units` returns for the request. */
async function serveFeed(
	page: Page,
	units: (params: URLSearchParams) => Unit[],
) {
	await page.route(
		(url) => url.pathname === "/api/threads/feed",
		async (route) => {
			const list = units(new URL(route.request().url()).searchParams);
			const count = (s: string) => list.filter((u) => u.section === s).length;
			await route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify({
					units: list,
					nextCursor: null,
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
const single = (rows: Row[]): Unit[] =>
	rows.map((r) => ({ section: r.section, incident: null, threads: [r] }));

const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const MIN = 60_000;

/** The list renders only once the app has hydrated and read the feed, so keys and clicks land. */
const hydrated = (page: Page) =>
	expect(page.getByTestId("thread-list")).toBeVisible();

test.describe("#1020 — thread list journeys (more)", () => {
	test.beforeEach(({ page }) => hideQueryDevtools(page));

	// The sidebar is #1101's list (pattern sheet §1): Needs you, Threads with Show more, Settled
	// folded at the foot; Waiting for you, Recents and the Threads page it replaced are gone.
	test("1. Needs you holds the thread on an approval; Threads lists the rest by last activity, 15 then Show more; Settled folds at the foot", async ({
		page,
	}) => {
		const asks = threadRow({
			id: id(100),
			title: "Thread with pending approval",
			status: "running",
			completedAt: null,
			awaitingApprovalAt: new Date().toISOString(),
			section: "needs",
			lastActivityAt: ago(30 * MIN),
		});
		const live = threadRow({
			id: id(101),
			title: "Live running thread",
			status: "running",
			completedAt: null,
			lastActivityAt: ago(1 * MIN),
		});
		const failed = threadRow({
			id: id(102),
			title: "Failed thread",
			status: "failed",
			lastActivityAt: ago(2 * MIN),
		});
		const settled = threadRow({
			id: id(103),
			title: "Quiet settled thread",
			section: "settled",
			settledAt: ago(60 * MIN),
			lastActivityAt: ago(3 * MIN),
		});
		const older = Array.from({ length: 15 }, (_, i) =>
			threadRow({
				id: id(i),
				title: `Older thread ${i}`,
				lastActivityAt: ago((10 + i) * MIN),
			}),
		);
		await serveFeed(page, () =>
			single([...older, settled, failed, asks, live]),
		);

		await page.goto("/incidents");
		const list = page.getByTestId("thread-list");
		const needs = list.getByTestId("thread-section-needs");
		await expect(needs).toContainText("Needs you");
		await expect(needs.getByTestId("thread-row")).toHaveCount(1);
		await expect(needs.getByTestId("thread-row")).toHaveAttribute(
			"data-state",
			"approval",
		);
		await expect(needs.getByTestId("thread-row")).toContainText(
			"Thread with pending approval",
		);

		const threads = list.getByTestId("thread-section-threads");
		const rows = threads.getByTestId("thread-row");
		// A thread that needs you shows once, above; Threads draws 15, then Show 2 more.
		await expect(rows).toHaveCount(15);
		await expect(rows.nth(0)).toHaveAttribute("data-id", id(101));
		await expect(rows.nth(0)).toHaveAttribute("data-state", "working");
		await expect(rows.nth(1)).toHaveAttribute("data-state", "failed");
		await expect(rows.nth(2)).toHaveAttribute("data-id", id(0));
		await expect(rows.nth(2)).toHaveAttribute("data-state", "done");
		await expect(rows.nth(0)).toHaveAttribute("href", `/threads/${id(101)}`);
		await expect(threads.locator(`[data-id="${id(103)}"]`)).toHaveCount(0);
		const more = threads.getByTestId("threads-show-more");
		await expect(more).toHaveText("Show 2 more");
		await more.click();
		await expect(rows).toHaveCount(17);
		await expect(more).toHaveCount(0);

		// Needs you sits above Threads.
		const needsBox = await needs.boundingBox();
		const threadsBox = await threads.boundingBox();
		expect(needsBox?.y ?? 0).toBeLessThan(threadsBox?.y ?? 0);

		// Settled is folded at the foot with its count, and opens to the settled thread.
		const settledGroup = list.getByTestId("thread-section-settled");
		await expect(settledGroup.getByTestId("settled-toggle")).toContainText(
			"Settled1",
		);
		await expect(settledGroup.getByTestId("thread-row")).toHaveCount(0);
		await settledGroup.getByTestId("settled-toggle").click();
		await expect(settledGroup.getByTestId("thread-row")).toHaveAttribute(
			"data-id",
			id(103),
		);
	});

	test("2. A settled thread is off Threads, and new activity brings it back at the top as working", async ({
		page,
	}) => {
		let hasNewActivity = false;
		const threadId = id(200);
		await serveFeed(page, () =>
			single([
				threadRow({
					id: id(201),
					title: "Recent other thread",
					lastActivityAt: ago(5 * MIN),
				}),
				threadRow({
					id: threadId,
					title: "Checkout latency investigation",
					section: hasNewActivity ? "active" : "settled",
					status: hasNewActivity ? "running" : "completed",
					completedAt: hasNewActivity ? null : ago(60 * MIN),
					settledAt: ago(30 * MIN),
					lastActivityAt: hasNewActivity ? ago(0) : ago(60 * MIN),
				}),
			]),
		);

		await page.goto("/incidents");
		const rows = page
			.getByTestId("thread-section-threads")
			.getByTestId("thread-row");
		// Settled, it is off Threads.
		await expect(rows).toHaveCount(1);
		await expect(rows.nth(0)).toHaveAttribute("data-id", id(201));

		hasNewActivity = true;
		await page.reload();

		await expect(rows).toHaveCount(2);
		await expect(rows.nth(0)).toHaveAttribute("data-id", threadId);
		await expect(rows.nth(0)).toHaveAttribute("data-state", "working");
		await expect(rows.nth(0)).toContainText("Checkout latency investigation");
	});

	// The Threads page and its filters went with #1101 (sheet §1); the sidebar's Filter took them.
	test("3. The palette narrows by typing and holds no filters; the sidebar's Filter keeps the list to a state in the URL, and Clear restores it", async ({
		page,
	}) => {
		const rows = [
			threadRow({
				id: id(301),
				title: "Alpha chat on repo one",
				status: "running",
				completedAt: null,
				lastActivityAt: ago(30 * MIN),
			}),
			threadRow({
				id: id(302),
				title: "Beta investigation on repo two",
				kind: "investigation",
				status: "failed",
				lastActivityAt: ago(60 * MIN),
			}),
			threadRow({
				id: id(303),
				title: "Gamma scheduled check",
				lastActivityAt: ago(90 * MIN),
			}),
		];
		await serveFeed(page, (params) => {
			const search = params.get("search")?.toLowerCase();
			return single(
				rows.filter((r) => !search || r.title.toLowerCase().includes(search)),
			);
		});

		await page.goto("/incidents");
		await hydrated(page);
		await page.keyboard.press("Control+k");
		await expect(page.getByTestId("thread-search")).toBeVisible();
		const results = page.getByTestId("thread-search-result");
		await expect(results).toHaveCount(3);
		await expect(page.getByTestId("thread-search-filters")).toHaveCount(0);
		await page.getByTestId("thread-search-input").fill("Alpha");
		await expect(results).toHaveCount(1);
		await expect(results).toHaveText(/Alpha chat/);
		await page.getByTestId("thread-search-input").fill("");
		await expect(results).toHaveCount(3);
		await page.keyboard.press("Escape");
		await expect(page.getByTestId("thread-search")).toHaveCount(0);

		const titles = page.getByTestId("thread-list").getByTestId("row-title");
		await expect(titles).toHaveText([
			/Alpha chat/,
			/Beta investigation/,
			/Gamma scheduled/,
		]);
		// The Filter's popover loads after first paint; a press on its stand-in can be lost in dev (#1154).
		const openFilter = async () => {
			const filter = page.getByTestId("sidebar-filter");
			await expect(filter).toHaveAttribute("aria-haspopup", "dialog");
			await filter.click();
		};
		const pick = async (state: string) => {
			await openFilter();
			await page.getByTestId("thread-filter-state").click();
			await page.getByTestId(`thread-filter-state-${state}`).click();
			// Escape goes to the top layer: the list must be unmounted, not just closing, first.
			await expect(page.getByRole("listbox")).toHaveCount(0);
			await page.keyboard.press("Escape");
			await expect(page.getByTestId("thread-filter-state")).toHaveCount(0);
		};
		await pick("failed");
		await expect(page).toHaveURL(/state=failed/);
		await expect(titles).toHaveText([/Beta investigation/]);
		await expect(page.getByTestId("sidebar-filter")).toHaveAttribute(
			"aria-label",
			"Filter, 1 on",
		);
		await pick("working");
		await expect(titles).toHaveText([/Alpha chat/]);
		// A reload keeps the filter: the URL holds it.
		await page.reload();
		await expect(titles).toHaveText([/Alpha chat/]);

		await openFilter();
		await page.getByTestId("thread-filters-clear").click();
		await expect(titles).toHaveCount(3);
		await expect(page).not.toHaveURL(/state=/);
	});

	// #1101's list is flat (sheet §1): an incident's threads are rows of their own, not one block.
	test("4. An incident's threads list as rows that open the incident at their run; an alert's run reads as its incident", async ({
		page,
	}) => {
		const INCIDENT_ID = "b0111111-1111-4111-8111-111111111111";
		const t1 = threadRow({
			id: id(401),
			incidentId: INCIDENT_ID,
			title: "Root cause analysis",
			triggerType: "auto_critical",
			status: "running",
			completedAt: null,
			lastActivityAt: ago(1 * MIN),
		});
		const t2 = threadRow({
			id: id(402),
			incidentId: INCIDENT_ID,
			title: "Mitigation run",
			lastActivityAt: ago(5 * MIN),
		});
		await serveFeed(page, () => [
			{
				section: "active",
				incident: {
					id: INCIDENT_ID,
					number: 99,
					title: "Gateway 502 spike",
					severity: "critical",
					status: "investigating",
				},
				threads: [t1, t2],
			},
			...single([
				threadRow({
					id: id(403),
					title: "A plain thread",
					lastActivityAt: ago(2 * MIN),
				}),
			]),
		]);

		await page.goto("/incidents");
		const rows = page
			.getByTestId("thread-section-threads")
			.getByTestId("thread-row");
		const at = (n: number) =>
			`/incidents/${INCIDENT_ID}/conversation?investigation=${id(n)}`;
		// By last activity: the alert's run, the plain thread, then the incident's other run.
		await expect(rows).toHaveCount(3);
		await expect(rows.nth(0)).toHaveAttribute("data-id", id(401));
		await expect(rows.nth(0)).toHaveAttribute("href", at(401));
		await expect(rows.nth(0)).toHaveAttribute("data-state", "working");
		await expect(rows.nth(0).getByTestId("row-title")).toHaveText(
			"Gateway 502 spike",
		);
		await expect(rows.nth(1)).toHaveAttribute("href", `/threads/${id(403)}`);
		await expect(rows.nth(2)).toHaveAttribute("href", at(402));
		await expect(rows.nth(2).getByTestId("row-title")).toHaveText(
			"Mitigation run",
		);
		await expect(page.getByTestId("thread-unit")).toHaveCount(0);
		await expect(page.getByTestId("thread-incident-chip")).toHaveCount(0);
		await rows.nth(0).click();
		await expect(page).toHaveURL(new RegExp(`investigation=${id(401)}`));
	});

	test("5. The sidebar's doors: Home, Search, Triggers, Projects, Settings at the foot, and Operations only once alerts exist; c opens Home with Incident on; Ctrl Shift O opens Home", async ({
		page,
	}) => {
		let delivered = false;
		await page.route(
			(url) => url.pathname === "/api/webhooks/last-delivery",
			(route) =>
				route.fulfill({
					status: 200,
					contentType: "application/json",
					body: JSON.stringify(
						delivered
							? { at: new Date().toISOString(), received: 1, accepted: 1 }
							: null,
					),
				}),
		);
		// Incidents an alert opened also earn Operations; none here.
		await page.route(
			(url) => url.pathname === "/api/incidents",
			(route) =>
				route.request().method() !== "GET"
					? route.fallback()
					: route.fulfill({
							status: 200,
							contentType: "application/json",
							body: JSON.stringify({
								data: [],
								pagination: { total: 0, limit: 100, offset: 0, hasMore: false },
							}),
						}),
		);
		// Alerts with no service earn a door of their own; none here.
		await page.route(
			(url) => url.pathname === "/api/alerts",
			(route) =>
				route.fulfill({
					status: 200,
					contentType: "application/json",
					body: JSON.stringify({
						data: [],
						pagination: { total: 0, limit: 1, offset: 0, hasMore: false },
					}),
				}),
		);
		// The door stays once earned on this device; the paired state earned it on the seeded stack.
		await page.addInitScript(() =>
			localStorage.removeItem("pl.nav.operations"),
		);
		// The Threads page is gone (#1101 sheet §1): /threads lands on Home, the list is the sidebar.
		await page.goto("/threads");
		await expect(page).toHaveURL(/\/new$/);
		const sidebar = page.getByTestId("sidebar");
		await expect(sidebar).toBeVisible();
		const doors: [string, RegExp][] = [
			["nav-automation", /\/automation$/],
			["nav-projects", /\/projects$/],
			["nav-settings", /\/settings/],
			["nav-new", /\/new$/],
		];
		for (const [door] of doors)
			await expect(sidebar.getByTestId(door)).toBeVisible();
		await expect(sidebar.getByTestId("nav-search")).toBeVisible();
		await expect(sidebar.getByTestId("nav-automation")).toHaveText(/Triggers/);
		// At full width the list is in the sidebar, so its rail door stays hidden.
		await expect(sidebar.getByTestId("nav-threads")).toBeHidden();
		await expect(sidebar.getByTestId("nav-incidents")).toBeHidden();
		await expect(sidebar.getByTestId("nav-alerts")).toHaveCount(0);
		// Settings sits at the foot, below the list.
		const settingsBox = await sidebar.getByTestId("nav-settings").boundingBox();
		const listBox = await sidebar.getByTestId("thread-list").boundingBox();
		expect(settingsBox?.y ?? 0).toBeGreaterThan(listBox?.y ?? 0);
		await expect(sidebar.getByTestId("nav-new")).toHaveAttribute(
			"aria-current",
			"page",
		);
		for (const [door, url] of doors) {
			await sidebar.getByTestId(door).click();
			await expect(page).toHaveURL(url);
		}

		delivered = true;
		await page.reload();
		await expect(sidebar.getByTestId("nav-incidents")).toHaveText(/Operations/);
		await sidebar.getByTestId("nav-incidents").click();
		await expect(page).toHaveURL(/\/incidents$/);

		// `c` opens Home with Incident on; the board owns the key, so it must be up.
		await expect(page.getByTestId("create-incident-button")).toBeVisible();
		// Clear focus without clicking: a click at the page's centre can land on a field or a row.
		await page.evaluate(() =>
			(document.activeElement as HTMLElement | null)?.blur(),
		);
		await page.keyboard.press("c");
		await expect(page).toHaveURL(/\/new\?incident=true/);
		await expect(page.getByTestId("new-thread-page")).toBeVisible({
			timeout: 15_000,
		});
		await expect(page.getByTestId("composer-incident")).toHaveAttribute(
			"aria-pressed",
			"true",
		);

		// Ctrl Shift O opens Home
		await page.goto("/incidents");
		await expect(page.getByTestId("thread-list")).toBeVisible();
		await page.evaluate(() =>
			(document.activeElement as HTMLElement | null)?.blur(),
		);
		await page.keyboard.press("Control+Shift+O");
		await expect(page).toHaveURL(/\/new$/);
		await expect(page.getByTestId("new-thread-page")).toBeVisible({
			timeout: 15_000,
		});
	});

	test("6. The list is read-only safe: a thread title containing <img src=x onerror=alert(1)> renders as plain text", async ({
		page,
	}) => {
		let dialogFired = false;
		page.on("dialog", (dialog) => {
			dialogFired = true;
			void dialog.dismiss();
		});
		const xss = "<img src=x onerror=alert(1)>";
		await serveFeed(page, () => single([threadRow({ title: xss })]));

		await page.goto("/incidents");
		await expect(
			page.getByTestId("thread-row").getByTestId("row-title"),
		).toHaveText(xss);
		// The Threads page is gone (#1101 sheet §1); the palette is the other place a title shows.
		await hydrated(page);
		await page.keyboard.press("Control+k");
		await expect(page.getByTestId("thread-search-result")).toContainText(xss);
		await expect(page.locator("img[src='x']")).toHaveCount(0);
		expect(dialogFired).toBe(false);
	});
});
