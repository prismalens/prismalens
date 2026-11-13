// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// two-devices.steer (#1101): the same running thread open on a desk (1600 px) and a phone
// (390 px); the phone steers mid-turn. Stamps how long the desk took to show the message
// and whether the phone kept its own draft state.
//   PRISMALENS_WORKSPACE_DIR=<ws> pnpm --filter @prismalens/frontend exec tsx e2e/conditions/helpers/two-devices.ts --url http://127.0.0.1:3410
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "@playwright/test";
import {
	connect,
	sleep,
	startThread,
	waitFor,
} from "../../../../../scripts/fakes/conditions/lib.mjs";
import {
	stampDir,
	writeStamp,
} from "../../../../../scripts/fakes/conditions/stamp.mjs";
import { cliArg, DESK, PHONE, pairedContext } from "./browser";

const STEER = "Stop looping and check the test fixture";

async function main() {
	const url = (cliArg("--url") ?? "http://127.0.0.1:3000").replace(/\/$/, "");
	const { api, cookie } = await connect(url);
	// The runaway session keeps the turn going, so the steer lands mid-turn.
	const id = await startThread(api, "runaway", "Fix the flaky retry test");
	await waitFor(api, id, (r) => r.status === "running", 30_000, "running");
	const browser = await chromium.launch();
	try {
		const desk = await (
			await pairedContext(browser, url, cookie, DESK)
		).newPage();
		const phone = await (
			await pairedContext(browser, url, cookie, PHONE)
		).newPage();
		await Promise.all([
			desk.goto(`/threads/${id}`),
			phone.goto(`/threads/${id}`),
		]);
		const input = phone.getByTestId("composer-input");
		await input.waitFor({ timeout: 20_000 });
		await sleep(2000);
		await input.click();
		await input.pressSequentially(STEER);
		await input.press("Enter");
		const sent = Date.now();
		let deskShowedMs: number | null = null;
		try {
			await desk.getByText(STEER).first().waitFor({ timeout: 15_000 });
			deskShowedMs = Date.now() - sent;
		} catch {}
		const phoneShows = await phone.getByText(STEER).first().isVisible();
		const phoneDraft = (await input.textContent()) ?? "";
		const stillRunning = (await api(`/investigations/${id}`)).status;
		mkdirSync(stampDir(), { recursive: true });
		const shots = ["two-devices.desk.png", "two-devices.phone.png"];
		await desk.screenshot({ path: join(stampDir(), shots[0] as string) });
		await phone.screenshot({ path: join(stampDir(), shots[1] as string) });
		const detail = {
			threadId: id,
			deskShowedMs,
			phoneShows,
			phoneDraftCleared: phoneDraft.trim() === "",
			statusAfterSteer: stillRunning,
		};
		console.log(JSON.stringify(detail, null, 2));
		writeStamp({
			condition: "two-devices.steer",
			simulator: "pw.two-devices",
			observed: {
				deskShowedMs: deskShowedMs ?? -1,
				phoneShows,
				phoneDraftCleared: detail.phoneDraftCleared,
				stillRunning: stillRunning === "running",
				phoneWidth: PHONE.viewport?.width ?? 0,
			},
			detail,
			files: shots,
		});
	} finally {
		// The runaway turn never ends by itself; stop it however the walk went.
		await api(`/investigations/${id}/cancel`, {
			method: "POST",
			body: {},
		}).catch(() => {});
		await browser.close();
	}
}

main().catch((e) => {
	console.error(e instanceof Error ? e.message : String(e));
	process.exitCode = 1;
});
