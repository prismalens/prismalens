// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Per-device foreground leases (#1101 category 4): a visible tab holds one and
 * renews it; a hidden tab or a revoked device holds none. Kept in memory: after a
 * restart every visible tab renews within one TTL.
 */
export const PRESENCE_TTL_MS = 60_000;

interface Lease {
	threadId: string | null;
	expiresAt: number;
}

export class PresenceLeases {
	private readonly leases = new Map<string, Lease>();

	constructor(private readonly ttlMs = PRESENCE_TTL_MS) {}

	hold(deviceId: string, threadId: string | null, now = Date.now()): void {
		this.leases.set(deviceId, { threadId, expiresAt: now + this.ttlMs });
	}

	drop(deviceId: string): void {
		this.leases.delete(deviceId);
	}

	/** Devices holding a live lease on this thread, revoked ones left out. */
	viewers(
		threadId: string,
		now = Date.now(),
		revoked: ReadonlySet<string> = new Set(),
	): string[] {
		const out: string[] = [];
		for (const [deviceId, lease] of this.leases) {
			if (lease.expiresAt <= now) {
				this.leases.delete(deviceId);
				continue;
			}
			if (lease.threadId === threadId && !revoked.has(deviceId))
				out.push(deviceId);
		}
		return out;
	}

	/** Every device holding a live lease, on any page. */
	holders(now = Date.now()): string[] {
		const out: string[] = [];
		for (const [deviceId, lease] of this.leases)
			if (lease.expiresAt > now) out.push(deviceId);
		return out;
	}
}
