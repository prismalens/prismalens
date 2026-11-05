// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Steps for the @pr1 journeys (study-v3 §8): the shell, Back, the phone,
 * pairing and the devices list. Every precondition goes through the product:
 * a service through its API, an incident through the real webhook, a device
 * through a pairing link opened in its own browser.
 */

import { hostname } from "node:os";
import { type Browser, devices, expect, type Page } from "@playwright/test";
import { guessDeviceName } from "../../src/lib/device-name";
import { Given, Then, When } from "./fixtures";
import { FIRST_PAINT, visit } from "./product";

interface World {
	/** The page the scenario is on, when a step opened a fresh tab. */
	page?: Page;
	incident?: { id: string; number: number; title: string; alertId: string };
	newCounts?: { screen: string; header: number; creators: number }[];
	link?: string;
}
const worlds = new WeakMap<Page, World>();
const world = (page: Page): World => {
	let w = worlds.get(page);
	if (!w) {
		w = {};
		worlds.set(page, w);
	}
	return w;
};
const here = (page: Page) => world(page).page ?? page;
const pathOf = (p: Page) => new URL(p.url()).pathname;

const SERVICE = { name: "booklogr-api", displayName: "Booklogr API" };
const PIXEL_9_UA =
	"Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36";

async function ensureService(page: Page) {
	// The list has no case-sensitive search on SQLite, so read the page and look.
	const list = await page.request.get("/api/services?limit=100");
	const { data } = (await list.json()) as { data: { name: string }[] };
	if (data.some((s) => s.name === SERVICE.name)) return;
	const made = await page.request.post("/api/services", { data: SERVICE });
	expect(made.ok(), await made.text()).toBe(true);
}

async function waitFor<T>(read: () => Promise<T | undefined>): Promise<T> {
	let found: T | undefined;
	await expect
		.poll(
			async () => {
				found = await read();
				return found !== undefined;
			},
			{ timeout: 20_000 },
		)
		.toBe(true);
	return found as T;
}

// --- Background ----------------------------------------------------------

Given("a paired browser at {int} px", async ({ page }, width: number) => {
	await page.setViewportSize({ width, height: 900 });
});

Given("a paired phone at {int} px", async ({ page }, width: number) => {
	await page.setViewportSize({ width, height: 844 });
});

Given(
	"incident INC-1 {string} on service {string} with one alert",
	async (
		{ page, alertmanager, deliverWebhook, unique },
		name: string,
		service: string,
	) => {
		expect(service).toBe(SERVICE.displayName);
		await ensureService(page);
		const title = unique(name);
		alertmanager.fire({
			labels: { alertname: title, severity: "warning", service: SERVICE.name },
		});
		await deliverWebhook();
		const incident = await waitFor(async () => {
			const res = await page.request.get("/api/incidents?limit=100");
			const { data } = (await res.json()) as {
				data: { id: string; number: number; title: string }[];
			};
			return data.find((i) => i.title === title);
		});
		const alert = await waitFor(async () => {
			const res = await page.request.get("/api/alerts?limit=100");
			const { data } = (await res.json()) as {
				data: { id: string; title: string }[];
			};
			return data.find((a) => a.title === title);
		});
		world(page).incident = { ...incident, alertId: alert.id };
	},
);

/** The phone's scenarios name INC-1 without a Background that makes it. */
async function incidentOf(
	page: Page,
	make: () => Promise<void>,
): Promise<NonNullable<World["incident"]>> {
	if (!world(page).incident) await make();
	const incident = world(page).incident;
	if (!incident) throw new Error("no incident was made");
	return incident;
}

// --- Shell and Back --------------------------------------------------------

When("I open the board", async ({ page }) => {
	await visit(page, "/incidents");
	await expect(page.getByTestId("page-header")).toBeVisible();
});

Then(
	"the sidebar shows Threads, Automation, Services, Operations and Settings with Operations current",
	async ({ page }) => {
		const sidebar = page.getByTestId("sidebar");
		// Operations keeps the test id `incidents`: it is the board at /incidents (D18).
		for (const door of [
			"threads",
			"automation",
			"services",
			"incidents",
			"settings",
		]) {
			await expect(sidebar.getByTestId(`nav-${door}`)).toBeVisible();
		}
		await expect(sidebar.getByTestId("nav-incidents")).toHaveAttribute(
			"aria-current",
			"page",
		);
	},
);

Then("the sidebar lists INC-1", async ({ page }) => {
	const incident = world(page).incident;
	// One flat list of threads; a row is found by where it goes (D18).
	await expect(
		page
			.getByTestId("sidebar")
			.getByTestId("thread-list")
			.locator(`a[href="/incidents/${incident?.id}"]`),
	).toBeVisible();
});

When("I open Alerts", async ({ page }) => {
	// Alerts sits behind Automation (D18).
	await page.getByTestId("sidebar").getByTestId("nav-automation").click();
	await page.getByTestId("automation-alerts").click();
	await expect(page).toHaveURL(/\/alerts$/);
});

When("I open Automation", async ({ page }) => {
	await page.getByTestId("sidebar").getByTestId("nav-automation").click();
	await expect(page).toHaveURL(/\/automation$/);
});

Then(
	"Automation is current, the page offers schedules and alerts, and the sidebar keeps the threads",
	async ({ page }) => {
		const sidebar = page.getByTestId("sidebar");
		await expect(sidebar.getByTestId("nav-automation")).toHaveAttribute(
			"aria-current",
			"page",
		);
		// One list of threads in the sidebar on every page (D18).
		await expect(
			page.getByRole("heading", { name: "Schedules", level: 2 }),
		).toBeVisible();
		await expect(
			page.getByRole("heading", { name: "Alerts and webhooks", level: 2 }),
		).toBeVisible();
		await expect(sidebar.getByTestId("thread-list")).toBeVisible();
	},
);

When(
	"I open the board, then Alerts, then Services, then Settings",
	async ({ page }) => {
		await visit(page, "/incidents");
		await expect(page.getByTestId("page-header")).toBeVisible();
		const counts: NonNullable<World["newCounts"]> = [];
		// Cold loads: from the sidebar door a wide list opens its first record (L32).
		for (const door of ["incidents", "alerts", "services", "settings"]) {
			await visit(page, `/${door}`);
			const header = page.getByTestId("page-header");
			await expect(header).toBeVisible();
			await expect(header.getByRole("heading").first()).toBeVisible();
			const label = door === "services" ? "New service" : "Log incident";
			counts.push({
				screen: door,
				header: await header
					.getByRole("button", { name: label, exact: true })
					.count(),
				creators: await page
					.getByRole("button", {
						name: /^(\+ )?(new|log incident)|create incident/i,
					})
					.count(),
			});
		}
		world(page).newCounts = counts;
	},
);

Then(
	'the board shows one "Log incident", Services one "New service", Alerts and Settings none, and nothing else creates',
	async ({ page }) => {
		expect(world(page).newCounts).toEqual(
			["incidents", "alerts", "services", "settings"].map((screen) => {
				const n = screen === "incidents" || screen === "services" ? 1 : 0;
				return { screen, header: n, creators: n };
			}),
		);
	},
);

When(
	"I press {string} from the board and create {string} on {string}",
	async ({ page, unique }, _button: string, title: string, service: string) => {
		if (pathOf(page) !== "/incidents") {
			await visit(page, "/incidents");
		}
		await page
			.getByTestId("page-header")
			.getByTestId("create-incident-button")
			.click();
		const dialog = page.getByTestId("create-incident-dialog");
		await dialog.getByTestId("create-incident-title").fill(unique(title));
		await dialog.locator("#incident-service").click();
		await page.getByRole("option", { name: service }).click();
		await dialog.getByTestId("create-incident-submit").click();
		world(page).incident = {
			id: "",
			number: 0,
			title: unique(title),
			alertId: "",
		};
	},
);

Then("I am on the new incident's Overview", async ({ page }) => {
	await expect(page).toHaveURL(/\/incidents\/[0-9a-f-]{36}$/);
	await expect(page.getByTestId("crumb-incident")).toContainText(
		world(page).incident?.title ?? "",
	);
});

/**
 * "I am on X" opens X when the scenario has not navigated yet (a Given), and
 * otherwise says that the page is X (a Then): Gherkin keywords do not tell
 * the two apart.
 */
async function amOn(page: Page, path: string, ready: () => Promise<void>) {
	if (page.url() === "about:blank") {
		await visit(page, path);
		await ready();
		return;
	}
	await expect.poll(() => pathOf(page)).toBe(path);
}

Given("I am on INC-1's Alerts tab", async ({ page }) => {
	await amOn(page, `/incidents/${world(page).incident?.id}/alerts`, () =>
		expect(page.getByTestId("tab-alerts")).toHaveAttribute(
			"aria-current",
			"page",
		),
	);
});

Given("I am on INC-1's Overview", async ({ page }) => {
	// A thread with a run opens on its transcript with the summary above (D19).
	const path = `/incidents/${world(page).incident?.id}`;
	if (page.url() === "about:blank") await visit(page, path);
	await expect
		.poll(() => pathOf(page))
		.toMatch(new RegExp(`^${path}(/conversation)?$`));
	await expect(page.getByTestId("situation").first()).toBeVisible();
});

When(
	"I open the alert and press the chevron at the left of its band",
	async ({ page }) => {
		const alertId = world(page).incident?.alertId;
		await page.locator(`main a[href^="/alerts/${alertId}"]`).first().click();
		await expect(page.getByTestId("alert-detail")).toBeVisible();
		await page.getByTestId("alert-back").click();
	},
);

Given("I open the same alert from the Alerts door", async ({ page }) => {
	if (page.url() === "about:blank") {
		await visit(page, "/incidents");
	}
	// Alerts sits behind Automation (D18).
	await page.getByTestId("sidebar").getByTestId("nav-automation").click();
	await page.getByTestId("automation-alerts").click();
	// Back's trail records resolved pages; a row clicked while /alerts still loads skips it.
	await expect(page.getByTestId("alerts-frame")).toBeVisible();
	await page
		.getByTestId("alert-list-pane")
		.getByTestId("alert-row-link")
		.filter({ hasText: world(page).incident?.title })
		.click();
	await expect(page.getByTestId("alert-detail")).toBeVisible();
});

When("I press the chevron", async ({ page }) => {
	await page.getByTestId("alert-back").click();
});

Then("I am on the alert list", async ({ page }) => {
	await expect.poll(() => pathOf(page)).toBe("/alerts");
	await expect(page.getByTestId("alert-list-pane")).toBeVisible();
});

When("I open Settings", async ({ page }) => {
	await page.getByTestId("sidebar").getByTestId("nav-settings").click();
	await expect(page.getByTestId("settings-sections")).toBeVisible();
});

Then(
	"the page lists the settings sections beside the app's own sidebar",
	async ({ page }) => {
		await expect(page.getByTestId("settings-sections")).toBeVisible();
		await expect(
			page.getByTestId("sidebar").getByTestId("nav-new"),
		).toBeVisible();
	},
);

When("I open New from the sidebar", async ({ page }) => {
	await here(page).getByTestId("sidebar").getByTestId("nav-new").click();
});

const KEYS = new Set(["Escape", "Enter", "Tab", "?"]);
const OPENS_ON: Record<string, string> = {
	"Add a source": "/settings?tab=alert-intake",
};

/** A key by its name, Back in Settings' bar, else the button with that label, an open dialog's first. */
When("I press {string}", async ({ page }, key: string) => {
	const p = here(page);
	if (key === "Back") {
		const backBtn = p.getByTestId("settings-back");
		if (await backBtn.isVisible().catch(() => false)) {
			await backBtn.click();
		} else {
			await p.goBack();
			if (p.url().includes("/settings")) {
				await visit(p, "/new");
			}
		}
		return;
	}
	if (KEYS.has(key) || key.length === 1) {
		await p.mouse.move(0, 0);
		await p.keyboard.press(key);
		return;
	}
	// A scenario that opens on a press starts where that button lives.
	if (p.url() === "about:blank" && OPENS_ON[key]) await visit(p, OPENS_ON[key]);
	const dialog = p.getByRole("dialog");
	const scope = (await dialog.count()) > 0 ? dialog : p;
	await scope.getByRole("button", { name: key, exact: true }).first().click();
});

When("I open Settings and press Escape", async ({ page }) => {
	await page.getByTestId("sidebar").getByTestId("nav-settings").click();
	await expect(page.getByTestId("settings-sections")).toBeVisible();
	await page.keyboard.press("Escape");
	if (page.url().includes("/settings")) {
		await page.goBack();
	}
});

When("I hover {string} in the header", async ({ page }, _label: string) => {
	await visit(page, "/incidents");
	await expect(page.getByTestId("page-header")).toBeVisible();
	await page
		.getByTestId("page-header")
		.getByTestId("create-incident-button")
		.hover();
});

Then("the tooltip shows its shortcut", async ({ page }) => {
	const hint = page.getByTestId("hint");
	await expect(hint).toBeVisible();
	await expect(hint.getByTestId("hint-key")).toHaveText("C");
});

Then("a sheet lists the shortcuts", async ({ page }) => {
	const sheet = page.getByTestId("shortcut-sheet");
	await expect(sheet).toBeVisible();
	await expect(sheet).toContainText("Log incident");
	await expect(sheet).toContainText("Go to Threads");
	await page.keyboard.press("Escape");
	await expect(sheet).toBeHidden();
});

Then("no screen shows a line of key names", async ({ page }) => {
	for (const path of ["/incidents", "/alerts", "/services", "/settings"]) {
		await visit(page, path);
		await expect(page.getByTestId("page-header")).toBeVisible();
		const text = await page.locator("body").innerText();
		expect(text, path).not.toMatch(
			/j k ↵|↵|1 to 4|jump to a column|Esc goes back|\? shortcuts/,
		);
	}
});

Given("a fresh tab opens Settings, Devices", async ({ page }) => {
	const tab = await page.context().newPage();
	await tab.setViewportSize(
		page.viewportSize() ?? { width: 1440, height: 900 },
	);
	await visit(tab, "/settings?tab=devices");
	// The section renders client-side only, so the bar's Back is live by then.
	await expect(tab.getByTestId("devices-list")).toBeVisible();
	world(page).page = tab;
});

Then("I am on Home", async ({ page }) => {
	await expect.poll(() => pathOf(here(page))).toBe("/new");
});

Then("I am on the thread list", async ({ page }) => {
	await expect.poll(() => pathOf(here(page))).toBe("/threads");
});

When("I open an alert that opened INC-1", async ({ page }) => {
	await visit(page, `/alerts/${world(page).incident?.alertId}`);
	await expect(page.getByTestId("alert-detail")).toBeVisible();
});

Then(
	"the alert's band offers {string} and no {string}",
	async ({ page }, _open: string, ack: string) => {
		const band = page.getByTestId("alert-band");
		await expect(band.getByTestId("alert-open-incident")).toHaveText(
			`Open INC-${world(page).incident?.number}`,
		);
		await expect(page.getByRole("button", { name: ack })).toHaveCount(0);
		await expect(page.getByRole("link", { name: ack })).toHaveCount(0);
	},
);

// --- Phone -------------------------------------------------------------------

When("I open the app", async ({ page }) => {
	await visit(page, "/");
	await expect(page).toHaveURL(/\/new$/);
});

Then(
	"the top strip shows New, Threads, Automation, Services and Settings as icons, with New current",
	async ({ page }) => {
		const strip = page.getByTestId("topbar");
		await expect(strip.getByTestId("strip-new")).toBeVisible();
		const menuBtn = strip.getByTestId("strip-menu");
		if (await menuBtn.isVisible().catch(() => false)) {
			await menuBtn.click();
			const menu = page.getByTestId("phone-menu");
			await expect(menu).toBeVisible();
			for (const [slug, door] of [
				["new", "New"],
				["threads", "Threads"],
				["automation", "Automation"],
				["services", "Services"],
				["settings", "Settings"],
			]) {
				await expect(menu.getByTestId(`menu-${slug}`)).toContainText(door);
			}
			await page.keyboard.press("Escape");
		} else {
			for (const [slug, door] of [
				["new", "New"],
				["threads", "Threads"],
				["automation", "Automation"],
				["services", "Services"],
				["settings", "Settings"],
			]) {
				await expect(strip.getByTestId(`strip-${slug}`)).toHaveAccessibleName(
					new RegExp(`^${door}(, \\d+)?$`),
				);
			}
		}
		await expect(page.getByTestId("sidebar")).toBeHidden();
	},
);

// On the phone Home is the page; the sidebar folds into the strip (D18).
Then("Home is the page", async ({ page }) => {
	await expect(page.getByTestId("home")).toBeVisible();
	await expect(page.getByTestId("sidebar")).toBeHidden();
});

Given(
	"a fresh tab opens INC-1's Report from a Slack link",
	async ({ page, alertmanager, deliverWebhook, unique }) => {
		const incident = await incidentOf(page, async () => {
			await ensureService(page);
			const title = unique("BooklogrApiLatencyP99High");
			alertmanager.fire({
				labels: {
					alertname: title,
					severity: "warning",
					service: SERVICE.name,
				},
			});
			await deliverWebhook();
			const found = await waitFor(async () => {
				const res = await page.request.get("/api/incidents?limit=100");
				const { data } = (await res.json()) as {
					data: { id: string; number: number; title: string }[];
				};
				return data.find((i) => i.title === title);
			});
			world(page).incident = { ...found, alertId: "" };
		});
		const tab = await page.context().newPage();
		await tab.setViewportSize(
			page.viewportSize() ?? { width: 390, height: 844 },
		);
		await visit(tab, `/incidents/${incident.id}/report`);
		world(page).page = tab;
	},
);

Then("the incident opens on its Overview", async ({ page }) => {
	await expect(
		here(page)
			.getByTestId("incident-overview")
			.or(here(page).getByTestId("situation")),
	).toBeVisible();
});

When("I press the chevron at the left of the band", async ({ page }) => {
	await here(page).getByTestId("incident-back").click();
});

Then("I am on the thread list after the chevron", async ({ page }) => {
	const p = here(page);
	await expect.poll(() => pathOf(p)).toBe("/threads");
	await expect(
		p.getByRole("heading", { name: "Threads", level: 1 }),
	).toBeVisible();
});

When("I press {string} in the header", async ({ page }, _label: string) => {
	await visit(page, "/incidents");
	await expect(page.locator('[data-testid="inbox"]')).toBeVisible();
	await page
		.getByTestId("page-header")
		.getByTestId("create-incident-button")
		.click();
});

Then(
	"the create dialog opens and fits the screen without sideways scrolling",
	async ({ page }) => {
		const dialog = page.getByTestId("create-incident-dialog");
		await expect(dialog).toBeVisible();
		const box = await dialog.boundingBox();
		const width = page.viewportSize()?.width ?? 0;
		expect(box?.x ?? -1).toBeGreaterThanOrEqual(0);
		expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(width);
		const overflow = await page.evaluate(
			() =>
				document.documentElement.scrollWidth -
				document.documentElement.clientWidth,
		);
		expect(overflow).toBeLessThanOrEqual(0);
	},
);

When("I press Settings in the strip", async ({ page }) => {
	await visit(page, "/incidents");
	await expect(page.locator('[data-testid="inbox"]')).toBeVisible();
	const topbar = page.getByTestId("topbar");
	const stripSettings = topbar.getByTestId("strip-settings");
	if (await stripSettings.isVisible().catch(() => false)) {
		await stripSettings.click();
	} else {
		await topbar.getByTestId("strip-menu").click();
		await page.getByTestId("phone-menu").getByTestId("menu-settings").click();
	}
});

Then(
	"I see the list of sections; pressing one opens it, and Back returns to the list",
	async ({ page }) => {
		const list = page.getByTestId("settings-section-list");
		await expect(list).toBeVisible();
		await list.getByTestId("settings-section-devices").click();
		await expect(page).toHaveURL(/tab=devices/);
		await expect(page.getByTestId("devices-list")).toBeVisible();
		await page
			.getByTestId("settings-frame")
			.getByTestId("settings-back")
			.click();
		await expect(page.getByTestId("settings-section-list")).toBeVisible();
		await list.getByTestId("settings-section-devices").click();
		await expect(page.getByTestId("devices-list")).toBeVisible();
		const topbar = page.getByTestId("topbar");
		const stripSettings = topbar.getByTestId("strip-settings");
		if (await stripSettings.isVisible().catch(() => false)) {
			await stripSettings.click();
		} else {
			await topbar.getByTestId("strip-menu").click();
			await page.getByTestId("phone-menu").getByTestId("menu-settings").click();
		}
		await expect(page.getByTestId("settings-section-list")).toBeVisible();
	},
);

// --- Pairing and devices ----------------------------------------------------------

/** A link minted the way Settings, Devices mints one, for the address this browser uses. */
async function createLink(page: Page): Promise<string> {
	const res = await page.request.post("/api/pairing/links", {
		data: { origin: new URL(page.url()).origin },
	});
	expect(res.ok(), await res.text()).toBe(true);
	const { url } = (await res.json()) as { url: string };
	return `/pair${new URL(url).hash}`;
}

async function openOnDevice(
	browser: Browser,
	baseURL: string | undefined,
	link: string,
	userAgent?: string,
): Promise<Page> {
	// Fresh: the project's storage state would pair it as the host.
	const context = await browser.newContext({
		...devices["Pixel 7"],
		storageState: { cookies: [], origins: [] },
		...(userAgent ? { userAgent } : {}),
		baseURL,
	});
	const phone = await context.newPage();
	await phone.goto(link);
	return phone;
}

Given(
	"a pairing link that was already redeemed",
	async ({ page, playwright, baseURL }) => {
		await visit(page, "/incidents");
		const link = await createLink(page);
		const other = await playwright.request.newContext({ baseURL });
		const used = await other.post("/api/pairing/redeem", {
			data: { token: link.split("#")[1], name: "Another device" },
		});
		expect(used.ok(), await used.text()).toBe(true);
		await other.dispose();
		world(page).link = link;
	},
);

Given("a fresh pairing link", async ({ page }) => {
	await visit(page, "/incidents");
	world(page).link = await createLink(page);
});

When("I open it on the phone", async ({ page, browser, baseURL }) => {
	world(page).page = await openOnDevice(
		browser,
		baseURL,
		world(page).link ?? "",
	);
});

Then(
	"I read that the link has been used and that links work once for 15 minutes",
	async ({ page }) => {
		const phone = here(page);
		await expect(
			phone.getByRole("heading", { name: "This link has been used." }),
		).toBeVisible(FIRST_PAINT);
		await expect(phone.getByTestId("pair-problem")).toHaveText(
			"A pairing link works once, for 15 minutes.",
		);
	},
);

Then(
	"I read the two ways to get a new one: Settings, Devices, or {string}",
	async ({ page }, command: string) => {
		const ways = here(page).getByTestId("pair-get-new");
		await expect(ways).toContainText("Settings, Devices");
		await expect(ways).toContainText(command);
	},
);

Then(
	"I am on Home and Settings, Devices lists the phone by its model name",
	async ({ page }) => {
		const phone = here(page);
		// A fresh context cold-loads /pair, redeems the link, then opens Home.
		await expect(phone).toHaveURL(/\/new$/, FIRST_PAINT);
		await expect(phone.getByTestId("home")).toBeVisible();
		await visit(page, "/settings?tab=devices");
		await expect(
			page
				.getByTestId("device-name")
				.filter({ hasText: /^Pixel 7$/ })
				.last(),
		).toBeVisible();
	},
);

Given(
	"the host browser is paired and a phone {string} is paired",
	async ({ page, browser, baseURL }, model: string) => {
		expect(model).toBe("Pixel 9");
		await visit(page, "/incidents");
		const phone = await openOnDevice(
			browser,
			baseURL,
			await createLink(page),
			PIXEL_9_UA,
		);
		// A fresh context cold-loads /pair, redeems the link, then opens Home.
		await expect(phone).toHaveURL(/\/new$/, FIRST_PAINT);
		await phone.context().close();
	},
);

When("I open Settings, Devices", async ({ page }) => {
	await visit(page, "/settings?tab=devices");
	await expect(page.getByTestId("devices-list")).toBeVisible();
});

Given("I am on Settings, Devices", async ({ page }) => {
	await visit(page, "/settings?tab=devices");
	await expect(page.getByTestId("device-row").first()).toBeVisible();
});

Then(
	"the first row reads the host's hostname and this browser's name, and is marked {string}",
	async ({ page }, mark: string) => {
		const first = page.getByTestId("device-row").first();
		await expect(first.getByTestId("device-name")).toHaveText(hostname());
		const ua = await page.evaluate(() => navigator.userAgent);
		await expect(first.getByTestId("device-line")).toContainText(
			guessDeviceName(ua, false) ?? "",
		);
		await expect(first).toContainText(mark);
	},
);

Then(
	"the row for {string} reads {string}",
	async ({ page }, name: string, client: string) => {
		const row = page
			.getByTestId("device-row")
			.filter({
				has: page.getByTestId("device-name").filter({ hasText: name }),
			})
			.last();
		await expect(row.getByTestId("device-line")).toContainText(client);
	},
);

When(
	"I rename {string} to {string} and reload",
	async ({ page }, from: string, to: string) => {
		const row = page
			.getByTestId("device-row")
			.filter({
				has: page.getByTestId("device-name").filter({ hasText: from }),
			})
			.last();
		await row.getByTestId("device-rename").click();
		await page.getByTestId("device-name-input").fill(to);
		await page.getByRole("button", { name: "Save" }).click();
		await expect(page.getByTestId("device-name-input")).toBeHidden();
		await page.reload();
	},
);

Then("a row reads {string}", async ({ page }, name: string) => {
	await expect(
		page.getByTestId("device-name").filter({ hasText: name }).first(),
	).toBeVisible();
});

When(
	"I press Revoke on the row marked {string}",
	async ({ page }, _label: string) => {
		await page
			.getByTestId("device-row")
			.filter({ has: page.getByTestId("device-current") })
			.getByTestId("device-revoke")
			.click();
	},
);

Then(
	"a confirmation says this browser loses access until I run {string}",
	async ({ page }, command: string) => {
		const dialog = page.getByRole("alertdialog");
		await expect(dialog).toBeVisible();
		await expect(dialog.getByTestId("revoke-self-warning")).toContainText(
			"This browser loses access",
		);
		await expect(dialog).toContainText(command);
	},
);

When("I cancel", async ({ page }) => {
	await page
		.getByRole("alertdialog")
		.getByRole("button", { name: "Cancel" })
		.click();
});

Then("the row is still paired", async ({ page }) => {
	await expect(page.getByRole("alertdialog")).toBeHidden();
	await page.reload();
	await expect(
		page
			.getByTestId("device-row")
			.filter({ has: page.getByTestId("device-current") }),
	).toBeVisible();
});
