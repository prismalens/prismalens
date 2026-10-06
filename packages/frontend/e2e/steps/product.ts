// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * What the @pr2 journeys do to the product to set a scene: services, alerts
 * through the real webhook, acknowledgements and Resolve through the API the
 * UI calls. Nothing here writes to the database.
 */

import { expect, type Locator, type Page } from "@playwright/test";
import type { FakeAlertmanager } from "../../../../scripts/fakes/fake-alertmanager.mjs";

export interface Made {
	id: string;
	number: number;
	title: string;
	labels: Record<string, string>;
}

export interface Detail {
	id: string;
	number: number;
	title: string;
	status: string;
	actualCause: string | null;
	createdAt: string;
	alerts?: { id: string; status: string }[];
	investigations?: {
		id: string;
		status: string;
		createdAt: string;
		lastEventAt?: string | null;
		rootCause?: string | null;
	}[];
	refiredAs?: { id: string; number: number; createdAt: string } | null;
	priorIncidentId?: string | null;
}

export async function waitFor<T>(
	read: () => Promise<T | undefined>,
	what: string,
	timeout = 20_000,
): Promise<T> {
	let found: T | undefined;
	await expect
		.poll(
			async () => {
				found = await read();
				return found !== undefined;
			},
			{ timeout, message: `waiting for ${what}` },
		)
		.toBe(true);
	return found as T;
}

async function json<T>(res: {
	ok(): boolean;
	status(): number;
	text(): Promise<string>;
	json(): Promise<unknown>;
}): Promise<T> {
	if (!res.ok()) throw new Error(`${res.status()}: ${await res.text()}`);
	return (await res.json()) as T;
}

/** A service by name, made through the API when it does not exist yet. */
export async function ensureService(
	page: Page,
	s: {
		name: string;
		displayName?: string;
		type?: string;
		tier?: string;
		team?: string;
		/** `never`: alerts on it start no run, so a scene can hold one still. */
		trigger?: "never" | "always";
	},
): Promise<string> {
	const found = await json<{ data: { id: string; name: string }[] }>(
		await page.request.get(
			`/api/services?search=${encodeURIComponent(s.name)}&limit=100`,
		),
	);
	const existing = found.data.find((x) => x.name === s.name);
	const body = {
		...(s.displayName ? { displayName: s.displayName } : {}),
		...(s.type ? { type: s.type } : {}),
		...(s.tier ? { tier: s.tier } : {}),
		...(s.team ? { team: s.team } : {}),
		...(s.trigger
			? { metadata: { investigation: { trigger: s.trigger } } }
			: {}),
	};
	if (existing) {
		if (Object.keys(body).length)
			await json(
				await page.request.patch(`/api/services/${existing.id}`, {
					data: body,
				}),
			);
		return existing.id;
	}
	const made = await json<{ id: string }>(
		await page.request.post("/api/services", {
			data: { name: s.name, ...body },
		}),
	);
	return made.id;
}

/** The service whose alerts start no run: a scene that must hold still. */
export const QUIET = { name: "pr2-quiet", displayName: "Quiet API" } as const;
/** The service whose alerts start a run on their own, any severity. */
export const LIVE = {
	name: "booklogr-api",
	displayName: "Booklogr API",
} as const;

export async function incidentByTitle(
	page: Page,
	title: string,
): Promise<Made & { status: string }> {
	return waitFor(async () => {
		const { data } = await json<{
			data: { id: string; number: number; title: string; status: string }[];
		}>(await page.request.get("/api/incidents?limit=100"));
		const i = data.find((x) => x.title === title);
		return i ? { ...i, labels: {} } : undefined;
	}, `an incident titled ${title}`);
}

/**
 * Fires one alert through the real webhook and waits for its incident.
 * `session` picks the fake agent's script for the run it starts.
 */
export async function fireIncident(
	page: Page,
	am: FakeAlertmanager,
	deliver: (only?: string[]) => Promise<void>,
	o: {
		name: string;
		service: { name: string; displayName: string };
		severity?: string;
		session?: "live" | "success" | "failure";
		quiet?: boolean;
	},
): Promise<Made> {
	await ensureService(page, {
		...o.service,
		trigger: o.quiet ? "never" : "always",
	});
	const labels = {
		alertname: o.name,
		severity: o.severity ?? "critical",
		service: o.service.name,
	};
	const listed = am.fire({
		labels,
		annotations: o.session ? { summary: `fake-session:${o.session}` } : {},
	});
	// Only this alert: re-sending earlier ones would refire alerts a scene resolved.
	await deliver([listed.fingerprint]);
	const made = await incidentByTitle(page, o.name);
	return { ...made, labels };
}

export async function detail(page: Page, id: string): Promise<Detail> {
	return json<Detail>(await page.request.get(`/api/incidents/${id}`));
}

/** Waits until the incident's newest run satisfies `ok`. */
export async function waitForRun(
	page: Page,
	id: string,
	ok: (run: NonNullable<Detail["investigations"]>[number]) => boolean,
	what: string,
) {
	return waitFor(async () => {
		const run = (await detail(page, id)).investigations?.[0];
		return run && ok(run) ? run : undefined;
	}, what);
}

export async function acknowledge(page: Page, id: string) {
	await json(
		await page.request.patch(`/api/incidents/${id}`, {
			data: { status: "investigating" },
		}),
	);
}

export async function resolveIncident(
	page: Page,
	id: string,
	cause?: { actualCause?: string; actualCauseCategory?: string },
) {
	await json(
		await page.request.post(`/api/incidents/${id}/close`, {
			data: cause ?? {},
		}),
	);
}

export async function reopen(page: Page, id: string) {
	await json(
		await page.request.patch(`/api/incidents/${id}`, {
			data: { status: "investigating" },
		}),
	);
}

/** The board card for a title, inside `scope` (the page or a column). */
export const cardOf = (scope: Page | Locator, title: string) => {
	const page = "goto" in scope ? scope : scope.page();
	return scope.getByTestId("board-card").filter({
		has: page.getByTestId("card-title").getByText(title, { exact: true }),
	});
};

/**
 * A cold page on the dev server fetches ~350 modules before the route renders:
 * about 2 s here, past 5 s on a loaded CI runner (#786), so first paint gets longer.
 */
export const FIRST_PAINT = { timeout: 15_000 };

/** The frame each route paints first; the first match wins. */
const FRAMES: [RegExp, string][] = [
	[/^\/incidents\/[^/?]+/, "incident-record-frame"],
	[/^\/(incidents)?(\?|$)/, "incidents-frame"],
	[/^\/alerts/, "alerts-frame"],
	[/^\/settings(\?|$)/, "settings-frame"],
	[/^\/services\/[^/?]+/, "service-page"],
	[/^\/services/, "services-page"],
];

/** Waits out a cold page's first paint: the route's frame, or `frame` for a page FRAMES lacks. */
export async function firstPaint(target: Page, frame?: string) {
	const path = new URL(target.url()).pathname + new URL(target.url()).search;
	const testId = frame ?? FRAMES.find(([re]) => re.test(path))?.[1];
	if (!testId) throw new Error(`no first-paint frame for ${path}`);
	await expect(target.getByTestId(testId)).toBeVisible(FIRST_PAINT);
}

/** Opens `path` and waits for its first paint. */
export async function visit(target: Page, path: string, frame?: string) {
	await target.goto(path);
	await firstPaint(target, frame);
}

export async function openBoard(page: Page) {
	await visit(page, "/incidents");
	await expect(page.getByTestId("incident-board")).toBeVisible();
}

/** The page's horizontal overflow in px; 0 when nothing scrolls sideways. */
export async function sidewaysOverflow(page: Page): Promise<number> {
	return page.evaluate(
		() =>
			document.documentElement.scrollWidth -
			document.documentElement.clientWidth,
	);
}

/** A box that held still for 300 ms: the setup line can land after the board and push every card down. */
async function settledBox(page: Page, l: Locator) {
	let last = await l.boundingBox();
	for (let i = 0; i < 20; i++) {
		await page.waitForTimeout(300);
		const now = await l.boundingBox();
		if (now && now.x === last?.x && now.y === last?.y) return now;
		last = now;
	}
	throw new Error("the card never held still");
}

/** Drags with the mouse in steps, the way dnd-kit's pointer sensor needs. */
export async function drag(page: Page, from: Locator, to: Locator) {
	const a = await settledBox(page, from);
	const b = await settledBox(page, to);
	if (!a || !b) throw new Error("nothing to drag or nowhere to drop");
	await page.mouse.move(a.x + a.width / 2, a.y + 12);
	await page.mouse.down();
	await page.mouse.move(a.x + a.width / 2 + 10, a.y + 20, { steps: 4 });
	await page.mouse.move(b.x + b.width / 2, b.y + 40, { steps: 12 });
	await page.mouse.move(b.x + b.width / 2 + 2, b.y + 42, { steps: 2 });
	await page.mouse.up();
}
