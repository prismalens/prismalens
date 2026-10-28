// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import {
	runnableCommand,
	TERMINAL_SOCKET_PATH,
	TerminalClientFrameSchema,
} from "@prismalens/contracts";
import { type WebSocket, WebSocketServer } from "ws";
import type { PtyFactory } from "./pty.js";
import type { GateDevice, TerminalGate } from "./terminal-gate.js";

export interface TerminalSocketOptions {
	gate: TerminalGate;
	/** The device behind the request's cookie, re-read on every check. */
	authenticate: (req: IncomingMessage) => Promise<GateDevice | null>;
	loadPty: () => Promise<PtyFactory | null>;
	shell: () => { file: string; args: string[]; cwd: string };
	env: () => Record<string, string>;
	/** Unacknowledged output bytes that pause the shell, and resume it. */
	highWater?: number;
	lowWater?: number;
	/** A browser that stays paused this long is cut off and its shell killed. */
	stallMs?: number;
	maxSessions?: number;
	/** How often a live terminal re-checks its device (revocation). */
	recheckMs?: number;
}

const INPUT_LIMIT = 64 * 1024;

/**
 * The terminal socket (#931). The upgrade never reaches Express, so its host
 * allowlist does not run here: every check happens in admit(), before the
 * handshake completes and before anything spawns.
 */
export class TerminalSocketServer {
	private readonly wss = new WebSocketServer({
		noServer: true,
		maxPayload: INPUT_LIMIT,
	});
	private readonly live = new Set<WebSocket>();
	/** Admitted upgrades still loading the PTY; they hold a slot under the cap. */
	private pending = 0;

	constructor(private readonly options: TerminalSocketOptions) {}

	/** False when the upgrade is not for the terminal, so the caller can route it elsewhere. */
	handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): boolean {
		let url: URL;
		try {
			url = new URL(req.url ?? "/", "http://localhost");
		} catch {
			return false;
		}
		if (url.pathname !== TERMINAL_SOCKET_PATH) return false;
		void this.admit(req, socket, head, url).catch(() => refuse(socket, 500));
		return true;
	}

	closeAll(): void {
		for (const ws of this.live) ws.terminate();
		this.live.clear();
	}

	private async admit(
		req: IncomingMessage,
		socket: Duplex,
		head: Buffer,
		url: URL,
	) {
		const { gate } = this.options;
		const deviceId = gate.consumeTicket(url.searchParams.get("ticket"));
		if (!deviceId || !gate.isLocal(req)) return refuse(socket, 403);
		const device = await this.options.authenticate(req);
		if (!device || device.id !== deviceId || !gate.isHostRequest(req, device))
			return refuse(socket, 403);
		if (this.live.size + this.pending >= (this.options.maxSessions ?? 6))
			return refuse(socket, 429);
		this.pending++;
		try {
			const factory = await this.options.loadPty();
			if (!factory) return refuse(socket, 503);
			this.wss.handleUpgrade(req, socket, head, (ws) =>
				this.start(ws, factory, req, deviceId, url),
			);
		} finally {
			this.pending--;
		}
	}

	private start(
		ws: WebSocket,
		factory: PtyFactory,
		req: IncomingMessage,
		deviceId: string,
		url: URL,
	) {
		const high = this.options.highWater ?? 1024 * 1024;
		const low = this.options.lowWater ?? 256 * 1024;
		const shell = this.options.shell();
		const pty = factory({
			...shell,
			cols: clamp(url.searchParams.get("cols"), 2, 1000, 80),
			rows: clamp(url.searchParams.get("rows"), 1, 500, 24),
			env: this.options.env(),
		});
		this.live.add(ws);
		let unacked = 0;
		let paused = false;
		let stall: NodeJS.Timeout | undefined;
		let ended = false;
		const end = () => {
			if (ended) return;
			ended = true;
			clearTimeout(stall);
			clearInterval(recheck);
			this.live.delete(ws);
			// node-pty keeps a ConPTY handle after the shell exits on Windows; kill releases it.
			try {
				pty.kill();
			} catch {}
		};
		/** Kill first, then drop the socket: a client that ignores the close frame must not keep a shell. */
		const cutOff = () => {
			end();
			ws.terminate();
		};
		/** A PTY that already exited throws on resize or write; that ends this session, not the API. */
		const guarded = (fn: () => void) => {
			if (ended) return;
			try {
				fn();
			} catch {
				cutOff();
			}
		};
		const recheck = setInterval(async () => {
			const device = await this.options.authenticate(req).catch(() => null);
			if (!device || device.id !== deviceId) cutOff();
		}, this.options.recheckMs ?? 15_000);

		pty.onData((data) => {
			if (ws.readyState !== ws.OPEN) return;
			const chunk = Buffer.from(data, "utf8");
			unacked += chunk.length;
			ws.send(chunk);
			if (!paused && unacked > high) {
				paused = true;
				guarded(() => pty.pause());
				stall = setTimeout(cutOff, this.options.stallMs ?? 30_000);
			}
		});
		pty.onExit(({ exitCode }) => {
			if (ws.readyState === ws.OPEN)
				ws.send(JSON.stringify({ t: "exit", code: exitCode }));
			end();
			ws.close(1000);
		});
		ws.on("message", (raw, isBinary) => {
			if (isBinary || ended) return;
			let frame: ReturnType<typeof TerminalClientFrameSchema.safeParse>;
			try {
				frame = TerminalClientFrameSchema.safeParse(JSON.parse(String(raw)));
			} catch {
				return;
			}
			if (!frame.success) return;
			const f = frame.data;
			if (f.t === "in") guarded(() => pty.write(f.d));
			else if (f.t === "run") {
				if (runnableCommand(f.d)) guarded(() => pty.write(`${f.d}\r`));
			} else if (f.t === "resize") guarded(() => pty.resize(f.cols, f.rows));
			else {
				unacked = Math.max(0, unacked - f.n);
				if (paused && unacked < low) {
					paused = false;
					clearTimeout(stall);
					guarded(() => pty.resume());
				}
			}
		});
		ws.on("close", end);
		ws.on("error", end);
	}
}

function refuse(socket: Duplex, status: number): void {
	const text =
		{ 403: "Forbidden", 429: "Too Many Requests", 503: "Service Unavailable" }[
			status
		] ?? "Error";
	if (socket.writable)
		socket.write(
			`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
		);
	socket.destroy();
}

function clamp(
	raw: string | null,
	min: number,
	max: number,
	fallback: number,
): number {
	const n = Number(raw);
	return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
}
