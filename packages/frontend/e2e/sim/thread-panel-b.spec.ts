// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { readSim } from "../bar/bar";

/**
 * #1176 PR B's proof (spec §8.3) on a packed sim with the PR checks fixture: the open-with
 * split, project scripts, the detached branch row and its action, the incident panel toggle,
 * phone width, and no render loop after a send. Each state is screenshotted.
 */
const SIM_DIR = resolve(process.env.BAR_SIM_DIR ?? "../../.sim");
const SHOTS = resolve(process.env.B_SHOTS ?? "test-results/thread-panel-b");
const sim = readSim(SIM_DIR);
const LOOP = /#185|Maximum update depth/;

test.describe.configure({ mode: "serial" });

const shot = (page: Page, n: string, state: string) =>
	page.screenshot({ path: `${SHOTS}/b-${n}-${state}.png` });

type Json = Record<string, unknown>;
async function api<T = Json>(
	page: Page,
	path: string,
	init: { method?: string; data?: unknown } = {},
): Promise<T> {
	const res = await page.request.fetch(`${sim.url}/api${path}`, {
		method: init.method ?? "GET",
		headers: { origin: sim.url, "sec-fetch-site": "same-origin" },
		...(init.data === undefined ? {} : { data: init.data }),
	});
	expect(res.status(), `${init.method ?? "GET"} ${path}`).toBeLessThan(300);
	const text = await res.text();
	return (text ? JSON.parse(text) : {}) as T;
}

interface Script {
	runner: string;
	id?: string;
	name: string;
	command: string;
}
interface Repo {
	name: string;
	head: string;
	tip?: string;
	detached?: boolean;
	pushable?: boolean;
}
interface Ctx {
	kind: string;
	machine: { os: string; isHost: boolean; isOwner?: boolean };
	workspace: { cwd: string; repos: Repo[]; suggestedBranch?: string } | null;
	project?: { id: string };
	scripts?: Script[];
}
type Editors = { editors: { id: string; label: string }[] };

const fixture = { thread: "", incidentThread: "", incident: "", project: "" };

test.beforeAll(async ({ browser }) => {
	mkdirSync(SHOTS, { recursive: true });
	const page = await browser.newPage();
	const list = await api<{
		data: { id: string; title: string | null; incidentId: string | null }[];
	}>(page, "/investigations?limit=100");
	const incidents = await api<{ data: { id: string; title: string }[] }>(
		page,
		"/incidents?limit=100",
	);
	const thread = list.data.find((r) => r.title === "Fix the slow orders query");
	const incident = incidents.data.find(
		(i) => i.title === "Checkout 502s after the orders index was dropped",
	);
	const incidentThread = list.data.find((r) => r.incidentId === incident?.id);
	expect(thread?.id, "the PR checks fixture's project thread").toMatch(
		/^[0-9a-f-]{36}$/,
	);
	expect(incidentThread?.id, "the fixture's incident thread").toMatch(
		/^[0-9a-f-]{36}$/,
	);
	fixture.thread = thread?.id ?? "";
	fixture.incidentThread = incidentThread?.id ?? "";
	fixture.incident = incident?.id ?? "";
	const ctx = await api<Ctx>(page, `/threads/${fixture.thread}/context`);
	fixture.project = ctx.project?.id ?? "";
	// A rerun starts from the fixture's one stored script.
	for (const s of ctx.scripts ?? [])
		if (s.id && s.name !== "check")
			await api(page, `/repositories/${fixture.project}/scripts/${s.id}`, {
				method: "DELETE",
			});
	await page.close();
});

const context = (page: Page) =>
	api<Ctx>(page, `/threads/${fixture.thread}/context`);
const scriptsOf = async (page: Page) =>
	(
		await api<{ scripts: Script[] }>(
			page,
			`/repositories/${fixture.project}/scripts`,
		)
	).scripts;
const OS_WORD: Record<string, string> = {
	windows: "File Explorer",
	macos: "Finder",
	linux: "Files",
	other: "Files",
};

async function openThread(page: Page, panel?: string) {
	await page.goto(
		`${sim.url}/threads/${fixture.thread}${panel ? `?panel=${panel}` : ""}`,
	);
	await expect(page.getByTestId("transcript")).toBeVisible({
		timeout: 30_000,
	});
}

test("B1: the folder split lists the installed editors, the OS word and Terminal, the default ticked", async ({
	page,
}) => {
	const [{ editors }, saved, ctx] = await Promise.all([
		api<Editors>(page, "/settings/editors"),
		api<{ editor: string }>(page, "/settings/thread-context"),
		context(page),
	]);
	await openThread(page);
	await page.getByTestId("details-open-with").first().click();
	const menu = page.getByRole("menu");
	const os = OS_WORD[ctx.machine.os] ?? "Files";
	// The editors arrive with the split's own read; the open menu takes them in when they do.
	await expect
		.poll(async () =>
			(await menu.getByRole("menuitem").allInnerTexts())
				.map((t) => t.trim())
				.slice(0, editors.length + 2),
		)
		.toEqual([...editors.map((e) => e.label), os, "Terminal"]);
	const def = editors.some((e) => e.id === saved.editor)
		? saved.editor
		: "system";
	await expect(
		menu.getByTestId(`menu-openIn.${def}`).getByLabel("On"),
	).toBeVisible();
	await expect(menu.getByLabel("On")).toHaveCount(1);
	await shot(page, "01", "open-with");
});

test("B2: picking an editor opens the folder there; only the owner's pick becomes the default", async ({
	page,
}) => {
	const [{ editors }, before, ctx] = await Promise.all([
		api<Editors>(page, "/settings/editors"),
		api<{ prStatus: boolean; editor: string }>(
			page,
			"/settings/thread-context",
		),
		context(page),
	]);
	const choices = [
		...editors,
		{ id: "system", label: OS_WORD[ctx.machine.os] ?? "Files" },
	];
	const pick = choices.find((e) => e.id !== before.editor) ?? choices[0];
	const sent: string[] = [];
	await page.route("**/api/run-workspaces/*/open-in-editor", async (route) => {
		sent.push((route.request().postDataJSON() as { editor: string }).editor);
		await route.fulfill({ json: { opened: true, editor: pick?.id } });
	});
	await openThread(page);
	await page.getByTestId("details-open-with").first().click();
	await page.getByTestId(`menu-openIn.${pick?.id}`).click();
	await expect.poll(() => sent).toEqual([pick?.id]);
	// The owner's pick saves and relabels the split; anyone else's opens without saving.
	const owner = !!ctx.machine.isOwner;
	const kept = choices.find((e) => e.id === before.editor) ?? choices.at(-1);
	const shown = owner ? pick : kept;
	await expect
		.poll(
			async () =>
				(await api<{ editor: string }>(page, "/settings/thread-context"))
					.editor,
		)
		.toBe(owner ? pick?.id : before.editor);
	// The default the menu ticks is the saved one, in either form of the opener.
	await page.getByTestId("details-open-with").first().click();
	await expect(
		page.getByTestId(`menu-openIn.${shown?.id}`).getByLabel("On"),
	).toBeVisible();
	await expect(page.getByTestId("menu-ownerDefault")).toHaveCount(
		owner ? 0 : 1,
	);
	await shot(page, "02", "default");
	await api(page, "/settings/thread-context", { method: "PUT", data: before });
});

test("B3: Add script stores a custom script before the detected ones, and Run stages it", async ({
	page,
}) => {
	await openThread(page, "kind");
	await page.getByTestId("script-add").click();
	await page.getByTestId("script-name").fill("seed");
	await page.getByTestId("script-command").fill("pnpm db:seed");
	await page.getByTestId("script-save").click();
	await expect(page.getByTestId("script-dialog")).toHaveCount(0);
	const scripts = await scriptsOf(page);
	const stored = scripts.filter((s) => s.runner === "custom");
	expect(stored.map((s) => s.name)).toEqual(["check", "seed"]);
	expect(scripts.slice(0, 2)).toEqual(stored);
	expect((await context(page)).scripts?.slice(0, 2)).toEqual(stored);
	expect(stored[1]).toMatchObject({
		runner: "custom",
		name: "seed",
		command: "pnpm db:seed",
	});
	const row = page
		.getByTestId("script-row")
		.filter({ hasText: "pnpm db:seed" });
	await expect(row).toHaveAttribute("data-runner", "custom");
	await row.getByTestId("run-in-terminal").click();
	await expect(page.locator("[data-testid=terminal-draft] input")).toHaveValue(
		"pnpm db:seed",
	);
	await shot(page, "03", "script-added");
});

test("B4: Edit and Remove change the stored script", async ({ page }) => {
	await openThread(page, "kind");
	await page
		.getByTestId("script-row")
		.filter({ hasText: "pnpm db:seed" })
		.getByTestId("script-edit")
		.click();
	await page.getByTestId("script-command").fill("pnpm db:seed --force");
	await page.getByTestId("script-save").click();
	await expect
		.poll(
			async () =>
				(await scriptsOf(page)).find((s) => s.name === "seed")?.command,
		)
		.toBe("pnpm db:seed --force");
	await shot(page, "04", "script-edit");
	await page
		.getByTestId("script-row")
		.filter({ hasText: "pnpm db:seed --force" })
		.getByTestId("script-remove-open")
		.click();
	await page.getByTestId("script-remove").click();
	await expect
		.poll(async () =>
			(await scriptsOf(page))
				.filter((s) => s.runner === "custom")
				.map((s) => s.name),
		)
		.toEqual(["check"]);
	await expect(
		page.getByTestId("script-row").filter({ hasText: "pnpm db:seed" }),
	).toHaveCount(0);
	await shot(page, "04", "script-removed");
});

test("B5: a control character in the command is an inline error and sends nothing", async ({
	page,
}) => {
	const writes: string[] = [];
	page.on("request", (r) => {
		if (r.method() !== "GET" && r.url().includes("/scripts"))
			writes.push(r.url());
	});
	await openThread(page, "kind");
	await page.getByTestId("script-add").click();
	await page.getByTestId("script-name").fill("bell");
	await page.getByTestId("script-command").fill("echo a\u0007b");
	await page.getByTestId("script-save").click();
	await expect(page.getByTestId("script-command-error")).toHaveText(
		"One line, no control characters",
	);
	await shot(page, "05", "script-invalid");
	expect(writes).toEqual([]);
});

test("B6: a commit on the detached worktree shows its tip and offers a branch that pushes", async ({
	page,
}) => {
	const before = await context(page);
	execFileSync(
		"git",
		[
			"-c",
			"user.name=proof",
			"-c",
			"user.email=proof@example.invalid",
			"commit",
			"--allow-empty",
			"-qam",
			"Sort the orders query by date",
		],
		{ cwd: before.workspace?.cwd ?? "" },
	);
	const ctx = await context(page);
	const repo = ctx.workspace?.repos[0];
	const branch = ctx.workspace?.suggestedBranch ?? "";
	expect(repo?.detached).toBe(true);
	expect(repo?.pushable).toBe(true);
	expect(repo?.tip).toMatch(/^[0-9a-f]{40}$/);
	expect(repo?.tip).not.toBe(repo?.head);
	// The title as a short slug and six characters of the thread's id, at most 50 long.
	expect(branch).toBe(
		`prismalens/fix-the-slow-orders-query-${fixture.thread.slice(0, 6)}`,
	);
	expect(branch.length).toBeLessThanOrEqual(50);
	await openThread(page);
	await expect(page.getByTestId("details-detached").first()).toHaveText(
		`Detached at ${repo?.tip?.slice(0, 7)}`,
	);
	const action = page.getByTestId("details-git-action").first();
	await expect(action).toHaveAttribute("data-action", "branchAndPush");
	await expect(action).toHaveText("Create branch and push");
	await action.click();
	const box = page.getByTestId("composer-input").first();
	await expect(box).toContainText(`git switch -c ${branch}`);
	await expect(box).toContainText(`git push -u origin ${branch}`);
	await shot(page, "06", "detached");
	// The docked box gives the place name its whole width; the split folds to an icon first.
	const place = page.getByTestId("details-place-name").first();
	const fit = await place.evaluate((el) => {
		const box = el.parentElement as HTMLElement;
		return { scroll: box.scrollWidth, client: box.clientWidth };
	});
	expect(fit.scroll).toBeLessThanOrEqual(fit.client);
	// This name needs the room, so the openers fold into one button naming the default.
	await expect(page.getByTestId("details-open-with").first()).toHaveAttribute(
		"aria-label",
		/^Open with \(.+ by default\)$/,
	);
	await page
		.getByTestId("details-place")
		.first()
		.screenshot({ path: `${SHOTS}/b-06-docked-place.png` });
});

test("B7: the incident conversation page has a visible panel toggle that opens the panel", async ({
	page,
}) => {
	await page.goto(
		`${sim.url}/incidents/${fixture.incident}/conversation?investigation=${fixture.incidentThread}`,
	);
	const toggle = page
		.getByTestId("incident-header")
		.getByTestId("panel-toggle");
	await expect(toggle).toBeVisible();
	await expect(toggle).toHaveAttribute("aria-expanded", "false");
	await toggle.click();
	await expect(page.getByTestId("thread-panel")).toBeVisible();
	await expect(toggle).toHaveAttribute("aria-expanded", "true");
	await shot(page, "07", "incident-toggle");
});

test("B8: at phone width the incident toggle and the open-with split stay reachable", async ({
	page,
}) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto(
		`${sim.url}/incidents/${fixture.incident}/conversation?investigation=${fixture.incidentThread}`,
	);
	await expect(
		page.getByTestId("incident-header").getByTestId("panel-toggle"),
	).toBeInViewport();
	await shot(page, "08", "phone-incident");
	await openThread(page);
	// A phone carries the box behind the header's Details button (#1101 cat 21).
	await page.getByRole("button", { name: "Details" }).first().click();
	const chevron = page.getByTestId("details-open-with").first();
	await chevron.scrollIntoViewIfNeeded();
	await expect(chevron).toBeInViewport();
	await chevron.click();
	await expect(page.getByTestId("menu-openIn.system")).toBeVisible();
	await shot(page, "08", "phone");
});

test("B9: a send from Home and from a project never loops a render", async ({
	page,
}) => {
	const seen: string[] = [];
	page.on("console", (m) => {
		if (LOOP.test(m.text())) seen.push(m.text());
	});
	page.on("pageerror", (e) => {
		if (LOOP.test(e.message)) seen.push(`${e.message}\n${e.stack ?? ""}`);
	});
	const send = async (scope: string, text: string) => {
		await page.getByTestId(scope).getByTestId("composer-input").fill(text);
		await page.getByTestId(scope).getByTestId("composer-send").click();
		await expect(page).toHaveURL(/\/threads\/[^/?]+/);
		await expect(page.getByTestId("transcript")).toBeVisible({
			timeout: 30_000,
		});
		await page.waitForTimeout(3_000);
	};
	// The panel open, as the walk had it, and in-app navigation between sends.
	await openThread(page);
	await page.goto(`${sim.url}/new`);
	for (let i = 0; i < 3; i++) {
		if (i > 0) await page.getByTestId("nav-new").click();
		await send("home", `Home send ${i + 1}: why is checkout slow`);
	}
	await page.goto(`${sim.url}/projects/${fixture.project}`);
	for (let i = 0; i < 3; i++) {
		if (i > 0)
			await page
				.getByRole("link", { name: "Back to the project" })
				.first()
				.click();
		await send("project-page", `Project send ${i + 1}: list the scripts`);
	}
	await shot(page, "09", "no-185");
	expect(seen).toEqual([]);
});
