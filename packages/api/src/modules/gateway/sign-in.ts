// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Pending sign-ins keyed by their single-use state (#848). The loopback listener and the
 * server callback route both finish a flow here; 04's OAuth and 06's MCP sign-in share it.
 */
import {
	BadRequestException,
	Injectable,
	type OnModuleDestroy,
} from "@nestjs/common";
import { LOOPBACK_REDIRECT_URI } from "@prismalens/contracts/schemas";
import { OAuthLoopback } from "./oauth-loopback.js";

export type SignInError = "state" | "denied" | "exchange" | "probe" | "name";
export type SignInOutcome = { connectionId: string } | { error: SignInError };

export interface PendingFlow {
	complete(params: URLSearchParams): Promise<SignInOutcome>;
}

const TTL_MS = 10 * 60_000;
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "[::1]", "::1", "localhost"]);

export const CALLBACK_PATH = "/api/sources/oauth/callback";

@Injectable()
export class SignIns implements OnModuleDestroy {
	private readonly pending = new Map<
		string,
		{ flow: PendingFlow; expiresAt: number }
	>();
	/** A test swaps it for one on another port. */
	loopback = new OAuthLoopback(
		async (p) => "connectionId" in (await this.complete(p)),
	);

	onModuleDestroy(): void {
		this.loopback.close();
	}

	/**
	 * Where the browser comes back: the pinned loopback for a local origin, otherwise the
	 * server's own callback route, which must be exactly `<Origin>/api/sources/oauth/callback`.
	 */
	redirectFor(
		origin: string | undefined,
		requested?: string,
	): { redirectUri: string; loopback: boolean } {
		let host = "";
		try {
			host = origin ? new URL(origin).hostname : "";
		} catch {
			host = "";
		}
		if (!origin || LOOPBACK_HOSTS.has(host))
			return { redirectUri: LOOPBACK_REDIRECT_URI, loopback: true };
		const expected = `${new URL(origin).origin}${CALLBACK_PATH}`;
		if (requested && requested !== expected)
			throw new BadRequestException(
				`The callback for this server is ${expected}`,
			);
		return { redirectUri: expected, loopback: false };
	}

	async register(
		state: string,
		flow: PendingFlow,
		loopback: boolean,
	): Promise<void> {
		this.sweep();
		if (loopback) await this.loopback.expect(state);
		this.pending.set(state, { flow, expiresAt: Date.now() + TTL_MS });
	}

	/** Looks the state up and deletes it before anything else runs. */
	async complete(params: URLSearchParams): Promise<SignInOutcome> {
		const state = params.get("state") ?? "";
		const hit = this.pending.get(state);
		this.pending.delete(state);
		if (!hit || hit.expiresAt < Date.now()) return { error: "state" };
		if (params.get("error")) return { error: "denied" };
		return hit.flow.complete(params);
	}

	private sweep(): void {
		const now = Date.now();
		for (const [k, v] of this.pending)
			if (v.expiresAt < now) this.pending.delete(k);
	}
}
