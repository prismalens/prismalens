// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import {
	type FakeAlertmanager,
	fingerprintOf,
	startFakeAlertmanager,
} from "../../../../scripts/fakes/fake-alertmanager.mjs";
import { mcpReplyJson } from "../../../../scripts/fakes/fake-acp-agent.mjs";
import { alertmanagerFingerprint } from "../../src/modules/alerts/alertmanager-fingerprint.js";

let am: FakeAlertmanager | undefined;
afterEach(async () => {
	await am?.close();
	am = undefined;
});

describe("the fake Alertmanager", () => {
	it("fingerprints a label set exactly as the app does", () => {
		const sets: Record<string, string>[] = [
			{},
			{ alertname: "HighLatency" },
			{ alertname: "HighLatency", service: "api", severity: "critical" },
			{ "ä": "ü", b: "", a: "x=y,z" },
		];
		for (const labels of sets) {
			expect(fingerprintOf(labels)).toBe(alertmanagerFingerprint(labels));
		}
	});

	it("lists a fired alert, keeps its startsAt on refire, and drops it once cleared", async () => {
		am = await startFakeAlertmanager();
		const first = am.fire({
			labels: { alertname: "HighLatency" },
			startsAt: "2026-10-02T10:00:00.000Z",
		});
		am.fire({ labels: { alertname: "HighLatency" } });

		const listed = await (await fetch(`${am.url}/api/v2/alerts`)).json();
		expect(listed).toHaveLength(1);
		expect(listed[0]).toMatchObject({
			fingerprint: first.fingerprint,
			startsAt: "2026-10-02T10:00:00.000Z",
			status: { state: "active" },
		});

		am.clear(first.fingerprint);
		expect(await (await fetch(`${am.url}/api/v2/alerts`)).json()).toEqual([]);
	});

	it("reports an uptime an hour old until it restarts", async () => {
		am = await startFakeAlertmanager();
		const before = await (await fetch(`${am.url}/api/v2/status`)).json();
		expect(Date.now() - Date.parse(before.uptime)).toBeGreaterThan(59 * 60_000);

		am.restart();
		const after = await (await fetch(`${am.url}/api/v2/status`)).json();
		expect(Date.now() - Date.parse(after.uptime)).toBeLessThan(5_000);
	});

	it("posts a v4 group notification: firing alerts, then those cleared since the last post as resolved", async () => {
		const received: Array<{ auth?: string; body: Record<string, unknown> }> = [];
		const sink = createServer((req, res) => {
			let raw = "";
			req.on("data", (c) => {
				raw += c;
			});
			req.on("end", () => {
				received.push({ auth: req.headers.authorization, body: JSON.parse(raw) });
				res.end("{}");
			});
		});
		await new Promise<void>((r) => sink.listen(0, "127.0.0.1", r));
		try {
			const { port } = sink.address() as { port: number };
			const hook = `http://127.0.0.1:${port}/api/webhooks/prometheus`;

			am = await startFakeAlertmanager();
			const a = am.fire({ labels: { alertname: "HighLatency", service: "api" } });
			am.fire({ labels: { alertname: "HighLatency", service: "web" } });
			await am.post(hook, "t0ken");
			am.clear(a.fingerprint);
			await am.post(hook, "t0ken");

			expect(received[0].auth).toBe("Bearer t0ken");
			expect(received[0].body).toMatchObject({
				version: "4",
				status: "firing",
				commonLabels: { alertname: "HighLatency" },
			});
			expect(received[0].body.alerts).toHaveLength(2);
			const second = received[1].body.alerts as Array<{ status: string; fingerprint: string }>;
			expect(second.map((x) => x.status).sort()).toEqual(["firing", "resolved"]);
			expect(second.find((x) => x.status === "resolved")?.fingerprint).toBe(a.fingerprint);
		} finally {
			await new Promise<void>((r) => sink.close(() => r()));
		}
	});
});

describe("the fake agent's MCP client (#1061)", () => {
	const result = '{"jsonrpc":"2.0","id":3,"result":{"content":[{"type":"text","text":"opened"}]}}';
	const SSE = "text/event-stream";

	it("reads the last event of a stream whose first frame is a keepalive comment", () => {
		const body = `: keepalive\n\n: keepalive\n\nevent: message\ndata: ${result}\n\n`;
		expect(mcpReplyJson(body, SSE)).toBe(result);
	});

	it("reads the result after a progress event, not the first event", () => {
		const progress = '{"jsonrpc":"2.0","method":"notifications/progress","params":{"progress":1}}';
		const body = `event: message\ndata: ${progress}\n\nevent: message\ndata: ${result}\n\n`;
		expect(mcpReplyJson(body, SSE)).toBe(result);
	});

	it("returns a plain JSON body as it is", () => {
		expect(mcpReplyJson(result, "application/json")).toBe(result);
	});
});
