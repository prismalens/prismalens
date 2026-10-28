// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { TERMINAL_SOCKET_PATH } from "@prismalens/contracts";
import { terminalKeyFor } from "@prismalens/auth";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import type { Pty, PtyFactory } from "./pty.js";
import { type GateDevice, TerminalGate } from "./terminal-gate.js";
import { TerminalSocketServer } from "./terminal-socket.js";

const SECRET = "s".repeat(64);
const HOST_DEVICE: GateDevice = {
	id: "host",
	scopes: ["investigate:read", "investigate:operate", "admin:access"],
};
const PHONE: GateDevice = {
	id: "phone",
	scopes: ["investigate:read", "investigate:operate"],
};

class FakePty implements Pty {
	written: string[] = [];
	paused = false;
	killed = false;
	private data?: (d: string) => void;
	private exit?: (e: { exitCode: number | null }) => void;
	onData(l: (d: string) => void) {
		this.data = l;
	}
	onExit(l: (e: { exitCode: number | null }) => void) {
		this.exit = l;
	}
	write(d: string) {
		this.written.push(d);
	}
	resize() {}
	pause() {
		this.paused = true;
	}
	resume() {
		this.paused = false;
	}
	kill() {
		this.killed = true;
	}
	emit(d: string) {
		this.data?.(d);
	}
	end(code: number) {
		this.exit?.({ exitCode: code });
	}
}

let server: Server;
let port: number;
let gate: TerminalGate;
let ptys: FakePty[];
let cookieDevice: GateDevice | null;
let peer: string;
let sockets: TerminalSocketServer;

const factory: PtyFactory = () => {
	const p = new FakePty();
	ptys.push(p);
	return p;
};

beforeEach(async () => {
	ptys = [];
	cookieDevice = HOST_DEVICE;
	peer = "127.0.0.1";
	server = createServer();
	await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
	port = (server.address() as AddressInfo).port;
	gate = new TerminalGate({
		secret: () => SECRET,
		listeningPort: () => port,
		peerAddress: () => peer,
	});
	sockets = new TerminalSocketServer({
		gate,
		authenticate: async () => cookieDevice,
		loadPty: async () => factory,
		shell: () => ({ file: "sh", args: [], cwd: "/" }),
		env: () => ({}),
		highWater: 64,
		lowWater: 16,
	});
	server.on("upgrade", (req, socket, head) => {
		if (!sockets.handleUpgrade(req, socket, head)) socket.destroy();
	});
});

afterEach(async () => {
	sockets.closeAll();
	await new Promise<void>((r) => server.close(() => r()));
});

const origin = () => `http://127.0.0.1:${port}`;
function request(headers: Record<string, string> = {}): IncomingMessage {
	return {
		headers: { host: `127.0.0.1:${port}`, origin: origin(), ...headers },
		socket: { remoteAddress: "127.0.0.1" },
	} as unknown as IncomingMessage;
}

function open(
	ticket: string | undefined,
	headers: Record<string, string> = {},
): Promise<{ ws: WebSocket; status: number | "open" }> {
	const url = `ws://127.0.0.1:${port}${TERMINAL_SOCKET_PATH}${ticket ? `?ticket=${ticket}` : ""}`;
	const ws = new WebSocket(url, { headers: { origin: origin(), ...headers } });
	return new Promise((resolve) => {
		ws.on("open", () => resolve({ ws, status: "open" }));
		ws.on("unexpected-response", (_req, res) =>
			resolve({ ws, status: res.statusCode ?? 0 }),
		);
		ws.on("error", () => resolve({ ws, status: 0 }));
	});
}

const hostKey = () => terminalKeyFor(HOST_DEVICE.id, SECRET);
const ticketFor = async (device = HOST_DEVICE) => {
	const minted = await gate.mintTicket(request(), device, terminalKeyFor(device.id, SECRET));
	if (!("ticket" in minted)) throw new Error(`refused: ${minted.reason}`);
	return minted.ticket;
};

describe("TerminalGate.availability", () => {
	it("is available to the host's own browser holding its key", async () => {
		expect(await gate.availability(request(), HOST_DEVICE, hostKey(), true)).toEqual({
			available: true,
		});
	});

	it("is not-host for a paired phone or laptop, key or not", async () => {
		expect(
			await gate.availability(request(), PHONE, terminalKeyFor(PHONE.id, SECRET), true),
		).toEqual({ available: false, reason: "not-host" });
	});

	it("is not-host through tailscale serve, even for the host's own device and key", async () => {
		const proxied = request({
			host: "box.tail1234.ts.net",
			origin: "https://box.tail1234.ts.net",
			"x-forwarded-host": "box.tail1234.ts.net",
		});
		expect(await gate.availability(proxied, HOST_DEVICE, hostKey(), true)).toEqual({
			available: false,
			reason: "not-host",
		});
	});

	it("is no-key for the host's browser without its key, or with another device's", async () => {
		expect(await gate.availability(request(), HOST_DEVICE, undefined, true)).toEqual({
			available: false,
			reason: "no-key",
		});
		expect(
			await gate.availability(request(), HOST_DEVICE, terminalKeyFor("other", SECRET), true),
		).toEqual({ available: false, reason: "no-key" });
	});

	it("is unsupported when the PTY module did not load", async () => {
		expect(await gate.availability(request(), HOST_DEVICE, hostKey(), false)).toEqual({
			available: false,
			reason: "unsupported",
		});
	});

	it("mints no ticket for a remote device", async () => {
		expect(
			await gate.mintTicket(request(), PHONE, terminalKeyFor(PHONE.id, SECRET)),
		).toEqual({ reason: "not-host" });
		peer = "100.64.0.7";
		expect(await gate.mintTicket(request(), HOST_DEVICE, hostKey())).toEqual({
			reason: "not-host",
		});
	});
});

describe("TerminalSocketServer", () => {
	it("opens a shell for the host and carries input and output", async () => {
		const { ws, status } = await open(await ticketFor());
		expect(status).toBe("open");
		expect(ptys).toHaveLength(1);
		const got = new Promise<string>((r) => ws.once("message", (d) => r(String(d))));
		ptys[0].emit("hello");
		expect(await got).toBe("hello");
		ws.send(JSON.stringify({ t: "in", d: "ls" }));
		await vi.waitFor(() => expect(ptys[0].written).toEqual(["ls"]));
		ws.close();
		await vi.waitFor(() => expect(ptys[0].killed).toBe(true));
	});

	it.each([
		["no ticket", async () => undefined, {}],
		["an unknown ticket", async () => "nope", {}],
		["a request through a proxy", ticketFor, { "x-forwarded-for": "100.64.0.7" }],
		["a page on another localhost port", ticketFor, { origin: "http://localhost:5173" }],
	])("refuses %s with 403 and spawns nothing", async (_label, ticket, headers) => {
		const { status } = await open(await ticket(), headers);
		expect(status).toBe(403);
		expect(ptys).toHaveLength(0);
	});

	it("refuses a replayed ticket", async () => {
		const ticket = await ticketFor();
		const first = await open(ticket);
		expect(first.status).toBe("open");
		const second = await open(ticket);
		expect(second.status).toBe(403);
		expect(ptys).toHaveLength(1);
	});

	it("refuses an expired ticket", async () => {
		vi.useFakeTimers({ toFake: ["Date"] });
		try {
			const ticket = await ticketFor();
			vi.setSystemTime(Date.now() + 31_000);
			expect((await open(ticket)).status).toBe(403);
		} finally {
			vi.useRealTimers();
		}
	});

	it("refuses a ticket when the cookie now names another device or a remote one", async () => {
		const ticket = await ticketFor();
		cookieDevice = PHONE;
		expect((await open(ticket)).status).toBe(403);
		cookieDevice = null;
		expect((await open(await ticketFor())).status).toBe(403);
		expect(ptys).toHaveLength(0);
	});

	it("writes a staged command with Enter, and refuses one with control characters", async () => {
		const { ws } = await open(await ticketFor());
		ws.send(JSON.stringify({ t: "run", d: "pl doctor" }));
		await vi.waitFor(() => expect(ptys[0].written).toEqual(["pl doctor\r"]));
		ws.send(JSON.stringify({ t: "run", d: "printf x\u000f" }));
		ws.send(JSON.stringify({ t: "run", d: "ls\nrm -rf ~" }));
		ws.send(JSON.stringify({ t: "in", d: "z" }));
		await vi.waitFor(() => expect(ptys[0].written).toEqual(["pl doctor\r", "z"]));
		ws.close();
	});

	it("pauses the shell while the browser has too much unacknowledged output", async () => {
		const { ws } = await open(await ticketFor());
		ws.on("message", () => {});
		ptys[0].emit("x".repeat(80));
		expect(ptys[0].paused).toBe(true);
		ws.send(JSON.stringify({ t: "ack", n: 70 }));
		await vi.waitFor(() => expect(ptys[0].paused).toBe(false));
		ws.close();
	});

	it("tells the browser the exit code and kills the PTY when the shell exits", async () => {
		const { ws } = await open(await ticketFor());
		const got = new Promise<string>((r) => ws.once("message", (d) => r(String(d))));
		ptys[0].end(3);
		expect(JSON.parse(await got)).toEqual({ t: "exit", code: 3 });
		expect(ptys[0].killed).toBe(true);
	});

	it("ignores upgrades on other paths", () => {
		const req = { url: "/api/other" } as IncomingMessage;
		expect(sockets.handleUpgrade(req, {} as never, Buffer.alloc(0))).toBe(false);
	});
});
