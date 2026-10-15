// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import type { CaseView } from "@prismalens/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { releaseRun } from "../../../../scripts/fakes/fake-acp-agent.mjs";
import {
	type FakeAlertmanager,
	type ListedAlert,
	startFakeAlertmanager,
} from "../../../../scripts/fakes/fake-alertmanager.mjs";
import {
	installFakeKubectl,
	readArgvLog,
} from "../../../../scripts/fakes/fake-kubectl.mjs";
import {
	eventually,
	type Investigation,
	ScenarioApp,
} from "./support/scenario-app.js";

const pl = new ScenarioApp();
const kubectlBin = join(pl.workspace, "kubectl-bin");
let am: FakeAlertmanager;

beforeAll(async () => {
	mkdirSync(kubectlBin);
	// Every cluster call answers 2 s late, so the run provably starts before capture ends.
	installFakeKubectl(kubectlBin, "slow");
	process.env.PATH = `${kubectlBin}${delimiter}${process.env.PATH ?? ""}`;
	am = await startFakeAlertmanager();
	await pl.boot();
}, 60_000);
afterAll(async () => {
	await am.close();
	await pl.dispose();
});

interface BundleManifest {
	state: string;
	artifacts: Array<{ file: string | null; purpose: string; withheld: boolean }>;
}

const caseOf = (incidentId: string) => pl.api<CaseView>(`/cases/${incidentId}`);
const ended = (v: CaseView) =>
	v.captures.length > 0 && !["queued", "running"].includes(v.captures[0]?.state ?? "");

async function fire(alertname: string, severity: string): Promise<{ alert: ListedAlert; incidentId: string }> {
	const alert = am.fire({ labels: { alertname, service: "checkout", severity } });
	const res = await am.post(pl.webhookUrl, pl.webhookToken, { only: [alert.fingerprint] });
	expect(res.status).toBeLessThan(300);
	const [incident] = await eventually(
		() => pl.incidentFor(alert.fingerprint),
		(found) => found.length === 1,
		`the incident ${alertname} opens`,
	);
	return { alert, incidentId: incident?.id ?? "" };
}

describe("Case File: capture at alert time, beside the run", () => {
	let serviceId = "";

	it("Given the experiment on, When the operator binds checkout to the detected context, Then the probe reads pods with that identity", async () => {
		expect(await pl.api("/case-files/settings", { method: "PUT", body: { enabled: true } })).toEqual({ enabled: true });
		serviceId = (await pl.serviceWithRepo("checkout")).id;

		const detected = await pl.api<{ currentContext: string | null; contexts: string[] }>(
			`/services/${serviceId}/binding/detect`,
		);
		expect(detected).toMatchObject({ currentContext: "kind-pl", contexts: ["kind-pl"] });
		const binding = await pl.api<{ probeState: string; cluster: string }>(`/services/${serviceId}/binding`, {
			method: "PUT",
			body: { kubeContext: "kind-pl", namespace: "shop" },
		});
		expect(binding).toMatchObject({ probeState: "ok", cluster: "https://127.0.0.1:6443" });
	}, 30_000);

	it("When checkout's alert fires by webhook, Then the run starts without waiting, its cwd holds the bundle, and the case shows a candidate on a verified record", async () => {
		const key = `CheckoutErrors${randomUUID().slice(0, 8)}`;
		const { incidentId } = await fire(`${key} fake-session:case-file`, "critical");

		const [run] = await eventually(
			() => pl.investigations(incidentId),
			(runs) => runs.length === 1,
			"the run the alert started",
		);
		const said = await eventually(
			() => pl.api<unknown>(`/investigations/${run?.id}/events`),
			(events) => /cat <[^>]+>/.test(JSON.stringify(events)),
			"the agent to name its cwd",
			30_000,
		);
		const cwd = JSON.stringify(said).match(/cat <([^>]+)>/)?.[1] ?? "";
		const manifestFile = join(cwd, ".prismalens", "case", "manifest.json");
		expect(existsSync(manifestFile)).toBe(true);

		const view = await eventually(() => caseOf(incidentId), ended, "the capture to end", 60_000);
		const capture = view.captures[0];
		expect(capture).toMatchObject({ state: "complete", stateReason: null, shared: false, identityMatches: true });
		expect(capture?.artifacts.map((a) => a.purpose)).toEqual([
			"events",
			"deployments",
			"replicasets",
			"pods",
			"logs-previous",
		]);
		const started = (await pl.investigation(run?.id ?? "")) as Investigation & { startedAt: string | null };
		expect(Date.parse(started.startedAt ?? "")).toBeLessThan(Date.parse(capture?.finishedAt ?? ""));

		expect(
			view.claims.filter((c) => c.subject.relation === "precedes_alert" && c.status === "candidate").map((c) => c.statement),
		).toContainEqual(expect.stringMatching(/^Revision 2 of checkout rolled out \d+ min before the alert/));
		expect(JSON.stringify(view)).not.toContain("hunter2");
		expect(await pl.api(`/cases/${incidentId}/verify`, { method: "POST" })).toMatchObject({ ok: true, entries: 6 });

		// The bundle follows the capture into the running agent's cwd.
		const bundle = await eventually(
			async () => JSON.parse(readFileSync(manifestFile, "utf8")) as BundleManifest,
			(m) => m.state === "complete" && m.artifacts.length === 5,
			"the bundle to show the finished capture",
		);
		for (const a of bundle.artifacts) {
			expect(a.withheld).toBe(false);
			expect(readFileSync(join(cwd, ".prismalens", "case", a.file ?? ""), "utf8")).not.toContain("hunter2");
		}
		// The checklist asks for `--timestamps`, and the redacted log keeps them.
		const log = bundle.artifacts.find((a) => a.purpose === "logs-previous");
		expect(readFileSync(join(cwd, ".prismalens", "case", log?.file ?? ""), "utf8")).toMatch(/^\d{4}-\d{2}-\d{2}T[\d:]+\.\d{9}Z \S/);

		releaseRun(key);
		await eventually(
			() => pl.investigation(run?.id ?? ""),
			(i) => !["pending", "running"].includes(i.status),
			"the run to finish",
			30_000,
		);
		expect(readArgvLog(kubectlBin).every((argv) => !argv.some((a) => /^(secrets?|exec|configmaps?)$/.test(a)))).toBe(true);
	}, 120_000);

	it("When a second alert opens a case while its target's capture is queued, Then that case shares the queued capture", async () => {
		const b = await fire("CheckoutLatency", "low");
		const running = await eventually(
			() => caseOf(b.incidentId),
			(v) => v.captures[0]?.state === "running",
			"the first capture to run",
		);
		// One capture per target at a time: this one queues behind it (OBJ-027) …
		const c = await fire("CheckoutSaturation", "low");
		const queued = await eventually(() => caseOf(c.incidentId), (v) => v.captures.length === 1, "the second capture");
		expect(queued.captures[0]).toMatchObject({ state: "queued", shared: false });
		expect(queued.captures[0]?.id).not.toBe(running.captures[0]?.id);

		// … and a case opened while it is queued joins it.
		const d = await fire("CheckoutQueueDepth", "low");
		const shared = await eventually(() => caseOf(d.incidentId), (v) => v.captures.length === 1, "the shared capture");
		expect(shared.captures[0]).toMatchObject({ id: queued.captures[0]?.id, shared: true });

		for (const incidentId of [c.incidentId, d.incidentId]) {
			const done = await eventually(() => caseOf(incidentId), ended, "the shared capture to end", 60_000);
			expect(done.captures[0]?.state).toBe("complete");
		}
	}, 120_000);
});
