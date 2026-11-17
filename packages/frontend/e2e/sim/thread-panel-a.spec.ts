// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { execFileSync, execSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
	type APIRequestContext,
	expect,
	type Page,
	request,
	test,
} from "@playwright/test";
import { readSim } from "../bar/bar";

/**
 * PR A's proof for #1176 (spec §8.2): fix threads, re-run, PR files, the Session rows and
 * the Started section, on a packed sim with the fake code host and the PR checks fixture.
 * Each row asserts with `expect` and saves its state to test-results/thread-panel-a/.
 */

const ROOT = resolve(import.meta.dirname, "../../../..");
const SIM_DIR = resolve(process.env.BAR_SIM_DIR ?? join(ROOT, ".sim"));
const STORAGE = resolve(
	process.env.BAR_OUT ?? "test-results/bar",
	"paired-state.json",
);
const SHOTS = resolve("test-results/thread-panel-a");
const HOST_LOG_GONE = "The git host did not answer; try again in a minute.";

const sim = readSim(SIM_DIR);
const simState = JSON.parse(
	readFileSync(join(SIM_DIR, "state.json"), "utf8"),
) as { workspace: string };

let api: APIRequestContext;
let thread = "";
let incidentThread = "";
const prs: Record<number, string> = {};
let fixChild = "";
let headSha = "";

const shot = async (page: Page, name: string) => {
	mkdirSync(SHOTS, { recursive: true });
	await page.screenshot({ path: join(SHOTS, `${name}.png`) });
};

async function call<T = unknown>(
	method: string,
	path: string,
	body?: unknown,
): Promise<{ status: number; json: T; text: string }> {
	const res = await api.fetch(`/api${path}`, {
		method,
		...(body === undefined ? {} : { data: body }),
	});
	const text = await res.text();
	let json = undefined as T;
	try {
		json = JSON.parse(text) as T;
	} catch {}
	return { status: res.status(), json, text };
}

async function ok<T>(method: string, path: string, body?: unknown) {
	const r = await call<T>(method, path, body);
	expect(r.status, `${method} ${path}: ${r.text.slice(0, 300)}`).toBeLessThan(
		300,
	);
	return r.json;
}

const fakeHost = (...args: string[]) =>
	execFileSync(
		process.execPath,
		[join(ROOT, "scripts/fakes/conditions/fake-code-host.mjs"), ...args],
		{
			encoding: "utf8",
			env: {
				...process.env,
				PRISMALENS_CONDITIONS_STATE: join(SIM_DIR, "conditions"),
			},
		},
	);
const reruns = () =>
	(JSON.parse(fakeHost("reruns")) as { count: number }).count;

interface Preview {
	title: string;
	items: { kind: string; ident: string; label: string }[];
	covered: { ident: string; link: { id: string } }[];
	text: string | null;
	evidence: string | null;
	digest: string | null;
	place: {
		projectName: string;
		own: boolean;
		push: string;
		pushUrl: string | null;
		pushNote: string | null;
		fetch: boolean;
		headSha: string;
	} | null;
	refusal: { reason: string; detail: string } | null;
}

const checks = (...runIds: string[]) =>
	runIds.map((runId) => ({ kind: "check", runId }));
const preview = (prId: string, items: unknown[], id = thread) =>
	ok<Preview>("POST", `/threads/${id}/pull-requests/${prId}/fix-preview`, {
		id,
		prId,
		items,
	});

interface Link {
	id: string;
	state: string;
	via?: string;
	fix?: { prId: string; headSha: string; items: { ident: string }[] };
}
interface Links {
	startedBy: (Link & { via: string }) | null;
	started: Link[];
	subagents?: { sessionId: string; state: string; title: string }[];
}
const links = (id = thread) => ok<Links>("GET", `/threads/${id}/links`);

/** Everything a thread's prompts sent its agent: every recorded turn input's parts. */
async function sentText(id: string): Promise<string> {
	const out: string[] = [];
	let cursor: number | null = null;
	do {
		const page: {
			events: { kind: string; inputId?: string }[];
			nextCursor: number | null;
		} = await ok<{
			events: { kind: string; inputId?: string }[];
			nextCursor: number | null;
		}>(
			"GET",
			`/investigations/${id}/events?limit=200${cursor === null ? "" : `&cursor=${cursor}`}`,
		);
		for (const e of page.events)
			if (e.kind === "turn_input" && e.inputId) {
				const input = await call<{
					parts: { type: string; text?: string }[];
				}>("GET", `/investigations/${id}/turn-inputs/${e.inputId}`);
				for (const p of input.json?.parts ?? []) if (p.text) out.push(p.text);
			}
		cursor = page.nextCursor;
	} while (cursor !== null);
	return out.join("\n");
}

async function waitSent(id: string, needle: string): Promise<string> {
	let text = "";
	await expect
		.poll(
			async () => {
				text = await sentText(id);
				return text.includes(needle);
			},
			{ timeout: 120_000 },
		)
		.toBe(true);
	return text;
}

/** Fails the first `n` matching requests with a 500, then lets the rest through. */
async function failFirst(page: Page, glob: string, n = 4) {
	let left = n;
	await page.route(glob, (route) =>
		left-- > 0
			? route.fulfill({ status: 500, body: '{"message":"injected"}' })
			: route.continue(),
	);
}

const prPath = (prId: string, id = thread) =>
	`/threads/${id}?panel=thread&section=pull-requests:${prId}`;

async function openPr(page: Page, prId: string, id = thread) {
	await page.goto(prPath(prId, id));
	await expect(page.getByTestId("pr-view")).toBeVisible();
}

/** A check row by its ident, opened so its actions show. */
async function checkRow(page: Page, ident: string) {
	const row = page.locator(
		`[data-testid="pr-check-run"][data-ident="${ident}"]`,
	);
	await expect(row).toBeVisible();
	const toggle = row.getByTestId("pr-check-toggle");
	if ((await toggle.getAttribute("aria-expanded")) === "false")
		await toggle.click();
	return row;
}

const ACTIONS_UNIT = "15368:1101:unit tests";
const OTHER_UNIT = "999:5501:unit tests";
const INTEGRATION = "15368:1102:integration";

test.describe
	.serial("thread panel, PR A (#1176)", () => {
		test.beforeAll(async () => {
			api = await request.newContext({
				baseURL: sim.url,
				storageState: STORAGE,
				extraHTTPHeaders: { origin: sim.url, "sec-fetch-site": "same-origin" },
			});
			fakeHost("mode", "ok");
			const out =
				process.env.FIXTURE_OUT ??
				execSync(
					`pnpm --silent --filter @prismalens/api fixture:pr-checks --url ${sim.url} --remote`,
					{
						cwd: ROOT,
						encoding: "utf8",
						env: {
							...process.env,
							PRISMALENS_WORKSPACE_DIR: simState.workspace,
						},
						timeout: 300_000,
					},
				);
			thread = /fixture: thread \/threads\/([\w-]+)/.exec(out)?.[1] ?? "";
			incidentThread =
				/fixture: incident thread \/threads\/([\w-]+)/.exec(out)?.[1] ?? "";
			expect(thread, out).not.toBe("");
			for (const id of [thread, incidentThread]) {
				const list = await ok<{
					pullRequests: { id: string; number: number; headSha?: string }[];
				}>("GET", `/threads/${id}/pull-requests`);
				for (const pr of list.pullRequests) prs[pr.number] = pr.id;
				headSha ||=
					list.pullRequests.find((p) => p.number === 412)?.headSha ?? "";
			}
			await ok("PUT", "/settings/thread-context", {
				prStatus: true,
				editor: "system",
				rerunChecks: false,
			});
		});

		test.afterAll(async () => {
			fakeHost("mode", "ok");
			await api?.dispose();
		});

		test("A1 Session rows read stored usage", async ({ page }) => {
			const ctx = await ok<{
				agent: { harness: string | null; model: string | null };
				session?: { how: string } | null;
			}>("GET", `/threads/${thread}/context`);
			await page.goto(`/threads/${thread}?panel=thread&section=machine`);
			const section = page.getByTestId("session-section");
			await expect(section).toBeVisible();
			await expect(page.getByTestId("session-row-context")).toContainText(
				"48K of 200K",
			);
			await expect(page.getByTestId("session-row-tokens")).toContainText(
				"2.2K, 3 turns",
			);
			await expect(page.getByTestId("session-row-cost")).toContainText(
				"0.15 USD + 1.00 EUR",
			);
			const how = ctx.session?.how;
			await expect(page.getByTestId("session-row-session")).toContainText(
				how === undefined || how === null
					? "Not recorded"
					: how === "resume" || how === "load"
						? "Same session"
						: "New session",
			);
			await expect(page.getByTestId("session-row-agent")).toBeVisible();
			// The Model row always shows: the thread's own model, or the agent's default.
			const modelRow = page.getByTestId("session-row-model");
			await expect(modelRow).toBeVisible();
			expect((await modelRow.innerText()).includes("Agent default")).toBe(
				!ctx.agent.model,
			);
			await section.scrollIntoViewIfNeeded();
			await shot(page, "a1-session");
		});

		test("A2 a failed context read says so and retries", async ({ page }) => {
			await failFirst(page, `**/api/threads/${thread}/context`);
			await page.goto(`/threads/${thread}?panel=thread`);
			const failed = page.getByTestId("details-failed");
			await expect(failed).toContainText("Details didn't load");
			await shot(page, "a2-context-failed");
			await failed.getByRole("button", { name: /Retry/ }).click();
			await expect(page.getByTestId("session-section")).toBeVisible();
		});

		test("A3 a failed links read says so and retries", async ({ page }) => {
			await failFirst(page, `**/api/threads/${thread}/links`);
			await page.goto(`/threads/${thread}?panel=thread`);
			const failed = page.getByTestId("threads-failed");
			await expect(failed).toContainText("Threads didn't load");
			await shot(page, "a3-links-failed");
			await failed.getByRole("button", { name: /Retry/ }).click();
			await expect(page.getByTestId("started-section")).toBeVisible();
		});

		test("A4 every failing check, the others line and the host remainder", async ({
			page,
		}) => {
			await openPr(page, prs[412] as string);
			const failing = page.locator(
				'[data-testid="pr-check-run"][data-state="failing"]',
			);
			await expect(failing).toHaveCount(4);
			expect(
				(
					await failing.evaluateAll((els) =>
						els.map((e) => e.getAttribute("data-name")),
					)
				).filter((n) => n === "unit tests"),
			).toHaveLength(2);
			await expect(page.getByTestId("pr-others-line")).toContainText(
				"140 other checks",
			);
			await page.getByTestId("pr-others-line").click();
			await expect(
				page.getByTestId("pr-others").getByTestId("pr-check-run"),
			).toHaveCount(7);
			await expect(page.getByTestId("pr-others-more")).toHaveText(
				"133 more on the host",
			);
			const cancelled = page.locator(
				'[data-testid="pr-check-run"][data-name="deploy preview"]',
			);
			await expect(cancelled.getByTestId("pr-check-cancelled")).toHaveText(
				"Cancelled",
			);
			const toggle = cancelled.getByTestId("pr-check-toggle");
			if ((await toggle.getAttribute("aria-expanded")) === "false")
				await toggle.click();
			await expect(cancelled.getByTestId("pr-fix-thread")).toHaveCount(0);
			// A cancelled run settles on its log or a no-log word, never an endless read.
			const tail = cancelled.getByTestId("pr-check-tail");
			await expect(tail).toBeVisible();
			await expect(tail).not.toContainText("Reading the log", {
				timeout: 30_000,
			});
			await shot(page, "a4-checks");
		});

		test("A5 a stored no-access refusal is read again, and a host failure is not kept", async ({
			page,
		}) => {
			const read = () =>
				ok<{ unavailable: string | null }>(
					"GET",
					`/threads/${thread}/pull-requests/${prs[412]}/checks/22/log`,
				);
			const first = await read();
			const second = await read();
			expect([first.unavailable, second.unavailable]).toEqual([
				HOST_LOG_GONE,
				HOST_LOG_GONE,
			]);
			await openPr(page, prs[412] as string);
			const row = await checkRow(page, INTEGRATION);
			await expect(row.getByTestId("pr-check-unavailable")).toBeVisible();
			await shot(page, "a5-reread");
		});

		test("A6 the preview shows exactly what Start sends", async ({ page }) => {
			const p = await preview(prs[412] as string, checks("2"));
			expect(p.refusal).toBeNull();
			expect(p.place?.push).toBe("branch");
			expect(p.place?.pushUrl).toBe("https://github.com/acme/shop.git");
			expect(p.evidence).toContain("<<<CHECK LOG");
			expect(p.text).not.toContain("unit tests");
			await openPr(page, prs[412] as string);
			const row = await checkRow(page, ACTIONS_UNIT);
			await row.getByTestId("pr-fix-thread").click();
			const dialog = page.getByTestId("fix-dialog");
			await expect(dialog.getByTestId("fix-text")).toBeVisible();
			// The agent reads in words: its name, model and access level, never a raw id.
			await expect(dialog.getByTestId("fix-place-agent")).toContainText(
				/OpenCode, (?!Agent default)[^,]+, (.+, )?Ask always/,
			);
			const shown = (await dialog.getByTestId("fix-text").innerText()).trim();
			expect(shown.replace(/\s+/g, " ")).toBe(
				(p.text ?? "").trim().replace(/\s+/g, " "),
			);
			await shot(page, "a6-preview");
		});

		test("A6b a push URL never shows its userinfo", async ({ page }) => {
			const own = (await preview(prs[412] as string, checks("2"))).place;
			const folder = join(simState.workspace, own?.projectName ?? "");
			const git = (...a: string[]) =>
				execFileSync("git", ["-C", folder, ...a], { encoding: "utf8" });
			git(
				"remote",
				"set-url",
				"origin",
				"https://x-access-token:s3cret@github.com/acme/shop.git",
			);
			try {
				const r = await call(
					"POST",
					`/threads/${thread}/pull-requests/${prs[412]}/fix-preview`,
					{ id: thread, prId: prs[412], items: checks("2") },
				);
				expect(r.status).toBe(200);
				expect(r.text).not.toContain("s3cret");
				expect(r.text).not.toContain("x-access-token");
				await page.setContent(
					`<pre style="white-space:pre-wrap;font:12px monospace">${r.text
						.slice(0, 4000)
						.replace(/</g, "&lt;")}</pre>`,
				);
				await shot(page, "a6b-userinfo");
			} finally {
				git("remote", "set-url", "origin", "https://github.com/acme/shop.git");
			}
			expect(git("remote", "get-url", "origin").trim()).toBe(
				"https://github.com/acme/shop.git",
			);
			// The server reads remotes through a 60 s cache: wait until it sees the restored origin.
			await expect
				.poll(
					async () => {
						const p = await preview(prs[412] as string, checks("2"));
						return `${p.place?.projectName}:${p.place?.fetch}`;
					},
					{ timeout: 90_000, intervals: [5_000] },
				)
				.toBe(`${own?.projectName}:false`);
		});

		test("A7 Start makes one fix thread, linked, sent exactly, at the head", async ({
			page,
		}) => {
			const p = await preview(prs[412] as string, checks("2"));
			await openPr(page, prs[412] as string);
			const row = await checkRow(page, ACTIONS_UNIT);
			await row.getByTestId("pr-fix-thread").click();
			const start = page.getByTestId("fix-start");
			await expect(start).toBeEnabled();
			const answered = page.waitForResponse((r) =>
				r.url().endsWith("/fix-thread"),
			);
			await start.click();
			const res = await answered;
			expect(res.status(), await res.text()).toBe(200);
			await page.waitForURL((u) => !u.pathname.endsWith(thread));
			fixChild = new URL(page.url()).pathname.split("/").pop() as string;
			const l = await links();
			const child = l.started.find((s) => s.id === fixChild);
			expect(child?.via).toBe("fix");
			expect(child?.fix?.items.map((i) => i.ident)).toContain(ACTIONS_UNIT);
			const sent = await waitSent(fixChild, "<<<CHECK LOG");
			expect(sent).toContain((p.text ?? "").split("\n")[0]);
			expect(sent).toContain((p.evidence ?? "").split("\n")[0]);
			let cwd = "";
			await expect
				.poll(
					async () => {
						const inv = await ok<{ workspace?: { cwd?: string } | null }>(
							"GET",
							`/investigations/${fixChild}`,
						);
						cwd = inv.workspace?.cwd ?? "";
						return cwd;
					},
					{ timeout: 120_000 },
				)
				.not.toBe("");
			expect(
				execFileSync("git", ["-C", cwd, "rev-parse", "HEAD"], {
					encoding: "utf8",
				}).trim(),
			).toBe(headSha);
			await shot(page, "a7-started");
		});

		test("A8 a same-named check on another app is its own item", async ({
			page,
		}) => {
			const p = await preview(prs[412] as string, checks("20"));
			expect(p.items).toHaveLength(1);
			expect(p.items[0]?.ident).toBe(OTHER_UNIT);
			expect(p.covered).toHaveLength(0);
			await openPr(page, prs[412] as string);
			const labels = (
				await page
					.locator(
						'[data-testid="pr-check-run"][data-state="failing"][data-name="unit tests"] [data-testid="pr-check-toggle"]',
					)
					.allInnerTexts()
			).map((t) => t.trim());
			expect(labels).toHaveLength(2);
			expect(new Set(labels).size).toBe(2);
			expect(labels.filter((t) => /^unit tests · \S/.test(t))).toEqual(labels);
			const row = await checkRow(page, OTHER_UNIT);
			await row.getByTestId("pr-fix-thread").click();
			await expect(page.getByTestId("fix-start")).toBeEnabled();
			await shot(page, "a8-same-name");
		});

		test("A9 a covered check goes to its thread", async ({ page }) => {
			const p = await preview(prs[412] as string, checks("2"));
			expect(p.items).toHaveLength(0);
			expect(p.covered[0]?.link.id).toBe(fixChild);
			await openPr(page, prs[412] as string);
			const row = await checkRow(page, ACTIONS_UNIT);
			const goTo = row.getByTestId("pr-fix-go-to");
			await expect(goTo).toBeVisible();
			await expect(goTo).toHaveAttribute("href", new RegExp(fixChild));
			await shot(page, "a9-go-to");
		});

		test("A10 a changed place refuses a stale Start", async ({ page }) => {
			const before = await preview(prs[412] as string, checks("20"));
			await openPr(page, prs[412] as string);
			const row = await checkRow(page, OTHER_UNIT);
			await row.getByTestId("pr-fix-thread").click();
			await expect(page.getByTestId("fix-start")).toBeEnabled();
			// The source's place changes under the open preview: its worktree moves onto the PR's
			// branch, so `own` (a field the digest binds) turns true.
			const inv = await ok<{ workspace?: { cwd?: string } | null }>(
				"GET",
				`/investigations/${thread}`,
			);
			const cwd = inv.workspace?.cwd ?? "";
			execFileSync("git", ["-C", cwd, "checkout", "-q", "--", "."]);
			execFileSync("git", ["-C", cwd, "switch", "-q", "fix/orders-index"]);
			const after = await preview(prs[412] as string, checks("20"));
			expect(after.place).toMatchObject({ own: true });
			expect(after.digest).not.toBe(before.digest);
			const stale = await call(
				"POST",
				`/threads/${thread}/pull-requests/${prs[412]}/fix-thread`,
				{
					id: thread,
					prId: prs[412],
					items: checks("20"),
					digest: before.digest,
				},
			);
			expect(stale.status).toBe(409);
			expect(stale.text).toContain("It changed; review again");
			await page.getByTestId("fix-start").click();
			await expect(page.getByTestId("fix-changed")).toHaveText(
				"It changed; review again",
			);
			await shot(page, "a10-conflict");
		});

		test("A11 a review comment's evidence is plain", async ({ page }) => {
			const p = await preview(prs[412] as string, [
				{ kind: "review", reviewThreadId: "rt3" },
			]);
			expect(p.refusal).toBeNull();
			const evidence = p.evidence ?? "";
			expect(
				["`&lt;Widget&gt;`", "Use orderBy createdAt", "Suggested fix"].filter(
					(s) => !evidence.includes(s),
				),
			).toEqual([]);
			expect(
				["<!--", "<picture", "<img"].filter((s) => evidence.includes(s)),
			).toEqual([]);
			await openPr(page, prs[412] as string);
			await page.getByTestId("pr-tab-reviews").click();
			const rt3 = page
				.locator('[data-testid="pr-review-thread"]')
				.filter({ hasText: "review-bot" });
			const open = rt3.getByTestId("pr-review-toggle");
			if ((await open.getAttribute("aria-expanded")) === "false")
				await open.click();
			await rt3.getByTestId("pr-fix-review-thread").click();
			await expect(page.getByTestId("fix-dialog")).toBeVisible();
			await shot(page, "a11-review");
		});

		test("A12 a batch fixes what no thread covers yet", async ({ page }) => {
			const p = await preview(prs[412] as string, checks("2", "20", "22"));
			expect(p.items.map((i) => i.ident).sort()).toEqual(
				[OTHER_UNIT, INTEGRATION].sort(),
			);
			expect(p.covered.map((c) => [c.ident, c.link.id])).toEqual([
				[ACTIONS_UNIT, fixChild],
			]);
			expect((p.text ?? "").length).toBeLessThanOrEqual(4000);
			await openPr(page, prs[412] as string);
			const batch = page.getByTestId("pr-fix-batch");
			await expect(batch).toHaveText("Fix 2 in one thread");
			await batch.click();
			await expect(page.getByTestId("fix-items")).toBeVisible();
			await shot(page, "a12-batch");
		});

		test("A13 a head commit the folder lacks is fetched first", async ({
			page,
		}) => {
			const p = await preview(prs[413] as string, checks("2"));
			expect(p.refusal).toBeNull();
			expect(p.place?.fetch).toBe(true);
			await openPr(page, prs[413] as string);
			const row = await checkRow(page, ACTIONS_UNIT);
			await row.getByTestId("pr-fix-thread").click();
			await expect(page.getByTestId("fix-place-fetch")).toContainText(
				"Fetches fix/",
			);
			await shot(page, "a13-fetch");
		});

		test("A14 an unsafe branch name never reaches the message", async ({
			page,
		}) => {
			const p = await preview(prs[414] as string, checks("2"));
			expect(p.place?.push).toBe("none");
			expect(p.place?.pushNote).toBe("unsafe-ref");
			expect(p.text).not.toContain("$(");
			await openPr(page, prs[414] as string);
			const row = await checkRow(page, ACTIONS_UNIT);
			await row.getByTestId("pr-fix-thread").click();
			await expect(page.getByTestId("fix-place-push")).toBeVisible();
			await shot(page, "a14-unsafe-ref");
		});

		test("A15 a fork and a side question carry the conversation", async ({
			page,
		}) => {
			const fp = await ok<{ carried: string; omitted: string | null }>(
				"GET",
				`/threads/${thread}/fork-preview`,
			);
			expect(fp.carried.toLowerCase()).not.toContain("alert");
			await page.goto(`/threads/${thread}`);
			await page.locator('[data-testid="thread-menu"]:visible').first().click();
			await page.getByRole("menuitem", { name: /Fork here/ }).click();
			await expect(page.getByTestId("carry-line")).toContainText(
				`Carries ${fp.carried}`,
			);
			await shot(page, "a15-fork");
			const child = async (mode: "fork" | "side") => {
				const started = await ok<{ investigationId: string }>(
					"POST",
					`/threads/${thread}/fork`,
					{ id: thread, mode, text: `A ${mode} from the fixture thread.` },
				);
				const id = started.investigationId;
				const sent = await waitSent(id, "<<<PREVIOUS SESSION");
				return {
					via: (await links(id)).startedBy?.via,
					handoffFile: sent.includes(".prismalens-handoff"),
				};
			};
			expect([await child("fork"), await child("side")]).toEqual([
				{ via: "fork", handoffFile: false },
				{ via: "side", handoffFile: false },
			]);
		});

		test("A16 Re-run is off by default, with why", async ({ page }) => {
			await openPr(page, prs[412] as string);
			const row = await checkRow(page, ACTIONS_UNIT);
			const button = row.getByTestId("rerun-button");
			await expect(button).toBeDisabled();
			await expect(button).toHaveAttribute("data-blocked", "Re-run is off");
			await button.hover({ force: true });
			await shot(page, "a16-rerun-off");
		});

		test("A16b a check whose workflow still runs waits", async ({ page }) => {
			await openPr(page, prs[412] as string);
			const row = await checkRow(page, INTEGRATION);
			const button = row.getByTestId("rerun-button");
			await expect(button).toBeDisabled();
			await expect(button).toHaveAttribute(
				"data-blocked",
				"Its workflow is still running",
			);
			await button.hover({ force: true });
			await shot(page, "a16b-rerun-wait");
		});

		/** Confirms a re-run of the Actions unit tests and returns the confirm key it sent. */
		async function rerun(page: Page): Promise<string> {
			const sent = page.waitForRequest(
				(r) => r.method() === "POST" && /\/checks\/2\/rerun$/.test(r.url()),
			);
			await page.getByTestId("rerun-confirm").click();
			const body = (await sent).postDataJSON() as { confirmKey: string };
			return body.confirmKey;
		}

		test("A17 a confirmed re-run posts once, and its retry posts nothing", async ({
			page,
		}) => {
			await ok("PUT", "/settings/thread-context", {
				prStatus: true,
				editor: "system",
				rerunChecks: true,
			});
			const before = reruns();
			await openPr(page, prs[412] as string);
			const row = await checkRow(page, ACTIONS_UNIT);
			await row.getByTestId("rerun-button").click();
			await expect(page.getByTestId("rerun-dialog")).toBeVisible();
			const key = await rerun(page);
			await expect(row.getByTestId("rerun-status")).toHaveAttribute(
				"data-state",
				"ok",
			);
			expect(reruns()).toBe(before + 1);
			const again = await ok<{ ok: boolean; already?: boolean }>(
				"POST",
				`/threads/${thread}/pull-requests/${prs[412]}/checks/2/rerun`,
				{ id: thread, prId: prs[412], runId: "2", confirmKey: key },
			);
			expect(again).toMatchObject({ ok: true, already: true });
			expect(reruns()).toBe(before + 1);
			await shot(page, "a17-rerun");
		});

		test("A18 a dropped re-run may have started, and is never sent twice", async ({
			page,
		}) => {
			fakeHost("mode", "rerun-drop");
			const before = reruns();
			await openPr(page, prs[412] as string);
			let row = await checkRow(page, ACTIONS_UNIT);
			await row.getByTestId("rerun-button").click();
			const key = await rerun(page);
			await expect(row.getByTestId("rerun-status")).toContainText(
				"Re-run may have started",
			);
			expect(reruns()).toBe(before + 1);
			await shot(page, "a18-rerun-drop");
			execSync("pnpm sim restart", {
				cwd: ROOT,
				env: { ...process.env, PRISMALENS_SIM_DIR: SIM_DIR },
				stdio: "inherit",
				timeout: 300_000,
			});
			await expect
				.poll(
					() =>
						fetch(`${sim.url}/health`).then(
							(r) => r.status,
							() => 0,
						),
					{ timeout: 120_000 },
				)
				.toBe(200);
			const same = await ok<{ ok: boolean; failure?: string }>(
				"POST",
				`/threads/${thread}/pull-requests/${prs[412]}/checks/2/rerun`,
				{ id: thread, prId: prs[412], runId: "2", confirmKey: key },
			);
			expect(same.ok).toBe(false);
			expect(reruns()).toBe(before + 1);
			await openPr(page, prs[412] as string);
			row = await checkRow(page, ACTIONS_UNIT);
			await row.getByTestId("rerun-button").click();
			await rerun(page);
			await expect(row.getByTestId("rerun-again")).toBeVisible();
			await row.getByTestId("rerun-again").click();
			await rerun(page);
			await expect.poll(reruns).toBe(before + 3);
			fakeHost("mode", "ok");
		});

		test("A19 a token without the scope says so", async ({ page }) => {
			fakeHost("mode", "no-scope");
			await openPr(page, prs[412] as string);
			const row = await checkRow(page, ACTIONS_UNIT);
			await row.getByTestId("rerun-button").click();
			await rerun(page);
			await expect(row.getByTestId("rerun-status")).toContainText(
				"Token can't re-run jobs",
			);
			await shot(page, "a19-rerun-scope");
			fakeHost("mode", "ok");
		});

		test("A20 the PR's files, and a failed read with Retry", async ({
			page,
		}) => {
			await openPr(page, prs[412] as string);
			await page.getByTestId("pr-tab-files").click();
			await expect(page.getByTestId("pr-file-row")).toHaveCount(2);
			await expect(page.getByTestId("pr-file-too-large")).toHaveText(
				"Too large to show",
			);
			await page
				.locator('[data-testid="pr-file-row"]')
				.filter({ hasNot: page.getByTestId("pr-file-too-large") })
				.getByTestId("pr-file-toggle")
				.click();
			await expect(page.getByTestId("pr-file-diff")).toBeVisible();
			await shot(page, "a20-files");
			// Another head, so the 60 s files cache cannot answer for the host.
			fakeHost("mode", "files-fail");
			await openPr(page, prs[413] as string);
			await page.getByTestId("pr-tab-files").click();
			const failed = page
				.getByTestId("state-problem")
				.filter({ hasText: "Files didn't load" });
			await expect(failed).toBeVisible({ timeout: 60_000 });
			await shot(page, "a20-files-failed");
			fakeHost("mode", "ok");
			await failed.getByRole("button", { name: /Retry/ }).click();
			await expect(page.getByTestId("pr-file-row")).toHaveCount(2);
		});

		test("A21 a failed preview and a failed start retry", async ({ page }) => {
			await failFirst(page, "**/fix-preview", 1);
			await openPr(page, prs[412] as string);
			let row = await checkRow(page, OTHER_UNIT);
			await row.getByTestId("pr-fix-thread").click();
			const failed = page
				.getByTestId("fix-dialog")
				.getByTestId("state-problem")
				.filter({ hasText: "Preview didn't load" });
			await expect(failed).toBeVisible();
			await shot(page, "a21-fix-failed");
			await failed.getByRole("button", { name: /Retry/ }).click();
			await expect(page.getByTestId("fix-start")).toBeEnabled();
			await page.unrouteAll();
			await page.keyboard.press("Escape");
			await failFirst(page, "**/fix-thread", 1);
			row = await checkRow(page, OTHER_UNIT);
			await row.getByTestId("pr-fix-thread").click();
			await page.getByTestId("fix-start").click();
			const didnt = page
				.getByTestId("fix-dialog")
				.getByTestId("state-problem")
				.filter({ hasText: "Thread didn't start" });
			await expect(didnt).toBeVisible();
			await shot(page, "a21-start-failed");
			await didnt.getByRole("button", { name: /Retry/ }).click();
			await page.waitForURL((u) => !u.pathname.endsWith(thread));
		});

		test("A22 an incident run's PR starts a fix thread too", async ({
			page,
		}) => {
			const pr = prs[418] as string;
			const p = await preview(pr, checks("2"), incidentThread);
			expect(p.refusal).toBeNull();
			await openPr(page, pr, incidentThread);
			const row = await checkRow(page, ACTIONS_UNIT);
			await row.getByTestId("pr-fix-thread").click();
			await expect(page.getByTestId("fix-start")).toBeEnabled();
			await expect(page.getByTestId("fix-refusal")).toHaveCount(0);
			await shot(page, "a22-incident-fix");
		});

		test("A23 the Started section reads stored sub-agents and threads", async ({
			page,
		}) => {
			const l = await links();
			expect(l.subagents).toHaveLength(4);
			expect(l.subagents?.find((s) => s.sessionId === "tc9")?.state).toBe(
				"completed",
			);
			const running =
				(l.subagents?.filter((s) => s.state === "running").length ?? 0) +
				l.started.filter((s) => s.state === "running").length;
			await page.goto(`/threads/${thread}?panel=thread&section=threads`);
			await expect(page.getByTestId("panel-section-threads-title")).toHaveText(
				running ? `Started · ${running} running` : "Started",
			);
			const rows = page.getByTestId("started-row");
			await expect(rows.first()).toHaveAttribute("data-id", "s-fail");
			// The agent's mark is its registry logo, drawn at a real size.
			const mark = rows.first().getByTestId("agent-logo");
			await expect(mark).toHaveAttribute("viewBox", "0 0 240 300");
			const box = await mark.boundingBox();
			expect([box?.width, box?.height]).toEqual([16, 20]);
			await expect(rows.first()).toHaveAttribute("data-state", "failed");
			const toggle = page.getByTestId("started-finished-toggle");
			await expect(toggle).toContainText("Finished");
			await expect(toggle).toHaveAttribute("aria-expanded", "false");
			await toggle.click();
			await expect(
				page.locator(
					'[data-testid="started-row"][data-id="s-done"], [data-testid="started-row"][data-id="tc9"]',
				),
			).toHaveCount(2);
			await expect(
				page.locator('[data-testid="started-row"][data-id="tc9"]'),
			).toContainText("readiness check");
			const how = await page
				.locator('[data-testid="started-row"][data-kind="thread"]')
				.evaluateAll((els) =>
					Object.fromEntries(
						els.map((e) => [
							e.getAttribute("data-id"),
							e.getAttribute("data-how"),
						]),
					),
				);
			expect(how).toEqual(
				Object.fromEntries(l.started.map((s) => [s.id, s.via ?? "agent"])),
			);
			await expect(
				page
					.locator('[data-testid="started-row"][data-kind="subagent"]')
					.first(),
			).toHaveAttribute("data-how", "subagent");
			await shot(page, "a23-started");
		});

		test("A24 a sub-agent outside the window opens from stored steps", async ({
			page,
		}) => {
			// The window holds only its last page, as on a long thread, so the lane's steps are not loaded.
			await page.route("**/window/page**", (route) => route.abort());
			await failFirst(page, "**/subagents/tc9/events");
			await page.goto(`/threads/${thread}?panel=thread&section=threads`);
			await page.getByTestId("started-finished-toggle").click();
			await page.locator('[data-testid="started-row"][data-id="tc9"]').click();
			const pane = page.getByTestId("subagent-pane");
			await expect(pane.getByTestId("subagent-steps-failed")).toContainText(
				"Steps didn't load",
			);
			await shot(page, "a24-subagent-pane-failed");
			await pane.getByRole("button", { name: /Retry/ }).click();
			await expect(pane.getByText(/^Readiness step [123]$/)).toHaveCount(3);
			await shot(page, "a24-subagent-pane");
		});

		test("A25 the box has one Started row that opens the section", async ({
			page,
		}) => {
			const l = await links();
			const n = l.started.length + (l.subagents?.length ?? 0);
			const r =
				(l.subagents?.filter((s) => s.state === "running").length ?? 0) +
				l.started.filter((s) => s.state === "running").length;
			await page.goto(`/threads/${thread}`);
			const row = page.getByTestId("details-row-started");
			await expect(row).toContainText(r ? `${n} · ${r} running` : `${n}`);
			await expect(page.getByTestId("details-row-subagents")).toHaveCount(0);
			await shot(page, "a25-box-started");
			await row.click();
			await expect(page.getByTestId("started-section")).toBeVisible();
		});
	});
