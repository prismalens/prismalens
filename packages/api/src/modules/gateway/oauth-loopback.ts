// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The pinned loopback callback for local sign-in (#848, RFC 8252 §7.3): 127.0.0.1:6474
 * only, open while a sign-in is pending, closed after its callback or 10 minutes.
 */
import { createServer, type Server } from "node:http";
import { LOOPBACK_PORT } from "@prismalens/contracts/schemas";

export const LOOPBACK_BUSY =
	"Sign-in needs port 6474 on this machine; close what uses it, or use a token.";

export class LoopbackBusyError extends Error {
	constructor() {
		super(LOOPBACK_BUSY);
	}
}

const PAGE = (text: string) =>
	`<!doctype html><meta charset="utf-8"><title>PrismaLens</title><p style="font-family:sans-serif">${text}</p>`;

export interface LoopbackOptions {
	port?: number;
	ttlMs?: number;
}

export class OAuthLoopback {
	private server: Server | null = null;
	private starting: Promise<void> | null = null;
	private readonly pending = new Map<string, NodeJS.Timeout>();
	private readonly port: number;
	private readonly ttlMs: number;

	/** `handle` completes the sign-in; true shows the signed-in page. */
	constructor(
		private readonly handle: (params: URLSearchParams) => Promise<boolean>,
		opts: LoopbackOptions = {},
	) {
		this.port = opts.port ?? LOOPBACK_PORT;
		this.ttlMs = opts.ttlMs ?? 10 * 60_000;
	}

	get listening(): boolean {
		return this.server?.listening ?? false;
	}

	/** Opens the listener if needed and waits for one callback carrying `state`. */
	async expect(state: string): Promise<void> {
		if (!this.server) {
			this.starting ??= this.listen().finally(() => {
				this.starting = null;
			});
			await this.starting;
		}
		this.pending.set(
			state,
			setTimeout(() => this.settle(state), this.ttlMs).unref(),
		);
	}

	close(): void {
		for (const t of this.pending.values()) clearTimeout(t);
		this.pending.clear();
		this.server?.close();
		this.server?.closeAllConnections();
		this.server = null;
	}

	private settle(state: string): void {
		clearTimeout(this.pending.get(state));
		this.pending.delete(state);
		if (this.pending.size === 0) this.close();
	}

	private listen(): Promise<void> {
		const server = createServer((req, res) => {
			const url = new URL(req.url ?? "/", `http://127.0.0.1:${this.port}`);
			const state = url.searchParams.get("state") ?? "";
			const reply = (status: number, text: string) => {
				res.writeHead(status, {
					"content-type": "text/html; charset=utf-8",
					"cache-control": "no-store",
				});
				res.end(PAGE(text));
			};
			if (
				req.method !== "GET" ||
				url.pathname !== "/callback" ||
				!this.pending.has(state)
			) {
				reply(
					400,
					"This sign-in is not pending. Start it again in PrismaLens.",
				);
				return;
			}
			clearTimeout(this.pending.get(state));
			this.pending.delete(state);
			this.handle(url.searchParams)
				.catch(() => false)
				.then((ok) => {
					res.once("finish", () => {
						if (this.pending.size === 0) this.close();
					});
					reply(
						ok ? 200 : 400,
						ok
							? "Signed in — return to PrismaLens."
							: "Sign-in did not finish — return to PrismaLens and try again.",
					);
				});
		});
		return new Promise((resolve, reject) => {
			server.once("error", (e: NodeJS.ErrnoException) =>
				reject(e.code === "EADDRINUSE" ? new LoopbackBusyError() : e),
			);
			server.listen(this.port, "127.0.0.1", () => {
				this.server = server;
				resolve();
			});
		});
	}
}
