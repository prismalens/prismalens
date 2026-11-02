// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { randomBytes } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { ACCESS_SCOPE, terminalKeyMatches } from "@prismalens/auth";
import type { TerminalAvailability } from "@prismalens/contracts";
import { localRequestRefusal } from "./local-request.js";

export interface GateDevice {
	id: string;
	scopes: readonly string[];
}

export interface TerminalGateOptions {
	secret: () => string;
	/** Defaults to the port the request arrived on. */
	listeningPort?: () => number;
	devOrigin?: string;
	/** The TCP peer; tests stand in for a remote one. */
	peerAddress?: (req: IncomingMessage) => string | undefined;
	ticketTtlMs?: number;
}

/**
 * Who may open a terminal (#931): a device holding `admin:access`, asking
 * straight from the host (local-request.ts), with the terminal key only a
 * local redeem hands out. Everything else is "not-host" or "no-key".
 */
export class TerminalGate {
	private readonly tickets = new Map<
		string,
		{ deviceId: string; expires: number }
	>();

	constructor(private readonly options: TerminalGateOptions) {}

	isLocal(req: IncomingMessage): boolean {
		return (
			localRequestRefusal({
				remoteAddress:
					this.options.peerAddress?.(req) ?? req.socket?.remoteAddress,
				headers: req.headers,
				listeningPort:
					this.options.listeningPort?.() ?? req.socket?.localPort ?? -1,
				devOrigin: this.options.devOrigin,
			}) === null
		);
	}

	/** True for an operator device asking from the host itself, whatever its key. */
	isHostRequest(req: IncomingMessage, device: GateDevice | null): boolean {
		return (
			!!device && device.scopes.includes(ACCESS_SCOPE) && this.isLocal(req)
		);
	}

	async availability(
		req: IncomingMessage,
		device: GateDevice | null,
		key: string | undefined,
		ptyLoaded: boolean,
	): Promise<TerminalAvailability> {
		if (!this.isHostRequest(req, device))
			return { available: false, reason: "not-host" };
		if (!device || !terminalKeyMatches(key, device.id, this.options.secret()))
			return { available: false, reason: "no-key" };
		if (!ptyLoaded) return { available: false, reason: "unsupported" };
		return { available: true };
	}

	async mintTicket(
		req: IncomingMessage,
		device: GateDevice | null,
		key: string | undefined,
	): Promise<
		{ ticket: string; expiresAt: Date } | { reason: "not-host" | "no-key" }
	> {
		if (!device || !this.isHostRequest(req, device))
			return { reason: "not-host" };
		if (!terminalKeyMatches(key, device.id, this.options.secret()))
			return { reason: "no-key" };
		this.sweep();
		const ticket = randomBytes(32).toString("base64url");
		const expires = Date.now() + (this.options.ticketTtlMs ?? 30_000);
		this.tickets.set(ticket, { deviceId: device.id, expires });
		return { ticket, expiresAt: new Date(expires) };
	}

	/** The device a ticket was minted for, once; null when unknown, used or expired. */
	consumeTicket(ticket: string | null): string | null {
		if (!ticket) return null;
		const entry = this.tickets.get(ticket);
		this.tickets.delete(ticket);
		if (!entry || entry.expires <= Date.now()) return null;
		return entry.deviceId;
	}

	private sweep(): void {
		const now = Date.now();
		for (const [ticket, entry] of this.tickets)
			if (entry.expires <= now) this.tickets.delete(ticket);
	}
}
