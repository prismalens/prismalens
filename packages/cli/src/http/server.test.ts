// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * `pl listen` HTTP intake (issue #58) — behavior tests at the HTTP boundary.
 * A real server on an ephemeral port, a fake injected investigation runner:
 * the seam under test is the wire contract (auth → validation → dispatch),
 * not the investigation pipeline (covered by the runner's own tests).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { type ListenServer, startListenServer } from "./server.js";

const TOKEN = "s3cret-test-token";

let server: ListenServer | undefined;
afterEach(async () => {
	await server?.close();
	server = undefined;
});

async function start(
	runInvestigation: (
		alert: Record<string, unknown>,
	) => Promise<void> = async () => {},
): Promise<ListenServer> {
	server = await startListenServer({ port: 0, token: TOKEN, runInvestigation });
	return server;
}

function post(
	srv: ListenServer,
	body: string,
	headers: Record<string, string> = {},
): Promise<Response> {
	return fetch(`http://127.0.0.1:${srv.port}/webhooks/alertmanager`, {
		method: "POST",
		headers: { "content-type": "application/json", ...headers },
		body,
	});
}

describe("listen HTTP intake — auth (401 without the configured token)", () => {
	it("rejects a request with no Authorization header", async () => {
		const srv = await start();
		const res = await post(srv, "{}");
		expect(res.status).toBe(401);
	});

	it("rejects a request with the wrong bearer token", async () => {
		const srv = await start();
		const res = await post(srv, "{}", {
			authorization: "Bearer wrong-token",
		});
		expect(res.status).toBe(401);
	});

	it("rejects a non-Bearer authorization scheme", async () => {
		const srv = await start();
		const res = await post(srv, "{}", {
			authorization: `Basic ${Buffer.from(`x:${TOKEN}`).toString("base64")}`,
		});
		expect(res.status).toBe(401);
	});
});

describe("listen HTTP intake — routing (one POST route, nothing else)", () => {
	it("404s a request to any other path, even authed with a valid body", async () => {
		const srv = await start();
		const res = await fetch(`http://127.0.0.1:${srv.port}/other`, {
			method: "POST",
			headers: { "content-type": "application/json", ...auth() },
			body: JSON.stringify(alertmanagerPayload()),
		});
		expect(res.status).toBe(404);
	});

	it("405s a non-POST request to the webhook path", async () => {
		const srv = await start();
		const res = await fetch(
			`http://127.0.0.1:${srv.port}/webhooks/alertmanager`,
			{ headers: auth() },
		);
		expect(res.status).toBe(405);
	});
});

describe("listen HTTP intake — payload validation (4xx with a reason, never silent)", () => {
	it("rejects a body that is not JSON with 400 and a reason", async () => {
		const srv = await start();
		const res = await post(srv, "not json {", auth());
		expect(res.status).toBe(400);
		const body = (await res.json()) as { error: string };
		expect(body.error).toMatch(/JSON/i);
	});

	it("rejects an oversized body with 413 before parsing it", async () => {
		const srv = await start();
		const huge = `{"pad":"${"x".repeat(6 * 1024 * 1024)}"}`;
		const res = await post(srv, huge, auth());
		expect(res.status).toBe(413);
	});

	it("rejects JSON that is not an Alertmanager payload with 400 and the validation reason", async () => {
		const srv = await start();
		// Missing `alerts` + `status` — valid JSON, invalid PrometheusWebhookSchema.
		const res = await post(srv, JSON.stringify({ version: "4" }), auth());
		expect(res.status).toBe(400);
		const body = (await res.json()) as { error: string };
		expect(body.error).toMatch(/alerts/);
	});
});

function auth(): Record<string, string> {
	return { authorization: `Bearer ${TOKEN}` };
}

/** A minimal valid Alertmanager payload (one firing, one resolved alert). */
function alertmanagerPayload(): Record<string, unknown> {
	return {
		version: "4",
		status: "firing",
		alerts: [
			{
				status: "firing",
				labels: { alertname: "HighCPU", service: "checkout" },
				startsAt: "2026-07-09T03:00:00Z",
			},
			{
				status: "resolved",
				labels: { alertname: "OldAlert" },
				startsAt: "2026-07-09T01:00:00Z",
			},
		],
	};
}

describe("listen HTTP intake — dispatch (valid alert → investigation)", () => {
	it("202-accepts a valid payload and runs an investigation per FIRING alert", async () => {
		const seen: Record<string, unknown>[] = [];
		const srv = await start(async (alert) => {
			seen.push(alert);
		});
		const res = await post(srv, JSON.stringify(alertmanagerPayload()), auth());
		expect(res.status).toBe(202);
		expect(await res.json()).toEqual({ received: 2, accepted: 1 });
		// Dispatch is async (the 202 answers before the investigation finishes).
		await vi.waitFor(() => expect(seen).toHaveLength(1));
		expect(seen[0]?.labels).toMatchObject({ alertname: "HighCPU" });
	});

	it("runs investigations strictly one at a time, in arrival order", async () => {
		let releaseFirst = (): void => {};
		const gate = new Promise<void>((r) => {
			releaseFirst = r;
		});
		const events: string[] = [];
		const srv = await start(async (alert) => {
			const name = (alert.labels as Record<string, string>).alertname;
			events.push(`start:${name}`);
			if (name === "First") await gate;
			events.push(`end:${name}`);
		});

		const mk = (alertname: string) =>
			JSON.stringify({
				status: "firing",
				alerts: [
					{
						status: "firing",
						labels: { alertname },
						startsAt: "2026-07-09T03:00:00Z",
					},
				],
			});
		expect((await post(srv, mk("First"), auth())).status).toBe(202);
		expect((await post(srv, mk("Second"), auth())).status).toBe(202);

		await vi.waitFor(() => expect(events).toContain("start:First"));
		// Second must NOT start while First is still running.
		expect(events).not.toContain("start:Second");
		releaseFirst();
		await vi.waitFor(() => expect(events).toContain("end:Second"));
		expect(events).toEqual([
			"start:First",
			"end:First",
			"start:Second",
			"end:Second",
		]);
	});

	it("503s a payload that would overflow the pending queue, so Alertmanager retries it", async () => {
		let release = (): void => {};
		const gate = new Promise<void>((r) => {
			release = r;
		});
		server = await startListenServer({
			port: 0,
			token: TOKEN,
			maxPending: 2,
			runInvestigation: async () => gate,
		});
		const srv = server;

		const mk = (alertname: string) =>
			JSON.stringify({
				status: "firing",
				alerts: [
					{
						status: "firing",
						labels: { alertname },
						startsAt: "2026-07-09T03:00:00Z",
					},
				],
			});
		// First fills the (blocked) runner, second waits in queue = capacity 2.
		expect((await post(srv, mk("A"), auth())).status).toBe(202);
		expect((await post(srv, mk("B"), auth())).status).toBe(202);
		const overflow = await post(srv, mk("C"), auth());
		expect(overflow.status).toBe(503);
		const body = (await overflow.json()) as { error: string };
		expect(body.error).toMatch(/queue/i);
		release();
	});

	it("keeps serving (and reports via onRunError) when an investigation rejects", async () => {
		const failures: string[] = [];
		const calls: string[] = [];
		server = await startListenServer({
			port: 0,
			token: TOKEN,
			runInvestigation: async (alert) => {
				const name = (alert.labels as Record<string, string>).alertname;
				calls.push(name);
				if (name === "Boom") throw new Error("harness exploded");
			},
			onRunError: (err) => {
				failures.push(err instanceof Error ? err.message : String(err));
			},
		});
		const srv = server;

		const mk = (alertname: string) =>
			JSON.stringify({
				status: "firing",
				alerts: [
					{
						status: "firing",
						labels: { alertname },
						startsAt: "2026-07-09T03:00:00Z",
					},
				],
			});
		expect((await post(srv, mk("Boom"), auth())).status).toBe(202);
		expect((await post(srv, mk("After"), auth())).status).toBe(202);

		await vi.waitFor(() => expect(calls).toEqual(["Boom", "After"]));
		expect(failures).toEqual(["harness exploded"]);
	});

	it("logs a rejected investigation to console.error when no onRunError is given (never silent)", async () => {
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		try {
			const srv = await start(async () => {
				throw new Error("harness exploded");
			});
			const res = await post(
				srv,
				JSON.stringify(alertmanagerPayload()),
				auth(),
			);
			expect(res.status).toBe(202);
			await vi.waitFor(() => expect(errorSpy).toHaveBeenCalled());
			const logged = errorSpy.mock.calls.flat().map(String).join(" ");
			expect(logged).toContain("harness exploded");
		} finally {
			errorSpy.mockRestore();
		}
	});
});
