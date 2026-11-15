import { expect, type Page } from "@playwright/test";
import { defineChecks, verdict } from "../bar";

/** A schedule this check owns: made through the API, deleted when `use` ends. */
async function withSchedule<T>(
	page: Page,
	use: (s: { id: string; name: string }) => Promise<T>,
): Promise<T> {
	const services = await page.request.get("/api/services");
	const serviceId =
		((await services.json()) as { data: { id: string }[] }).data[0]?.id ?? null;
	const name = `Bar 22 check ${Date.now()}`;
	const created = await page.request.post("/api/schedules", {
		data: {
			name,
			serviceId,
			runbook: null,
			brief: "Check the service health",
			recurrence: { type: "cron", expr: "0 9 * * 1-5", timezone: "UTC" },
			harness: "opencode",
			model: null,
			effort: null,
			missedPolicy: "run_once",
			catchUpMinutes: 60,
		},
	});
	expect(created.ok(), await created.text()).toBe(true);
	const { id } = (await created.json()) as { id: string };
	try {
		return await use({ id, name });
	} finally {
		await page.request.delete(`/api/schedules/${id}`);
	}
}

/**
 * #1101 category 22, Scheduled tasks.
 */
export default defineChecks([
	{
		item: "22.1",
		async run({ page, open }) {
			return withSchedule(page, async ({ name }) => {
				await open("/automation", "automation-page");
				const row = page.getByTestId("schedule-row").filter({ hasText: name });
				await expect(row).toBeVisible({ timeout: 20_000 });
				const text = (await row.innerText()).replace(/\s+/g, " ").trim();
				const fails: string[] = [];
				if (!/Weekdays 09:00|Weekdays 9:00/i.test(text)) {
					fails.push("the card does not state its cadence");
				}
				if (!/Next .+\d/.test(text))
					fails.push("the card does not state its next run");
				if (
					!/No runs yet|Paused|Done|Failed|Working|Waiting|Limited/.test(text)
				) {
					fails.push("the card shows no state or last result word");
				}
				const built = page.locator('section:has(h2:has-text("Built in")) li');
				const builtText = (await built.allInnerTexts()).map((t) =>
					t.replace(/\s+/g, " "),
				);
				if (builtText.length === 0) fails.push("no built-in job listed");
				const bare = builtText.filter(
					(t) => !/ · /.test(t) || !/(Last ran|Next|Not run yet)/.test(t),
				);
				if (bare.length > 0)
					fails.push(
						`${bare.length} built-in cards lack cadence or result: "${bare[0]?.slice(0, 90)}"`,
					);
				return verdict(
					fails,
					`new schedule card reads "${text.slice(0, 120)}"; ${builtText.length} built-in jobs show cadence and result`,
				);
			});
		},
	},
	{
		item: "22.2",
		async run({ page }) {
			return withSchedule(page, async ({ id }) => {
				const ran = await page.request.post(`/api/schedules/${id}/run`);
				expect(ran.ok(), await ran.text()).toBe(true);
				await page.goto(`/schedules/${id}`);
				const tick = page.getByTestId("schedule-tick").first();
				await expect(tick).toBeVisible({ timeout: 30_000 });
				const fails: string[] = [];
				const unseen = await tick.getAttribute("data-unseen");
				const href = await tick.locator("a").first().getAttribute("href");
				if (!href || !/^\/(threads|investigations|incidents)\//.test(href)) {
					fails.push(`the run row links to ${href}, not a thread`);
				}
				if (unseen !== "true") {
					fails.push(`a run nobody opened has data-unseen="${unseen}"`);
				}
				if (href && fails.length === 0) {
					await page.goto(href);
					await expect(page.getByTestId("thread-page")).toBeVisible();
					await page.waitForTimeout(3000);
					let after: string | null = "true";
					for (let i = 0; i < 5 && after !== "false"; i++) {
						await page.goto(`/schedules/${id}`);
						await expect(
							page.getByTestId("schedule-tick").first(),
						).toBeVisible();
						after = await page
							.getByTestId("schedule-tick")
							.first()
							.getAttribute("data-unseen");
					}
					if (after !== "false")
						fails.push(`an opened run still reads unseen=${after}`);
				}
				return verdict(
					fails,
					`a run-now tick links to ${href}, reads unread until opened, then read`,
				);
			});
		},
	},
	{
		item: "22.3",
		async run({ page, open, sim }) {
			const fails: string[] = [];
			const conditions = [
				"host.restart",
				"agent.message-loop",
				"seed: long-thread",
			];
			for (const c of conditions) {
				try {
					await open(sim.thread(c), "thread-page");
					await page
						.getByTestId("thread-menu")
						.first()
						.click({ timeout: 10_000 });
					const action = page.locator(
						'[data-testid^="menu-"][data-testid$="schedule"]',
					);
					await expect(action).toBeVisible({ timeout: 10_000 });
					if ((await action.getAttribute("aria-disabled")) === "true") {
						fails.push(`${c}: 'Add scheduled task' is disabled`);
					} else {
						await action.click({ timeout: 10_000 });
						await expect(page.getByTestId("schedule-dialog")).toBeVisible({
							timeout: 10_000,
						});
					}
				} catch (e) {
					fails.push(`${c}: ${String(e).split("\n")[0][0]?.slice(0, 90)}`);
				}
				await page.keyboard.press("Escape");
			}

			return verdict(
				fails,
				`${conditions.length} threads' menus offer 'Add scheduled task' and each opens the schedule dialog`,
			);
		},
	},
	{
		item: "22.4",
		async run({ page, open }) {
			await open("/automation", "automation-page");
			const fails: string[] = [];

			const templatesSection = page.getByTestId("schedule-templates");
			await expect(templatesSection).toBeVisible();

			const t1 = page.getByTestId("schedule-template-watch-service");
			const t2 = page.getByTestId("schedule-template-daily-digest");
			const t3 = page.getByTestId("schedule-template-recheck-pr");

			if (!(await t1.isVisible()))
				fails.push("template missing: Watch a service");
			if (!(await t2.isVisible())) fails.push("template missing: Daily digest");
			if (!(await t3.isVisible()))
				fails.push("template missing: Re-check a PR");

			// Click Watch a service and verify prefilled dialog
			await t1.click();
			const dialog = page.getByTestId("schedule-dialog");
			await expect(dialog).toBeVisible();

			const nameInput = dialog.locator("#sch-name");
			await expect(nameInput).toBeVisible();
			const prefilledName = await nameInput.inputValue();

			if (!prefilledName.includes("Watch a service")) {
				fails.push(
					`name input prefill is "${prefilledName}", expected "Watch a service"`,
				);
			}

			await page.keyboard.press("Escape");

			return verdict(
				fails,
				`3 templates present (Watch a service, Daily digest, Re-check a PR); clicking template opens dialog with name prefilled to "${prefilledName}"`,
			);
		},
	},
	{
		item: "22.5",
		async run({ page, open }) {
			await open("/automation", "automation-page");
			const rows = page.getByTestId("schedule-row");
			await expect(rows.first()).toBeVisible({ timeout: 20_000 });
			const texts = (await rows.allInnerTexts()).map((t) =>
				t.replace(/\s+/g, " ").trim(),
			);
			const limited = texts.filter((t) => /limit/i.test(t));
			const fails: string[] = [];
			if (limited.length === 0) fails.push("no schedule card shows a limit");
			for (const t of limited) {
				if (!/resets \d{1,2}:\d{2}/i.test(t)) {
					fails.push(`a limited card has no reset time: ${t.slice(0, 80)}`);
				}
			}
			return verdict(
				fails,
				`${limited.length} of ${texts.length} schedule cards show a limit with its reset, e.g. "${limited[0]?.slice(0, 90)}"`,
			);
		},
	},
]);
