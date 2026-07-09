// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * `pl listen` HTTP intake (issue #58) — a token-authed local webhook receiver
 * for Alertmanager. Plain `node:http`: one POST route, no framework. The
 * investigation runner is INJECTED (the command wires the real seam chain;
 * tests wire a fake) so the wire contract and the pipeline stay separately
 * testable, mirroring how `jsonrpc/server.ts` takes injectable streams.
 */
import { timingSafeEqual } from "node:crypto";
import {
	createServer,
	type IncomingMessage,
	type ServerResponse,
} from "node:http";
import { PrometheusWebhookSchema } from "@prismalens/contracts";

export interface ListenServerOptions {
	/** Port to bind (0 = ephemeral, for tests). */
	port: number;
	/** Shared bearer token; every request without it gets 401. */
	token: string;
	/** Investigation executor invoked per accepted alert (injected seam). */
	runInvestigation: (alert: Record<string, unknown>) => Promise<void>;
	/** Called when a queued investigation rejects; the server never crashes. */
	onRunError?: (err: unknown, alert: Record<string, unknown>) => void;
	/**
	 * Max alerts waiting or running at once. A payload that would overflow gets
	 * 503 so Alertmanager's durable retry absorbs the backpressure — an accepted
	 * 202 must never quietly become a dropped alert. Default 8.
	 */
	maxPending?: number;
}

const DEFAULT_MAX_PENDING = 8;

/** The one route this receiver serves (Alertmanager webhook_config url path). */
export const WEBHOOK_PATH = "/webhooks/alertmanager";

export interface ListenServer {
	/** The actually-bound port (resolves port 0). */
	port: number;
	close(): Promise<void>;
}

/** Constant-time bearer-token check — never leak a prefix match via timing. */
function isAuthorized(req: IncomingMessage, token: string): boolean {
	const header = req.headers.authorization;
	if (!header?.startsWith("Bearer ")) return false;
	const presented = Buffer.from(header.slice("Bearer ".length));
	const expected = Buffer.from(token);
	return (
		presented.length === expected.length && timingSafeEqual(presented, expected)
	);
}

/** An Alertmanager payload is KBs; anything past this is not a webhook. */
const MAX_BODY_BYTES = 5 * 1024 * 1024;

/** Collect the request body as UTF-8, or null once it exceeds the cap. */
async function readBody(req: IncomingMessage): Promise<string | null> {
	const chunks: Buffer[] = [];
	let size = 0;
	for await (const chunk of req) {
		size += (chunk as Buffer).length;
		if (size > MAX_BODY_BYTES) return null;
		chunks.push(chunk as Buffer);
	}
	return Buffer.concat(chunks).toString("utf-8");
}

/** Start the intake server; resolves once the port is bound. */
export async function startListenServer(
	options: ListenServerOptions,
): Promise<ListenServer> {
	// Sequential FIFO: one investigation at a time, in arrival order. A promise
	// chain, not a worker pool — the walking skeleton's storm posture until the
	// caps slice (#62). A failed run logs and never breaks the chain.
	const maxPending = options.maxPending ?? DEFAULT_MAX_PENDING;
	// Backstop, not caller courtesy: this receiver exists for unattended (3AM)
	// operation, so a failed run must leave a trace even if no handler is wired.
	const onRunError =
		options.onRunError ??
		((err: unknown, alert: Record<string, unknown>): void => {
			const labels = (alert.labels ?? {}) as Record<string, string>;
			console.error(
				`investigation for alert "${labels.alertname ?? "unknown"}" failed:`,
				err,
			);
		});
	let queue: Promise<void> = Promise.resolve();
	let pending = 0;
	const enqueue = (alert: Record<string, unknown>): void => {
		pending += 1;
		queue = queue
			.then(() => options.runInvestigation(alert))
			.catch((err) => onRunError(err, alert))
			.finally(() => {
				pending -= 1;
			});
	};

	const reply = (res: ServerResponse, status: number, body: unknown): void => {
		res.writeHead(status, { "content-type": "application/json" });
		res.end(JSON.stringify(body));
	};

	const handle = async (
		req: IncomingMessage,
		res: ServerResponse,
	): Promise<void> => {
		// Route gate BEFORE auth: a wrong path stays distinguishable from a bad
		// token in the sender's logs (this is a local, single-route receiver).
		const path = (req.url ?? "").split("?", 1)[0];
		if (path !== WEBHOOK_PATH) {
			reply(res, 404, { error: "not found" });
			return;
		}
		if (req.method !== "POST") {
			res.setHeader("allow", "POST");
			reply(res, 405, { error: "method not allowed" });
			return;
		}
		if (!isAuthorized(req, options.token)) {
			reply(res, 401, { error: "unauthorized" });
			return;
		}

		const raw = await readBody(req);
		if (raw === null) {
			reply(res, 413, { error: "request body too large" });
			req.destroy();
			return;
		}
		let payload: unknown;
		try {
			payload = JSON.parse(raw);
		} catch {
			reply(res, 400, { error: "request body is not valid JSON" });
			return;
		}
		const parsed = PrometheusWebhookSchema.safeParse(payload);
		if (!parsed.success) {
			// Never silently swallow a bad payload (unlike parseStdin): surface the
			// zod reason so a misconfigured Alertmanager is debuggable from its logs.
			const reason = parsed.error.issues
				.map((i) => `${i.path.join(".") || "payload"}: ${i.message}`)
				.join("; ");
			reply(res, 400, { error: `invalid Alertmanager payload — ${reason}` });
			return;
		}

		// Answer BEFORE investigating: Alertmanager's webhook timeout is seconds,
		// an investigation takes minutes. Firing alerts only; resolved ones are
		// acknowledged but not investigated (grouping/lifecycle is the next slice).
		const firing = parsed.data.alerts.filter((a) => a.status === "firing");
		if (pending + firing.length > maxPending) {
			// Whole-payload rejection (no partial acceptance): Alertmanager retries
			// the notification later; nothing 202'd is ever silently dropped.
			reply(res, 503, {
				error: `investigation queue full (${pending} pending, max ${maxPending}) — retry later`,
			});
			return;
		}
		reply(res, 202, {
			received: parsed.data.alerts.length,
			accepted: firing.length,
		});
		for (const alert of firing) enqueue(alert);
	};

	const server = createServer((req, res) => {
		// Last-resort guard: every expected failure is already replied to inside
		// handle(); this only fires on e.g. a socket torn down mid-read.
		/* v8 ignore next 4 */
		handle(req, res).catch(() => {
			if (!res.headersSent) reply(res, 500, { error: "internal error" });
			else res.end();
		});
	});
	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(options.port, "127.0.0.1", () => resolve());
	});
	const address = server.address();
	/* v8 ignore next 3 — a TCP listen never yields a pipe/null address */
	if (address === null || typeof address === "string") {
		throw new Error("listen server bound to a non-TCP address");
	}

	return {
		port: address.port,
		close: () =>
			new Promise<void>((resolve, reject) => {
				server.close((err) => (err ? reject(err) : resolve()));
			}),
	};
}
