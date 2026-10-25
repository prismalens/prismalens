// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const digest = (token: string): Buffer =>
	createHash("sha256").update(token).digest();

/**
 * One bearer per live run, held only as its sha256 in memory (#848). A token
 * opens its own run's path and nothing else; it dies when the run ends, and a
 * restart forgets every one.
 */
export class RunTokens {
	private readonly hashes = new Map<string, Buffer>();

	/** A fresh token for the run; a second mint (a follow-up's `session/load`) replaces the first. */
	mint(runId: string): string {
		const token = randomBytes(32).toString("base64url");
		this.hashes.set(runId, digest(token));
		return token;
	}

	verify(runId: string, token: string | null): boolean {
		const held = this.hashes.get(runId);
		if (!held || !token) return false;
		return timingSafeEqual(held, digest(token));
	}

	revoke(runId: string): void {
		this.hashes.delete(runId);
	}
}

/** The token of an `Authorization: Bearer <token>` header; null for anything else. */
export function bearerOf(header: string | null | undefined): string | null {
	const match = /^Bearer ([^\s]+)$/.exec(header ?? "");
	return match?.[1] ?? null;
}
