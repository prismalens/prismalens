// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ScenarioApp } from "./support/scenario-app.js";

const pl = new ScenarioApp();

beforeAll(async () => {
	await pl.boot();
}, 60_000);
afterAll(async () => {
	await pl.dispose();
}, 60_000);
afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

function gitFolder(name: string): string {
	const dir = join(pl.workspace, "projects", name);
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, "README.md"), `# ${name}\n`);
	const git = (...args: string[]) =>
		execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], {
			cwd: dir,
		});
	git("init", "-q", "-b", "main");
	git("add", ".");
	git("commit", "-q", "-m", "init");
	return dir;
}

const KEY = "am-delivery-1";
const FINGERPRINT = "fp-retry-1";

const deliver = () =>
	fetch(pl.webhookUrl, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			authorization: `Bearer ${pl.webhookToken}`,
			"x-idempotency-key": KEY,
		},
		body: JSON.stringify({
			version: "4",
			status: "firing",
			alerts: [
				{
					status: "firing",
					labels: { alertname: "CheckoutDown", service: "retry-shop", severity: "critical" },
					annotations: { summary: "Checkout is down" },
					startsAt: "2026-11-25T10:00:00Z",
					fingerprint: FINGERPRINT,
				},
			],
		}),
	});

describe("A Prometheus delivery whose first try fails is retried with its key until it lands", () => {
	it("Given a project's first alert whose service write cannot start, When Alertmanager retries the same key before and after the 30 s grace, Then it gets 503 twice and the stored event then resumes into one alert", async () => {
		await pl.api("/repositories/source", {
			method: "POST",
			body: { source: gitFolder("retry-shop") },
		});
		const mapping = await pl.alertMapping();
		const busy = Object.assign(new Error("Transaction API error"), { code: "P2028" });
		vi.spyOn(
			mapping as unknown as { makeLinkedService: () => Promise<never> },
			"makeLinkedService",
		).mockRejectedValueOnce(busy);
		const prisma = await pl.prisma();
		const eventsFor = () =>
			prisma.event.findMany({
				where: { idempotencyKey: `${KEY}:${FINGERPRINT}` },
				select: { id: true, alertId: true },
			});

		const first = await deliver();
		expect(first.status).toBe(503);
		const [stranded, ...more] = await eventsFor();
		expect(more).toEqual([]);
		expect(stranded?.alertId ?? null).toBeNull();

		const early = await deliver();
		expect(early.status).toBe(503);

		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(Date.now() + 31_000);
		const late = await deliver();
		expect(late.status).toBe(200);

		const events = await eventsFor();
		expect(events.map((e) => e.id)).toEqual([stranded?.id]);
		const alert = await prisma.alert.findUnique({
			where: { id: events[0]?.alertId ?? "" },
			select: { title: true, service: { select: { name: true } } },
		});
		expect(alert).toEqual({
			title: "CheckoutDown",
			service: { name: "retry-shop" },
		});
	}, 60_000);
});
