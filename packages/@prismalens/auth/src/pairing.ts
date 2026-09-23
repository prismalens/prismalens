// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Device pairing (ADR 0004 §8), the t3code way.
 *
 * The operator mints a one-time link on the host. The device that opens it
 * exchanges the link token for a device token and holds it until the operator
 * revokes the device. Nothing expires a device on its own: revocation is the
 * control, and it lives on the host.
 *
 * Only hashes are stored. The raw link token is returned once, at creation,
 * and the raw device token once, at redemption. A read of either table can
 * never mint a credential.
 *
 * Everything here is store-agnostic so the CLI (`pl pair`, directly on the
 * workspace database) and the API share one implementation.
 */

import { createHash, randomBytes } from "node:crypto";

/** What a paired device may do. Minting links and revoking devices are not on it. */
export const DEVICE_SCOPES = [
	"investigate:read",
	"investigate:operate",
] as const;
export type DeviceScope = (typeof DEVICE_SCOPES)[number];

export const PAIRING_LINK_TTL_MS = 15 * 60 * 1000;

/** The path the link opens; the SPA reads the token from the fragment, which never reaches a server log. */
export const PAIRING_PATH = "/pair";

export type PairingErrorReason = "invalid" | "expired" | "used";

export class PairingError extends Error {
	constructor(
		public readonly reason: PairingErrorReason,
		message: string,
	) {
		super(message);
		this.name = "PairingError";
	}
}

export interface PairingLinkRecord {
	id: string;
	label: string | null;
	expiresAt: Date;
	usedAt: Date | null;
}

export interface DeviceRecord {
	id: string;
	name: string;
	scopes: string[];
	createdAt: Date;
	lastSeenAt: Date | null;
	revokedAt: Date | null;
}

export interface PairingStore {
	createLink(input: {
		tokenHash: string;
		label: string | null;
		expiresAt: Date;
	}): Promise<PairingLinkRecord>;
	findLinkByHash(tokenHash: string): Promise<PairingLinkRecord | null>;
	/**
	 * Mark the link used and create the device in one transaction. Must throw
	 * when the link is already used, so two devices racing on one link cannot
	 * both win; the unique index on `pairingLinkId` is the backstop.
	 */
	redeemLink(input: {
		linkId: string;
		tokenHash: string;
		name: string;
		scopes: string[];
		userAgent: string | null;
	}): Promise<DeviceRecord>;
	findDeviceByHash(tokenHash: string): Promise<DeviceRecord | null>;
	touchDevice(id: string, at: Date): Promise<void>;
	listDevices(): Promise<DeviceRecord[]>;
	revokeDevice(id: string, at: Date): Promise<DeviceRecord | null>;
}

export function generateToken(): string {
	return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
	return createHash("sha256").update(token).digest("hex");
}

export function buildPairingUrl(origin: string, token: string): string {
	const base = new URL(origin);
	base.pathname = PAIRING_PATH;
	base.search = "";
	base.hash = token;
	return base.toString();
}

export interface CreatedPairingLink {
	id: string;
	token: string;
	expiresAt: Date;
}

export async function createPairingLink(
	store: PairingStore,
	input: { label?: string; ttlMs?: number; now?: Date } = {},
): Promise<CreatedPairingLink> {
	const token = generateToken();
	const now = input.now ?? new Date();
	const link = await store.createLink({
		tokenHash: hashToken(token),
		label: input.label?.trim() || null,
		expiresAt: new Date(now.getTime() + (input.ttlMs ?? PAIRING_LINK_TTL_MS)),
	});
	return { id: link.id, token, expiresAt: link.expiresAt };
}

export interface RedeemedDevice {
	/** Shown once. */
	token: string;
	device: DeviceRecord;
}

export async function redeemPairingLink(
	store: PairingStore,
	input: { token: string; name: string; userAgent?: string; now?: Date },
): Promise<RedeemedDevice> {
	const now = input.now ?? new Date();
	const link = await store.findLinkByHash(hashToken(input.token));
	if (!link) {
		throw new PairingError("invalid", "This pairing link is not valid.");
	}
	if (link.usedAt) {
		throw new PairingError(
			"used",
			"This pairing link was already used. Create a new one on the host.",
		);
	}
	if (link.expiresAt.getTime() <= now.getTime()) {
		throw new PairingError(
			"expired",
			"This pairing link has expired. Create a new one on the host.",
		);
	}
	const deviceToken = generateToken();
	const device = await store.redeemLink({
		linkId: link.id,
		tokenHash: hashToken(deviceToken),
		name: input.name.trim() || link.label || "Paired device",
		scopes: [...DEVICE_SCOPES],
		userAgent: input.userAgent ?? null,
	});
	return { token: deviceToken, device };
}

/** How often `lastSeenAt` is written; a request inside the window costs no write. */
const TOUCH_INTERVAL_MS = 60 * 1000;

/** The device behind a token, or null when there is none or it was revoked. */
export async function authenticateDevice(
	store: PairingStore,
	token: string,
	now: Date = new Date(),
): Promise<DeviceRecord | null> {
	if (!token) return null;
	const device = await store.findDeviceByHash(hashToken(token));
	if (!device || device.revokedAt) return null;
	if (
		!device.lastSeenAt ||
		now.getTime() - device.lastSeenAt.getTime() > TOUCH_INTERVAL_MS
	) {
		await store.touchDevice(device.id, now);
	}
	return device;
}

/**
 * The Prisma-backed store. `prisma` is typed loosely so this package keeps
 * `@prismalens/database` as a peer, the same way `createAuth` does.
 */
export function prismaPairingStore(prisma: unknown): PairingStore {
	const db = prisma as PrismaPairingClient;
	const toDevice = (row: DeviceRow): DeviceRecord => ({
		id: row.id,
		name: row.name,
		scopes: parseScopes(row.scopes),
		createdAt: row.createdAt,
		lastSeenAt: row.lastSeenAt,
		revokedAt: row.revokedAt,
	});
	return {
		createLink: (data) => db.pairingLink.create({ data }),
		findLinkByHash: (tokenHash) =>
			db.pairingLink.findUnique({ where: { tokenHash } }),
		redeemLink: async (input) =>
			db.$transaction(async (tx) => {
				const claimed = await tx.pairingLink.updateMany({
					where: { id: input.linkId, usedAt: null },
					data: { usedAt: new Date() },
				});
				if (claimed.count !== 1) {
					throw new PairingError(
						"used",
						"This pairing link was already used. Create a new one on the host.",
					);
				}
				return toDevice(
					await tx.deviceSession.create({
						data: {
							tokenHash: input.tokenHash,
							name: input.name,
							scopes: JSON.stringify(input.scopes),
							userAgent: input.userAgent,
							pairingLinkId: input.linkId,
						},
					}),
				);
			}),
		findDeviceByHash: async (tokenHash) => {
			const row = await db.deviceSession.findUnique({ where: { tokenHash } });
			return row ? toDevice(row) : null;
		},
		touchDevice: async (id, at) => {
			await db.deviceSession.update({
				where: { id },
				data: { lastSeenAt: at },
			});
		},
		listDevices: async () =>
			(
				await db.deviceSession.findMany({
					where: { revokedAt: null },
					orderBy: { createdAt: "asc" },
				})
			).map(toDevice),
		revokeDevice: async (id, at) => {
			const revoked = await db.deviceSession.updateMany({
				where: { id, revokedAt: null },
				data: { revokedAt: at },
			});
			if (revoked.count !== 1) return null;
			const row = await db.deviceSession.findUnique({ where: { id } });
			return row ? toDevice(row) : null;
		},
	};
}

function parseScopes(raw: string): string[] {
	try {
		const parsed: unknown = JSON.parse(raw);
		return Array.isArray(parsed)
			? parsed.filter((s): s is string => typeof s === "string")
			: [];
	} catch {
		return [];
	}
}

interface DeviceRow {
	id: string;
	name: string;
	scopes: string;
	createdAt: Date;
	lastSeenAt: Date | null;
	revokedAt: Date | null;
}

/** The slice of the Prisma client this module touches. */
interface PrismaPairingClient {
	pairingLink: {
		create(args: {
			data: { tokenHash: string; label: string | null; expiresAt: Date };
		}): Promise<PairingLinkRecord>;
		findUnique(args: {
			where: { tokenHash: string };
		}): Promise<PairingLinkRecord | null>;
	};
	deviceSession: {
		findUnique(args: {
			where: { tokenHash: string } | { id: string };
		}): Promise<DeviceRow | null>;
		findMany(args: {
			where: { revokedAt: null };
			orderBy: { createdAt: "asc" };
		}): Promise<DeviceRow[]>;
		update(args: {
			where: { id: string };
			data: { lastSeenAt: Date };
		}): Promise<DeviceRow>;
		updateMany(args: {
			where: { id: string; revokedAt: null };
			data: { revokedAt: Date };
		}): Promise<{ count: number }>;
	};
	$transaction<T>(
		fn: (tx: {
			pairingLink: {
				updateMany(args: {
					where: { id: string; usedAt: null };
					data: { usedAt: Date };
				}): Promise<{ count: number }>;
			};
			deviceSession: {
				create(args: {
					data: {
						tokenHash: string;
						name: string;
						scopes: string;
						userAgent: string | null;
						pairingLinkId: string;
					};
				}): Promise<DeviceRow>;
			};
		}) => Promise<T>,
	): Promise<T>;
}
