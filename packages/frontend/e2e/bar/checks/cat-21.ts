// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { expect } from "@playwright/test";
import { defineChecks, verdict } from "../bar";

/** The one-time pairing token of a device that is not the host, from `prismalens pair`. */
function mintPairToken(): string {
	const simDir = resolve(process.env.BAR_SIM_DIR ?? "../../.sim-checks");
	const state = JSON.parse(readFileSync(join(simDir, "state.json"), "utf8"));
	const out = execSync("pnpm --silent --filter prismalens dev pair", {
		encoding: "utf8",
		cwd: resolve(import.meta.dirname, "../../../.."),
		env: { ...process.env, PRISMALENS_WORKSPACE_DIR: state.workspace },
	});
	const token = out.match(/\/pair#([A-Za-z0-9_-]+)/)?.[1];
	if (!token) throw new Error("could not mint a pairing token");
	return token;
}

/** #1101 category 21, Terminal, browser and files panes. */
export default defineChecks([
	{
		item: "21.1",
		async run({ page, open, sim }) {
			await open(`${sim.thread("huge.diff", 0)}?panel=new`);
			await expect(page.getByTestId("thread-page")).toBeVisible();
			const newTabPage = page.getByTestId("new-tab-page");
			await expect(newTabPage).toBeVisible();

			const toolRows = newTabPage.locator("li[data-testid^='new-tab-']");
			const count = await toolRows.count();
			const seen: { id: string; label: string; keys: string }[] = [];
			for (let i = 0; i < count; i++) {
				const row = toolRows.nth(i);
				const testId = (await row.getAttribute("data-testid")) ?? "";
				const id = testId.replace("new-tab-", "");
				const label =
					(await row.locator("span.text-body").textContent())?.trim() ?? "";
				const keys = (
					await row
						.locator("kbd, [data-testid^='keys-'], span.pr-2")
						.allTextContents()
				)
					.join(" ")
					.trim();
				seen.push({ id, label, keys });
			}

			const fails: string[] = [];
			if (seen.length < 5) {
				fails.push(`expected at least 5 tools, found ${seen.length}`);
			}
			for (const t of seen) {
				if (!t.keys) {
					fails.push(`tool ${t.label || t.id} has no keys shown`);
				}
			}

			return verdict(
				fails,
				`${seen.length} tools on new-tab page with keys: ${seen.map((t) => `${t.label} (${t.keys})`).join(", ")}`,
			);
		},
	},
	{
		item: "21.2",
		async run({ page, open, sim, browser }) {
			const fails: string[] = [];

			// 1. Panes tile: open with panel=thread and split=changes
			await open(`${sim.thread("huge.diff", 0)}?panel=thread&split=changes`);
			await expect(page.getByTestId("thread-page")).toBeVisible();

			const splitHandle = page.getByTestId("panel-split-handle");
			await expect(splitHandle).toBeVisible();
			const splitSection = page.getByTestId("panel-split");
			await expect(splitSection).toBeVisible();

			const splitTitle = (
				await splitSection.locator("h3").textContent()
			)?.trim();
			if (!splitTitle?.includes("Changes")) {
				fails.push(`split pane does not show Changes (saw: ${splitTitle})`);
			}

			// 2. On a paired device that is not the host, the browser pane says why
			const paired = await browser.newContext({
				baseURL: sim.url,
				storageState: { cookies: [], origins: [] },
				viewport: { width: 390, height: 844 },
			});
			let helpText = "";
			try {
				const phone = await paired.newPage();
				await phone.goto(`/pair#${mintPairToken()}`);
				await phone.waitForURL(/\/(new|incidents|threads)/);
				await phone.goto(`${sim.thread("huge.diff", 0)}?panel=new`);
				await phone.getByTestId("new-tab-browser").click();
				const unavailable = phone.getByTestId("browser-host-only");
				await expect(unavailable).toBeVisible({ timeout: 30_000 });
				const title = ((await unavailable.textContent()) ?? "").trim();
				if (!title.includes("Only the host can watch")) {
					fails.push(`unavailable pane title is "${title}"`);
				}
				await unavailable.getByTestId("help").click();
				const why = phone.getByText(/computer running PrismaLens/).first();
				await expect(why).toBeVisible({ timeout: 10_000 });
				helpText = ((await why.textContent()) ?? "").trim();
			} finally {
				await paired.close();
			}

			return verdict(
				fails,
				`panes tile with split handle (${splitTitle}); a paired device's browser pane reads "Only the host can watch", and its help says "${helpText}"`,
			);
		},
	},
	{
		item: "21.3",
		async run({ page, open, sim }) {
			const fails: string[] = [];
			// The browser opens from the New tab page; a bare ?panel=browser is dropped.
			const threadPath = sim.thread("huge.diff", 0);
			const id = threadPath.split("/").pop() ?? "";
			await open(`${threadPath}?panel=new`);
			await page.getByTestId("new-tab-browser").click();
			await expect(page).toHaveURL(/panel=browser/);

			await expect(page.getByTestId("host-browser")).toBeVisible();
			await expect(page.getByTestId("browser-address")).toBeVisible();
			await expect(page.getByTestId("browser-empty")).toBeVisible();

			const tools = await page
				.getByTestId("browser-empty-tools")
				.locator("[role='img']")
				.evaluateAll((els) =>
					els.map((el) => el.getAttribute("aria-label") ?? "").filter(Boolean),
				);
			const expectedTools = [
				"Opens pages",
				"Clicks and types",
				"Reads the page",
				"Takes screenshots",
				"Reads the console",
				"Reads network calls",
				"Runs scripts, as you allow",
			];
			for (const tool of expectedTools) {
				if (!tools.includes(tool))
					fails.push(`missing browser agent tool: "${tool}"`);
			}

			// The host's one browser engine is up, and the agent is allowed to use it
			const status = await page.request.get(`/api/threads/${id}/browser`);
			const engine = ((await status.json()) as { engine?: string }).engine;
			if (engine !== "ready" && engine !== "running") {
				fails.push(
					`browser engine state is "${engine}", expected ready or running`,
				);
			}
			const settings = await page.request.get("/api/browser/settings");
			const agentBrowser = (
				(await settings.json()) as { agentBrowser?: boolean }
			).agentBrowser;
			if (agentBrowser !== true) {
				fails.push(`agent browser setting is ${agentBrowser}, expected true`);
			}

			return verdict(
				fails,
				`browser pane opens from the New tab page with an address bar and the agent's ${tools.length} tools (${tools.join(", ")}); engine "${engine}", agents may use it: ${agentBrowser}. The profile's persistence itself is not observed`,
			);
		},
	},
	{
		item: "21.4",
		async run({ page, open, sim }) {
			const fails: string[] = [];
			// The agent's reply in this thread cites src/app.txt:3
			await open(sim.thread("huge.diff", 1));
			const fileLink = page.locator("a[data-link-type='file']").first();
			await expect(fileLink).toBeVisible({ timeout: 30_000 });
			const cited = ((await fileLink.textContent()) ?? "").trim();
			await fileLink.click();

			await expect(page).toHaveURL(/panel=files/);
			const url = new URL(page.url());
			const path = url.searchParams.get("path") ?? "";
			const line = url.searchParams.get("line");
			const [citedPath, citedLine] = cited.split(":");
			if (!path.endsWith(citedPath ?? "?")) {
				fails.push(`files pane path "${path}" is not the cited "${citedPath}"`);
			}
			if (line !== citedLine) {
				fails.push(
					`files pane line is ${line}, the cited line is ${citedLine}`,
				);
			}
			await expect(page.getByTestId("file-view")).toBeVisible();
			await expect(page.getByTestId("panel-body")).toContainText(cited);

			return verdict(
				fails,
				`clicking the cited "${cited}" opened the Files pane at path "${path}" line ${line}`,
			);
		},
	},
	{
		item: "21.5",
		async run({ page, open, sim }) {
			const fails: string[] = [];
			await open(`${sim.thread("huge.diff", 0)}?panel=thread`);
			const panel = page.getByTestId("panel-right");
			await expect(panel).toBeVisible();

			// 1. The panel resizes from its border, and the width is kept
			const separator = page.getByRole("separator", { name: /Resize/i });
			await expect(separator).toBeVisible();
			const w0 = (await panel.boundingBox())?.width ?? 0;
			const sb = await separator.boundingBox();
			if (!sb) throw new Error("resize separator has no box");
			const y = sb.y + sb.height / 2;
			await page.mouse.move(sb.x + sb.width / 2, y);
			await page.mouse.down();
			await page.mouse.move(sb.x - 120, y, { steps: 8 });
			await page.mouse.up();
			await expect
				.poll(async () => (await panel.boundingBox())?.width ?? 0)
				.toBeGreaterThan(w0 + 60);
			const w1 = (await panel.boundingBox())?.width ?? 0;
			await page.reload();
			await expect(panel).toBeVisible();
			await expect
				.poll(async () =>
					Math.abs(((await panel.boundingBox())?.width ?? 0) - w1),
				)
				.toBeLessThan(8);
			// Back to the default width
			await page.getByRole("separator", { name: /Resize/i }).dblclick();

			// 2. The button widens it over the main column, not the sidebar
			const widenBtn = page.getByTestId("panel-widen");
			await widenBtn.click();
			await expect(panel).toHaveAttribute("data-expanded", "true");
			const sidebarRight =
				(await page.getByTestId("sidebar").boundingBox())?.width ?? 0;
			const covered = await panel.boundingBox();
			const viewport = page.viewportSize()?.width ?? 0;
			if (
				!covered ||
				Math.abs(covered.x - sidebarRight) > 6 ||
				Math.abs(covered.x + covered.width - viewport) > 2
			) {
				fails.push(
					`expanded panel spans x ${covered?.x}..${covered ? covered.x + covered.width : "?"}, expected sidebar edge ${sidebarRight}..${viewport}`,
				);
			}
			await widenBtn.click();
			await expect(panel).not.toHaveAttribute("data-expanded");

			return verdict(
				fails,
				`dragging the border widened the panel ${Math.round(w0)} -> ${Math.round(w1)} px and it kept that width after a reload; the button expanded it to x ${Math.round(covered?.x ?? 0)}..${Math.round((covered?.x ?? 0) + (covered?.width ?? 0))} of a ${viewport} px window with the ${Math.round(sidebarRight)} px sidebar left alone`,
			);
		},
	},
	{
		item: "21.6",
		async run({ page, open, sim }) {
			const fails: string[] = [];

			// 1. On wide screens, top-right box is docked at fixed place and size without open panel
			await open(sim.thread("git.conflict"));
			await expect(page.getByTestId("thread-page")).toBeVisible();

			const dock1 = page.getByTestId("details-dock");
			await expect(dock1).toBeVisible();
			await expect(dock1).toHaveAttribute("data-dock", "docked");
			const box1 = await dock1.boundingBox();
			if (!box1 || box1.width <= 0) {
				fails.push("details-dock has no bounding box on git.conflict");
			}

			// Second thread to verify fixed place and size
			await open(sim.thread("huge.diff", 0));
			await expect(page.getByTestId("thread-page")).toBeVisible();

			const dock2 = page.getByTestId("details-dock");
			await expect(dock2).toBeVisible();
			await expect(dock2).toHaveAttribute("data-dock", "docked");
			const box2 = await dock2.boundingBox();
			if (!box2 || box2.width <= 0) {
				fails.push("details-dock has no bounding box on huge.diff");
			}

			if (box1 && box2) {
				const moved = [
					["x", box1.x, box2.x],
					["y", box1.y, box2.y],
					["width", box1.width, box2.width],
					["height", box1.height, box2.height],
				].filter(([, a, b]) => Math.abs((a as number) - (b as number)) > 3);
				if (moved.length > 0) {
					fails.push(
						`dock differs between threads in ${moved.map(([k, a, b]) => `${k} ${Math.round(a as number)} vs ${Math.round(b as number)}`).join(", ")}`,
					);
				}
			}

			// 2. Gives way to the open panel
			await open(`${sim.thread("huge.diff", 0)}?panel=thread`);
			await expect(page.getByTestId("thread-page")).toBeVisible();
			await expect(page.getByTestId("thread-panel")).toBeVisible();

			const dockOpen = page.getByTestId("details-dock");
			if (await dockOpen.isVisible()) {
				fails.push(
					"details-dock is still visible when right panel is open (should give way)",
				);
			}

			return verdict(
				fails,
				`top-right details box docked at the same place and size (${Math.round(box1?.width ?? 0)}x${Math.round(box1?.height ?? 0)} at ${Math.round(box1?.x ?? 0)},${Math.round(box1?.y ?? 0)}) across two threads, giving way when right panel opens`,
			);
		},
	},
]);
