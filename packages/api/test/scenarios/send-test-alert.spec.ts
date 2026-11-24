// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eventually, ScenarioApp } from "./support/scenario-app.js";

const pl = new ScenarioApp();

beforeAll(async () => {
	await pl.boot();
}, 60_000);
afterAll(async () => {
	await pl.dispose();
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

interface Sent {
	alertId: string;
	incidentId?: string;
	incidentNumber?: number;
	isNewIncident: boolean;
}

describe("Send a test alert", () => {
	it("Given a project that is not yet a service, When a test alert names it, Then a new incident is routed to the project's service and an investigation starts by policy", async () => {
		const dir = gitFolder("demo-proj");
		await pl.api("/repositories/source", {
			method: "POST",
			body: { source: dir },
		});

		const sent = await pl.api<Sent>("/webhooks/test", {
			method: "POST",
			body: { serviceName: "demo-proj" },
		});

		expect(sent.isNewIncident).toBe(true);
		const incident = await pl.api<{
			severity: string;
			serviceId?: string | null;
		}>(`/incidents/${sent.incidentId}`);
		expect(incident.severity).toBe("high");
		const service = await pl.api<{ name: string }>(
			`/services/${incident.serviceId}`,
		);
		expect(service.name).toBe("demo-proj");
		const [run] = await eventually(
			() => pl.investigations(sent.incidentId as string),
			(runs) => runs.length === 1,
			"the investigation the test alert started",
		);
		expect(run?.triggerType).toBe("auto_critical");
	});

	it("When the same test alert is sent again while its incident is open, Then it joins that incident and starts no second run", async () => {
		const first = await pl.api<Sent>("/webhooks/test", {
			method: "POST",
			body: { serviceName: "demo-proj" },
		});
		const again = await pl.api<Sent>("/webhooks/test", {
			method: "POST",
			body: { serviceName: "demo-proj" },
		});

		expect(again.incidentId).toBe(first.incidentId);
		expect(again.isNewIncident).toBe(false);
		expect(
			(await pl.investigations(first.incidentId as string)).length,
		).toBe(1);
	});

	it("When a test alert names a project that does not exist, Then its incident has no service and no investigation starts", async () => {
		const sent = await pl.api<Sent>("/webhooks/test", {
			method: "POST",
			body: { serviceName: "no-such-project" },
		});

		const incident = await pl.api<{ serviceId?: string | null }>(
			`/incidents/${sent.incidentId}`,
		);
		expect(incident.serviceId ?? null).toBeNull();
		expect(await pl.investigations(sent.incidentId as string)).toEqual([]);
	});
});
