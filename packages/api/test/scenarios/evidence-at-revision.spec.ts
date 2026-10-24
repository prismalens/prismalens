// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	type FakeAlertmanager,
	startFakeAlertmanager,
} from "../../../../scripts/fakes/fake-alertmanager.mjs";
import { eventually, ScenarioApp } from "./support/scenario-app.js";

const pl = new ScenarioApp();
let am: FakeAlertmanager;
let runId: string;
let head: string;

beforeAll(async () => {
	am = await startFakeAlertmanager();
	await pl.boot();
	await pl.serviceWithRepo("books");
	const alert = am.fire({
		labels: { alertname: "BooksListSlow", service: "books", severity: "critical" },
		annotations: { summary: "p99 of GET /books above 2s" },
	});
	await am.post(pl.webhookUrl, pl.webhookToken);
	const [incident] = await eventually(
		() => pl.incidentFor(alert.fingerprint),
		(found) => found.length === 1,
		"an incident carrying the alert",
	);
	const [run] = await eventually(
		() => pl.investigations(incident.id),
		(runs) => runs.length === 1,
		"the run the alert started",
	);
	const done = await eventually(
		() => pl.api<{ status: string; workspace?: { repos: { head: string }[] } | null }>(`/investigations/${run.id}`),
		(i) => !["pending", "running"].includes(i.status),
		"the run to finish",
		30_000,
	);
	runId = run.id;
	head = done.workspace?.repos[0]?.head ?? "";
}, 90_000);
afterAll(async () => {
	await am.close();
	await pl.dispose();
});

const blobUrl = (id: string, sha: string, path: string) =>
	`/investigations/${id}/blob?${new URLSearchParams({ sha, path })}`;

describe("Evidence at its revision: GET /investigations/:id/blob", () => {
	it("Given a finished run on a folder repo, When the operator opens a file it read, Then the blob at the recorded commit comes back", async () => {
		expect(head).toMatch(/^[0-9a-f]{40}$/);
		const blob = await pl.api<{ state: string; content: string }>(blobUrl(runId, head, "README.md"));
		expect(blob).toMatchObject({ state: "ok", kind: "file", content: "# books\n" });
	});

	it("Without a paired device's cookie, Then the request is refused", async () => {
		const res = await fetch(`${pl.url}/api${blobUrl(runId, head, "README.md")}`, {
			headers: { origin: pl.url },
		});
		expect(res.status).toBe(401);
		expect(await res.text()).not.toContain("# books");
	});

	it("For a run that does not exist, Then it is not found", async () => {
		await expect(
			pl.api(blobUrl("00000000-0000-4000-8000-000000000000", head, "README.md")),
		).rejects.toThrow(/→ 404/);
	});

	it("With a traversal path or an injected sha, Then the request is refused before git", async () => {
		await expect(pl.api(blobUrl(runId, head, "../../etc/passwd"))).rejects.toThrow(/→ 400/);
		await expect(pl.api(blobUrl(runId, "--output=x", "README.md"))).rejects.toThrow(/→ 400/);
		await expect(pl.api(blobUrl(runId, "HEAD", "README.md"))).rejects.toThrow(/→ 400/);
	});

	it("With a commit this run never recorded, Then the request is refused", async () => {
		const other = "0123456789abcdef0123456789abcdef01234567";
		await expect(pl.api(blobUrl(runId, other, "README.md"))).rejects.toThrow(/→ 400/);
	});

	it("For a file that was never committed, Then it reads as not retained", async () => {
		const blob = await pl.api(blobUrl(runId, head, "scratch.txt"));
		expect(blob).toMatchObject({ state: "unavailable", reason: "not-retained" });
	});
});
