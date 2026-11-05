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

	test("1. Waiting for you holds the thread on an approval; Recents lists the rest by last activity, one line each, up to 12, then View all", async ({
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
			unseen: true,
			lastActivityAt: ago(2 * MIN),
		});
		const settled = threadRow({
			id: id(103),
			title: "Quiet settled thread",
			section: "settled",
			settledAt: ago(60 * MIN),
			lastActivityAt: ago(3 * MIN),
		});
		const older = Array.from({ length: 12 }, (_, i) =>
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
		const waiting = list.getByTestId("thread-section-waiting");
		await expect(waiting).toContainText("Waiting for you");
		await expect(waiting.getByTestId("thread-row")).toHaveCount(1);
		await expect(waiting.getByTestId("thread-row")).toHaveAttribute(
			"data-state",
			"asks",
		);
		await expect(waiting.getByTestId("thread-row")).toContainText(
			"Thread with pending approval",
		);

		const recents = list.getByTestId("thread-section-recents");
		const rows = recents.getByTestId("thread-row");
		// A waiting thread shows once, above; Recents stops at 12.
		await expect(rows).toHaveCount(12);
		await expect(rows.nth(0)).toHaveAttribute("data-id", id(101));
		await expect(rows.nth(0)).toHaveAttribute("data-state", "working");
		await expect(rows.nth(1)).toHaveAttribute("data-state", "failed");
		await expect(rows.nth(2)).toHaveAttribute("data-id", id(103));
		await expect(rows.nth(2)).toHaveAttribute("data-state", "quiet");
		await expect(rows.nth(3)).toHaveAttribute("data-id", id(0));
		await expect(
			recents.getByTestId("thread-row").filter({ hasText: "Older thread 9" }),
		).toHaveCount(0);
		await expect(rows.nth(0)).toHaveAttribute("href", `/threads/${id(101)}`);

		// One line each, with one trailing mark when there is something to say.
		for (const n of [0, 1]) {
			const box = await rows.nth(n).boundingBox();
			expect(box?.height).toBeLessThanOrEqual(36);
			await expect(rows.nth(n).getByTestId("tree-state")).toHaveCount(1);
		}
		await expect(rows.nth(3).getByTestId("tree-state")).toHaveCount(0);
		await expect(rows.nth(3).getByTestId("row-origin")).toHaveCount(0);

		// The sections main's list had are gone.
		for (const gone of [
			"threads-needs",
			"threads-active",
			"threads-settled",
			"thread-incident-chip",
		])
			await expect(page.getByTestId(gone)).toHaveCount(0);

		// Waiting sits above Recents.
		const waitingBox = await waiting.boundingBox();
		const recentsBox = await recents.boundingBox();
		expect(waitingBox!.y).toBeLessThan(recentsBox!.y);

		await recents.getByTestId("threads-view-all").click();
		await expect(page).toHaveURL(/\/threads$/);
		await expect(page.getByTestId("threads-page")).toBeVisible();
	});

	test("2. A settled thread that gets new activity rises to the top of Recents as working", async ({
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
			.getByTestId("thread-section-recents")
			.getByTestId("thread-row");
		await expect(rows).toHaveCount(2);
		await expect(rows.nth(1)).toHaveAttribute("data-id", threadId);
		await expect(rows.nth(1)).toHaveAttribute("data-state", "quiet");

		hasNewActivity = true;
		await page.reload();

		await expect(rows.nth(0)).toHaveAttribute("data-id", threadId);
		await expect(rows.nth(0)).toHaveAttribute("data-state", "working");
		await expect(rows.nth(0)).toContainText("Checkout latency investigation");
	});

	test("3. The palette narrows by typing and holds no filters; the Threads page filters by who started it, status, project and search; Clear restores it", async ({
		page,
	}) => {
		const REPO_1_ID = "11111111-2222-4333-8444-555555555551";
		const REPO_2_ID = "11111111-2222-4333-8444-555555555552";
		const SCHEDULE_ID = "22222222-3333-4444-8555-666666666661";
		await page.route(
			(url) => url.pathname === "/api/repositories",
			async (route) => {
				await route.fulfill({
					status: 200,
					contentType: "application/json",
					body: JSON.stringify({
						data: [
							{ id: REPO_1_ID, fullName: "org/repo-one" },
							{ id: REPO_2_ID, fullName: "org/repo-two" },
						],
						pagination: { total: 2, limit: 100, offset: 0, hasMore: false },
					}),
				});
			},
		);
		const rows = [
			threadRow({
				id: id(301),
				title: "Alpha chat on repo one",
				status: "running",
				completedAt: null,
				repositoryId: REPO_1_ID,
				lastActivityAt: ago(30 * MIN),
			}),
			threadRow({
				id: id(302),
				title: "Beta investigation on repo two",
				kind: "investigation",
				status: "failed",
				unseen: true,
				repositoryId: REPO_2_ID,
				lastActivityAt: ago(60 * MIN),
			}),
			threadRow({
				id: id(303),
				title: "Gamma scheduled check",
				scheduleId: SCHEDULE_ID,
				repositoryId: REPO_1_ID,
				lastActivityAt: ago(90 * MIN),
			}),
		];
		const searches: string[] = [];
		await serveFeed(page, (params) => {
			const search = params.get("search")?.toLowerCase();
			const repositoryId = params.get("repositoryId");
			if (search) searches.push(search);
			return single(
				rows.filter(
					(r) =>
						(!search || r.title.toLowerCase().includes(search)) &&
						(!repositoryId || r.repositoryId === repositoryId),
				),
			);
		});

		await page.goto("/incidents");
		await hydrated(page);
		await page.keyboard.press("Control+k");
		await expect(page.getByTestId("thread-search")).toBeVisible();
		const results = page.getByTestId("thread-search-result");
		await expect(results).toHaveCount(3);
		// The palette holds no filters; they live on the Threads page (#1020).
		await expect(page.getByTestId("thread-search-filters")).toHaveCount(0);
		await page.getByTestId("thread-search-input").fill("Alpha");
		await expect(results).toHaveCount(1);
		await expect(results).toHaveText(/Alpha chat/);
		await page.getByTestId("thread-search-input").fill("");
		await expect(results).toHaveCount(3);
		await page.keyboard.press("Escape");
		// The sidebar has no filter of its own.
		await expect(page.getByTestId("sidebar-filter")).toHaveCount(0);

		await page.getByTestId("nav-threads").click();
		const threads = page.getByTestId("threads-page");
		await expect(threads).toBeVisible();
		const titles = threads.getByTestId("thread-row");
		await expect(titles).toHaveText([
			/Alpha chat/,
			/Beta investigation/,
			/Gamma scheduled/,
		]);
		// A schedule's run opens under its schedule.
		await expect(titles.nth(2)).toHaveAttribute(
			"href",
			`/schedules/${SCHEDULE_ID}/runs/${id(303)}`,
		);
		await expect(threads.getByTestId("threads-clear")).toHaveCount(0);
		const pick = async (filter: string, option: string) => {
			await threads.getByTestId(`threads-filter-${filter}`).click();
			await page.getByRole("option", { name: option, exact: true }).click();
		};

		// Started by
		await pick("started-by", "Scheduled");
		await expect(page).toHaveURL(/origin=schedule/);
		await expect(titles).toHaveText([/Gamma scheduled/]);
		await pick("started-by", "Started by you");
		await expect(titles).toHaveText([/Alpha chat/, /Beta investigation/]);
		await pick("started-by", "Started by anyone");
		await expect(titles).toHaveCount(3);

		// Status
		await pick("status", "Failed");
		await expect(titles).toHaveText([/Beta investigation/]);
		await pick("status", "Working");
		await expect(titles).toHaveText([/Alpha chat/]);
		await pick("status", "Any status");
		await expect(titles).toHaveCount(3);

		// Project: asked of the server
		await pick("project", "org/repo-two");
		await expect(page).toHaveURL(new RegExp(`project=${REPO_2_ID}`));
		await expect(titles).toHaveText([/Beta investigation/]);
		await pick("project", "Any project");
		await expect(titles).toHaveCount(3);

		// Search: asked of the server and matched on the title
		await threads.getByTestId("threads-search").fill("gamma");
		await expect(titles).toHaveText([/Gamma scheduled/]);
		expect(searches).toContain("gamma");

		// Clear restores every thread
		await pick("status", "Failed");
		await expect(threads.getByTestId("threads-none")).toBeVisible();
		await threads.getByTestId("threads-clear").click();
		await expect(titles).toHaveCount(3);
		await expect(threads.getByTestId("threads-search")).toHaveValue("");
		await expect(page).toHaveURL(/\/threads$/);
	});

	test("4. An incident's threads show as one row that opens the incident", async ({
		page,
	}) => {
		const INCIDENT_ID = "b0111111-1111-4111-8111-111111111111";
		const t1 = threadRow({
			id: id(401),
			incidentId: INCIDENT_ID,
			title: "Root cause analysis",
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
			.getByTestId("thread-section-recents")
			.getByTestId("thread-row");
		await expect(rows).toHaveCount(2);
		const incident = rows.nth(0);
		await expect(incident).toContainText("Gateway 502 spike");
		await expect(incident).not.toContainText("Root cause analysis");
		await expect(incident).not.toContainText("Mitigation run");
		await expect(incident).toHaveAttribute("href", `/incidents/${INCIDENT_ID}`);
		await expect(incident).toHaveAttribute("data-id", id(401));
		// The block shows its liveliest state: one of its threads is working.
		await expect(incident).toHaveAttribute("data-state", "working");
		await expect(page.getByTestId("thread-unit")).toHaveCount(0);
		await expect(page.getByTestId("thread-incident-chip")).toHaveCount(0);
		await expect(rows.nth(1)).toHaveAttribute("href", `/threads/${id(403)}`);
	});

	test("5. The sidebar's doors: New, Search, Threads, Automation, Services, Settings at the foot, and Operations only once alerts exist; c opens Home with Incident on; Ctrl Shift O opens Home", async ({
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
		await page.goto("/threads");
		const sidebar = page.getByTestId("sidebar");
		await expect(sidebar).toBeVisible();
		const doors: [string, RegExp][] = [
			["nav-new", /\/new$/],
			["nav-threads", /\/threads$/],
			["nav-automation", /\/automation$/],
			["nav-services", /\/services/],
			["nav-settings", /\/settings/],
		];
		for (const [door] of doors)
			await expect(sidebar.getByTestId(door)).toBeVisible();
		await expect(sidebar.getByTestId("nav-search")).toBeVisible();
		await expect(sidebar.getByTestId("nav-incidents")).toHaveCount(0);
		await expect(sidebar.getByTestId("nav-schedules")).toHaveCount(0);
		await expect(sidebar.getByTestId("nav-alerts")).toHaveCount(0);
		// Settings sits at the foot, below the list.
		const settingsBox = await sidebar.getByTestId("nav-settings").boundingBox();
		const listBox = await sidebar.getByTestId("thread-list").boundingBox();
		expect(settingsBox!.y).toBeGreaterThan(listBox!.y);
		await expect(sidebar.getByTestId("nav-threads")).toHaveAttribute(
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

		// `c` opens Home with Incident on
		await expect(page.getByTestId("thread-list")).toBeVisible();
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
			page.getByTestId("thread-row").locator("span[dir=auto]"),
		).toHaveText(xss);
		await page.getByTestId("nav-threads").click();
		await expect(
			page.getByTestId("threads-page").getByTestId("thread-row"),
		).toContainText(xss);
		await expect(page.locator("img[src='x']")).toHaveCount(0);
		expect(dialogFired).toBe(false);
	});
});
