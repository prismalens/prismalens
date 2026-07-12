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
import type { GroupingPort } from "../cli/grouping.js";


export interface ListenServerOptions {
	/** Port to bind (0 = ephemeral, for tests). */
	port: number;
	/** Host to bind (default 127.0.0.1). */
	host?: string;
	/** Shared bearer token; every request without it gets 401. */
	token: string;
	/** Grouping layer. */
	grouping: GroupingPort;

	/**
	 * Max alerts waiting or running at once. A payload that would overflow gets
	 * 503 so Alertmanager's durable retry absorbs the backpressure. To prevent
	 * permanent 503s for oversized groups, an empty queue always admits a payload
	 * regardless of size. Default 8.
	 */
	maxPending?: number;

	log?: (line: string) => void;
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
	// grouping owns dispatch; `server.ts` only gates admission via `pendingGroups()`/`newGroupCount()` against `maxPending`.
	const maxPending = options.maxPending ?? DEFAULT_MAX_PENDING;

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

		// Reject before reading the body: a slow in-flight client must not be
		// able to delay server.close() during shutdown.
		if (options.grouping.isShuttingDown()) {
			reply(res, 503, { error: "server is shutting down" });
			req.destroy();
			return;
		}

		const raw = await readBody(req);
		if (raw === null) {
			reply(res, 413, { error: "request body too large" });
			req.destroy();
			return;
		}
		let payloadObj: unknown;
		try {
			payloadObj = JSON.parse(raw);
		} catch {
			reply(res, 400, { error: "request body is not valid JSON" });
			return;
		}
		const parsed = PrometheusWebhookSchema.safeParse(payloadObj);
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
		// an investigation takes minutes. Firing alerts only (which are grouped and
		// investigated via the grouping layer); resolved ones are just acknowledged,
		// not fed into lifecycle tracking (future work).
		const firing = parsed.data.alerts.filter(
			(a) => a.status === "firing",
		) as Record<string, unknown>[];
		const payload = payloadObj as Record<string, unknown>;

		const pendingGroups = options.grouping.pendingGroups();
		const newGroupCount = options.grouping.newGroupCount(firing, payload);
		if (
			newGroupCount > 0 &&
			pendingGroups > 0 &&
			pendingGroups + newGroupCount > maxPending
		) {
			// Whole-payload rejection (no partial acceptance): Alertmanager retries
			// the notification later; nothing 202'd is ever silently dropped.
			// To avoid a permanent 503 loop for groups larger than the cap, we ALWAYS
			// admit payloads when the queue is entirely empty (pending === 0).
			reply(res, 503, {
				error: `investigation queue full (${pendingGroups} pending, max ${maxPending}) — retry later`,
			});
			return;
		}
		reply(res, 202, {
			received: parsed.data.alerts.length,
			accepted: firing.length,
		});

		options.grouping.admit(firing, payload);
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
		server.listen(options.port, options.host ?? "127.0.0.1", () => resolve());
	});
	const address = server.address();
	/* v8 ignore next 3 — a TCP listen never yields a pipe/null address */
	if (address === null || typeof address === "string") {
		throw new Error("listen server bound to a non-TCP address");
	}

	return {
		port: address.port,
		close: () => {
			options.grouping.shutdown();
			return new Promise<void>((resolve, reject) => {
				server.close((err) => (err ? reject(err) : resolve()));
			});
		},
	};
}
