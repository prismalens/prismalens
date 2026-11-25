// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ScenarioApp } from "./support/scenario-app.js";

vi.setConfig({ testTimeout: 5_000 }); // slowest test 1481 ms; 3x, rounded up to the second, at least 5 s (#1154)

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

const firing = (service: string, fingerprint: string, alertname = "CheckoutDown") => ({
	status: "firing",
	labels: { alertname, service, severity: "critical" },
	annotations: { summary: "Checkout is down" },
	startsAt: "2026-11-25T10:00:00Z",
	fingerprint,
});

const post = (key: string, alerts: ReturnType<typeof firing>[]) =>
	fetch(pl.webhookUrl, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			authorization: `Bearer ${pl.webhookToken}`,
			"x-idempotency-key": key,
		},
		body: JSON.stringify({ version: "4", status: "firing", alerts }),
	});

const deliver = () => post(KEY, [firing("retry-shop", FINGERPRINT)]);

const failNextServiceWrite = async () => {
	const mapping = await pl.alertMapping();
	const busy = Object.assign(new Error("Transaction API error"), { code: "P2028" });
	vi.spyOn(
		mapping as unknown as { makeLinkedService: () => Promise<never> },
		"makeLinkedService",
	).mockRejectedValueOnce(busy);
};

describe("A Prometheus delivery whose first try fails is retried with its key until it lands", () => {
	it("Given a project's first alert whose service write cannot start, When Alertmanager retries the same key before and after the 30 s grace, Then it gets 503 twice and the stored event then resumes into one alert", async () => {
		await pl.api("/repositories/source", {
			method: "POST",
			body: { source: gitFolder("retry-shop") },
		});
		await failNextServiceWrite();
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
		expect(
			await prisma.alert.count({ where: { service: { name: "retry-shop" } } }),
		).toBe(1);
	}, 60_000);

	it("Given a two-alert delivery whose first alert's service write cannot start, When Alertmanager posts it, Then it gets 503 and the second alert is still stored", async () => {
		for (const name of ["batch-first", "batch-second"])
			await pl.api("/repositories/source", {
				method: "POST",
				body: { source: gitFolder(name) },
			});
		await failNextServiceWrite();
		const prisma = await pl.prisma();

		const res = await post("am-batch-1", [
			firing("batch-first", "fp-batch-1", "FirstDown"),
			firing("batch-second", "fp-batch-2", "SecondDown"),
		]);

		expect(res.status).toBe(503);
		const stored = await prisma.alert.findMany({
			where: { service: { name: { in: ["batch-first", "batch-second"] } } },
			select: { title: true, service: { select: { name: true } } },
		});
		expect(stored).toEqual([
			{ title: "SecondDown", service: { name: "batch-second" } },
		]);
	}, 60_000);

	it("Given a two-alert retry whose first alert's key is still in flight, When Alertmanager posts it inside the 30 s grace, Then it gets 503 with the in-flight message and the second alert is stored", async () => {
		for (const name of ["flight-first", "flight-second"])
			await pl.api("/repositories/source", {
				method: "POST",
				body: { source: gitFolder(name) },
			});
		await failNextServiceWrite();
		const prisma = await pl.prisma();
		const first = firing("flight-first", "fp-flight-1", "FirstDown");

		const stranding = await post("am-flight-1", [first]);
		expect(stranding.status).toBe(503);

		const res = await post("am-flight-1", [
			first,
			firing("flight-second", "fp-flight-2", "SecondDown"),
		]);

		expect(res.status).toBe(503);
		expect(await res.json()).toMatchObject({
			message:
				"A webhook delivery with this idempotency key is still being processed. Retry the delivery.",
		});
		const stored = await prisma.alert.findMany({
			where: { service: { name: { in: ["flight-first", "flight-second"] } } },
			select: { title: true, service: { select: { name: true } } },
		});
		expect(stored).toEqual([
			{ title: "SecondDown", service: { name: "flight-second" } },
		]);
	}, 60_000);
});
