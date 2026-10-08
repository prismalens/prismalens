// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { hostname } from "node:os";
import { describe, expect, it, vi } from "vitest";
import {
	ACCESS_SCOPE,
	authenticateDevice,
	authenticateDeviceToken,
	buildPairingUrl,
	createPairingLink,
	DEVICE_SCOPES,
	type DeviceRecord,
	hashToken,
	OPERATOR_SCOPES,
	PAIRING_LINK_TTL_MS,
	PairingError,
	type PairingStore,
	prismaPairingStore,
	redeemPairingLink,
	STARTUP_LINK_LABEL,
	onDevicePaired,
} from "./pairing.js";

interface StoredLink {
	id: string;
	tokenHash: string;
	label: string | null;
	scopes: string;
	expiresAt: Date;
	usedAt: Date | null;
}

interface StoredDevice {
	id: string;
	tokenHash: string;
	name: string;
	userAgent: string | null;
	scopes: string[];
	createdAt: Date;
	lastSeenAt: Date | null;
	revokedAt: Date | null;
}

function createInMemoryPairingStore() {
	const links = new Map<string, StoredLink>();
	const devices = new Map<string, StoredDevice>();
	let linkId = 0;
	let deviceId = 0;

	const store: PairingStore = {
		createLink: async ({ tokenHash, label, scopes, expiresAt }) => {
			const id = `link-${++linkId}`;
			const link: StoredLink = {
				id,
				tokenHash,
				label,
				scopes,
				expiresAt,
				usedAt: null,
			};
			links.set(id, link);
			return {
				id: link.id,
				label: link.label,
				scopes: link.scopes,
				expiresAt: link.expiresAt,
				usedAt: link.usedAt,
			};
		},
		findLinkByHash: async (tokenHash: string) => {
			for (const link of links.values()) {
				if (link.tokenHash === tokenHash) {
					return {
						id: link.id,
						label: link.label,
						scopes: link.scopes,
						expiresAt: link.expiresAt,
						usedAt: link.usedAt,
					};
				}
			}
			return null;
		},
		redeemLink: async (input) => {
			const link = links.get(input.linkId);
			if (!link || link.usedAt !== null) {
				throw new PairingError(
					"used",
					"This pairing link was already used. Create a new one on the host.",
				);
			}
			link.usedAt = new Date();
			const device: StoredDevice = {
				id: `device-${++deviceId}`,
				tokenHash: input.tokenHash,
				name: input.name,
				userAgent: input.userAgent,
				scopes: [...input.scopes],
				createdAt: new Date(),
				lastSeenAt: null,
				revokedAt: null,
			};
			devices.set(device.id, device);
			return {
				id: device.id,
				name: device.name,
				scopes: [...device.scopes],
				userAgent: device.userAgent,
				createdAt: device.createdAt,
				lastSeenAt: device.lastSeenAt,
				revokedAt: device.revokedAt,
			};
		},
		findDeviceByHash: async (tokenHash: string) => {
			for (const device of devices.values()) {
				if (device.tokenHash === tokenHash) {
					return {
						id: device.id,
						name: device.name,
						scopes: [...device.scopes],
				userAgent: device.userAgent,
						createdAt: device.createdAt,
						lastSeenAt: device.lastSeenAt,
						revokedAt: device.revokedAt,
					};
				}
			}
			return null;
		},
		touchDevice: async (id: string, at: Date) => {
			const device = devices.get(id);
			if (device) {
				device.lastSeenAt = at;
			}
		},
		listDevices: async () => {
			return Array.from(devices.values())
				.filter((d) => d.revokedAt === null)
				.map((d) => ({
					id: d.id,
					name: d.name,
					scopes: [...d.scopes],
					userAgent: d.userAgent,
					createdAt: d.createdAt,
					lastSeenAt: d.lastSeenAt,
					revokedAt: d.revokedAt,
				}));
		},
		renameDevice: async (id: string, name: string) => {
			const device = devices.get(id);
			if (!device || device.revokedAt !== null) return null;
			device.name = name;
			return { ...device, scopes: [...device.scopes] };
		},
		revokeDevice: async (id: string, at: Date) => {
			const device = devices.get(id);
			if (!device || device.revokedAt !== null) return null;
			device.revokedAt = at;
			return {
				id: device.id,
				name: device.name,
				scopes: [...device.scopes],
				userAgent: device.userAgent,
				createdAt: device.createdAt,
				lastSeenAt: device.lastSeenAt,
				revokedAt: device.revokedAt,
			};
		},
	};

	return { store, links, devices };
}

describe("createPairingLink", () => {
	it("returns a token whose hashToken matches the stored hash", async () => {
		const { store } = createInMemoryPairingStore();
		const created = await createPairingLink(store);

		const stored = await store.findLinkByHash(hashToken(created.token));
		expect(stored).not.toBeNull();
		expect(stored?.id).toBe(created.id);
	});

	it("the store never holds the raw token", async () => {
		const { store, links } = createInMemoryPairingStore();
		const created = await createPairingLink(store);

		expect(links.size).toBe(1);
		for (const link of links.values()) {
			expect(link.tokenHash).not.toBe(created.token);
			expect(JSON.stringify(link)).not.toContain(created.token);
		}
	});

	it("label is trimmed and empty becomes null", async () => {
		const { store } = createInMemoryPairingStore();

		const trimmed = await createPairingLink(store, { label: "  iPad Pro  " });
		const storedTrimmed = await store.findLinkByHash(hashToken(trimmed.token));
		expect(storedTrimmed?.label).toBe("iPad Pro");

		const spaces = await createPairingLink(store, { label: "   " });
		const storedSpaces = await store.findLinkByHash(hashToken(spaces.token));
		expect(storedSpaces?.label).toBeNull();

		const empty = await createPairingLink(store, { label: "" });
		const storedEmpty = await store.findLinkByHash(hashToken(empty.token));
		expect(storedEmpty?.label).toBeNull();

		const none = await createPairingLink(store);
		const storedNone = await store.findLinkByHash(hashToken(none.token));
		expect(storedNone?.label).toBeNull();
	});

	it("expiresAt is now + PAIRING_LINK_TTL_MS by default and now + ttlMs when given", async () => {
		const { store } = createInMemoryPairingStore();
		const now = new Date("2026-09-22T12:00:00.000Z");

		const def = await createPairingLink(store, { now });
		expect(def.expiresAt.getTime()).toBe(now.getTime() + PAIRING_LINK_TTL_MS);

		const custom = await createPairingLink(store, { now, ttlMs: 30_000 });
		expect(custom.expiresAt.getTime()).toBe(now.getTime() + 30_000);
	});
});

describe("buildPairingUrl", () => {
	it('buildPairingUrl("http://192.168.1.5:3001", "abc") === "http://192.168.1.5:3001/pair#abc"', () => {
		expect(buildPairingUrl("http://192.168.1.5:3001", "abc")).toBe(
			"http://192.168.1.5:3001/pair#abc",
		);
	});

	it("a trailing path and query on the origin are dropped", () => {
		expect(
			buildPairingUrl("http://192.168.1.5:3001/some/path?foo=bar#old", "abc"),
		).toBe("http://192.168.1.5:3001/pair#abc");
	});

	it("https is kept", () => {
		expect(buildPairingUrl("https://prismalens.example.com", "abc")).toBe(
			"https://prismalens.example.com/pair#abc",
		);
	});
});

describe("redeemPairingLink", () => {
	it("unknown token → PairingError reason invalid", async () => {
		const { store } = createInMemoryPairingStore();
		await expect(
			redeemPairingLink(store, { token: "unknown-token", name: "Dev" }),
		).rejects.toMatchObject({
			name: "PairingError",
			reason: "invalid",
		});
	});

	it("expired (now past expiresAt) → expired", async () => {
		const { store } = createInMemoryPairingStore();
		const now = new Date("2026-09-22T12:00:00.000Z");
		const link = await createPairingLink(store, { now, ttlMs: 5_000 });
		const later = new Date(now.getTime() + 6_000);

		await expect(
			redeemPairingLink(store, { token: link.token, name: "Dev", now: later }),
		).rejects.toMatchObject({
			name: "PairingError",
			reason: "expired",
		});
	});

	it("second redemption of the same link → used", async () => {
		const { store } = createInMemoryPairingStore();
		const link = await createPairingLink(store);

		await redeemPairingLink(store, { token: link.token, name: "Dev" });
		await expect(
			redeemPairingLink(store, { token: link.token, name: "Dev 2" }),
		).rejects.toMatchObject({
			name: "PairingError",
			reason: "used",
		});
	});

	it("success returns a device token distinct from the link token, device.scopes equal DEVICE_SCOPES; the name is the label, else the client's name, else Paired device", async () => {
		const { store } = createInMemoryPairingStore();

		// Both the operator's label and the name the device guesses
		const link1 = await createPairingLink(store, { label: "Desk Mac" });
		const redeemed1 = await redeemPairingLink(store, {
			token: link1.token,
			name: "Linux machine",
		});
		expect(redeemed1.token).not.toBe(link1.token);
		expect(redeemed1.device.scopes).toEqual([...DEVICE_SCOPES]);
		expect(redeemed1.device.name).toBe("Desk Mac");

		const labelOnly = await createPairingLink(store, { label: "Desk Mac" });
		const redeemedLabelOnly = await redeemPairingLink(store, {
			token: labelOnly.token,
			name: "  ",
		});
		expect(redeemedLabelOnly.device.name).toBe("Desk Mac");

		// With no label, the device's own name
		const link2 = await createPairingLink(store);
		const redeemed2 = await redeemPairingLink(store, {
			token: link2.token,
			name: "Android phone",
		});
		expect(redeemed2.device.name).toBe("Android phone");

		// Name falls back to "Paired device" when both name and label are empty
		const link3 = await createPairingLink(store);
		const redeemed3 = await redeemPairingLink(store, {
			token: link3.token,
			name: "",
		});
		expect(redeemed3.device.name).toBe("Paired device");
	});

	it("a link minted with OPERATOR_SCOPES pairs a device that holds them; the default link never carries admin:access", async () => {
		const { store } = createInMemoryPairingStore();

		const startup = await createPairingLink(store, {
			label: STARTUP_LINK_LABEL,
			scopes: OPERATOR_SCOPES,
		});
		const host = await redeemPairingLink(store, {
			token: startup.token,
			name: "",
		});
		expect(host.device.scopes).toEqual([...OPERATOR_SCOPES]);
		expect(host.device.name).toBe(STARTUP_LINK_LABEL);
		// Named after the machine, the way Tailscale names a device (walk u2).
		expect(host.device.name).toBe(hostname() || "This machine");

		const plain = await createPairingLink(store);
		const other = await redeemPairingLink(store, {
			token: plain.token,
			name: "Phone",
		});
		expect(other.device.scopes).not.toContain(ACCESS_SCOPE);
	});

	it("two concurrent redeemPairingLink calls on one link: exactly one resolves, the other rejects with reason used", async () => {
		const { store } = createInMemoryPairingStore();
		const link = await createPairingLink(store);

		const results = await Promise.allSettled([
			redeemPairingLink(store, { token: link.token, name: "dev-a" }),
			redeemPairingLink(store, { token: link.token, name: "dev-b" }),
		]);

		const fulfilled = results.filter((r) => r.status === "fulfilled");
		const rejected = results.filter((r) => r.status === "rejected");

		expect(fulfilled).toHaveLength(1);
		expect(rejected).toHaveLength(1);

		const failure = rejected[0] as PromiseRejectedResult;
		expect(failure.reason).toBeInstanceOf(PairingError);
		expect((failure.reason as PairingError).reason).toBe("used");
	});
});

describe("renameDevice", () => {
	it("renames a paired device and leaves a revoked one alone", async () => {
		const { store } = createInMemoryPairingStore();
		const link = await createPairingLink(store);
		const { device } = await redeemPairingLink(store, {
			token: link.token,
			name: "Pixel 9",
			userAgent: "Mozilla/5.0 (Linux; Android 15; Pixel 9)",
		});
		expect(device.userAgent).toContain("Pixel 9");
		expect((await store.renameDevice(device.id, "Sumit's phone"))?.name).toBe(
			"Sumit's phone",
		);
		await store.revokeDevice(device.id, new Date());
		expect(await store.renameDevice(device.id, "Gone")).toBeNull();
	});

	it("the Prisma store trims the name and refuses a blank one", async () => {
		const row = {
			id: "d1",
			name: "Pixel 9",
			scopes: "[]",
			userAgent: null,
			createdAt: new Date(),
			lastSeenAt: null,
			revokedAt: null,
		};
		const updateMany = vi.fn(async (args: { data: { name: string } }) => {
			row.name = args.data.name;
			return { count: 1 };
		});
		const store = prismaPairingStore({
			deviceSession: { updateMany, findUnique: async () => row },
		});
		expect((await store.renameDevice("d1", "  Sumit's phone  "))?.name).toBe(
			"Sumit's phone",
		);
		expect(await store.renameDevice("d1", "   ")).toBeNull();
		expect(updateMany).toHaveBeenCalledTimes(1);
	});
});

describe("authenticateDevice", () => {
	it("the device token authenticates; a revoked device (revokedAt set) returns null; an unknown token returns null; empty string returns null", async () => {
		const { store } = createInMemoryPairingStore();
		const link = await createPairingLink(store);
		const redeemed = await redeemPairingLink(store, {
			token: link.token,
			name: "Dev",
		});

		// The device token authenticates
		const authenticated = await authenticateDevice(store, redeemed.token);
		expect(authenticated).not.toBeNull();
		expect(authenticated?.id).toBe(redeemed.device.id);

		// An unknown token returns null
		expect(await authenticateDevice(store, "unknown-token")).toBeNull();

		// Empty string returns null
		expect(await authenticateDevice(store, "")).toBeNull();

		// A revoked device (revokedAt set) returns null
		await store.revokeDevice(redeemed.device.id, new Date());
		expect(await authenticateDevice(store, redeemed.token)).toBeNull();
	});

	it("authenticateDeviceToken returns reason revoked when device was revoked", async () => {
		const { store } = createInMemoryPairingStore();
		const link = await createPairingLink(store);
		const redeemed = await redeemPairingLink(store, {
			token: link.token,
			name: "Dev",
		});

		const active = await authenticateDeviceToken(store, redeemed.token);
		expect(active.device).not.toBeNull();
		expect(active.device?.id).toBe(redeemed.device.id);

		await store.revokeDevice(redeemed.device.id, new Date());
		const revoked = await authenticateDeviceToken(store, redeemed.token);
		expect(revoked).toEqual({ device: null, reason: "revoked" });

		const unknown = await authenticateDeviceToken(store, "unknown-token");
		expect(unknown).toEqual({ device: null });
	});

	it("lastSeenAt is written on first use and NOT rewritten when the last touch is under a minute old (pass now)", async () => {
		const { store } = createInMemoryPairingStore();
		const link = await createPairingLink(store);
		const redeemed = await redeemPairingLink(store, {
			token: link.token,
			name: "Dev",
		});
		const t0 = new Date("2026-09-22T12:00:00.000Z");

		const touchSpy = vi.spyOn(store, "touchDevice");

		// Written on first use
		await authenticateDevice(store, redeemed.token, t0);
		expect(touchSpy).toHaveBeenCalledTimes(1);
		expect(touchSpy).toHaveBeenCalledWith(redeemed.device.id, t0);

		const storedAfterFirst = await store.findDeviceByHash(
			hashToken(redeemed.token),
		);
		expect(storedAfterFirst?.lastSeenAt).toEqual(t0);

		// NOT rewritten when under a minute old (30 seconds later)
		touchSpy.mockClear();
		const t1 = new Date(t0.getTime() + 30_000);
		await authenticateDevice(store, redeemed.token, t1);
		expect(touchSpy).not.toHaveBeenCalled();

		// Rewritten when over a minute old (61 seconds later)
		touchSpy.mockClear();
		const t2 = new Date(t0.getTime() + 61_000);
		await authenticateDevice(store, redeemed.token, t2);
		expect(touchSpy).toHaveBeenCalledTimes(1);
		expect(touchSpy).toHaveBeenCalledWith(redeemed.device.id, t2);
	});
});

describe("onDevicePaired", () => {
	it("listener receives { linkId, device } with the link's id after redeemPairingLink succeeds", async () => {
		const { store } = createInMemoryPairingStore();
		const link = await createPairingLink(store);
		const calls: Array<{ linkId: string; device: DeviceRecord }> = [];
		const unsubscribe = onDevicePaired((event) => {
			calls.push(event);
		});

		try {
			const redeemed = await redeemPairingLink(store, {
				token: link.token,
				name: "Laptop",
			});

			expect(calls).toHaveLength(1);
			expect(calls[0]).toEqual({
				linkId: link.id,
				device: redeemed.device,
			});
		} finally {
			unsubscribe();
		}
	});

	it("is not called when redemption fails (used link)", async () => {
		const { store } = createInMemoryPairingStore();
		const link = await createPairingLink(store);
		await redeemPairingLink(store, {
			token: link.token,
			name: "Laptop",
		});

		const calls: Array<{ linkId: string; device: DeviceRecord }> = [];
		const unsubscribe = onDevicePaired((event) => {
			calls.push(event);
		});

		try {
			await expect(
				redeemPairingLink(store, {
					token: link.token,
					name: "Laptop Again",
				}),
			).rejects.toThrow(PairingError);

			expect(calls).toHaveLength(0);
		} finally {
			unsubscribe();
		}
	});

	it("the returned unsubscribe stops further calls", async () => {
		const { store } = createInMemoryPairingStore();
		const link1 = await createPairingLink(store);
		const link2 = await createPairingLink(store);
		const calls: Array<{ linkId: string; device: DeviceRecord }> = [];
		const unsubscribe = onDevicePaired((event) => {
			calls.push(event);
		});

		await redeemPairingLink(store, {
			token: link1.token,
			name: "Laptop 1",
		});
		expect(calls).toHaveLength(1);

		unsubscribe();

		await redeemPairingLink(store, {
			token: link2.token,
			name: "Laptop 2",
		});
		expect(calls).toHaveLength(1);
	});

	it("a listener that throws does not fail redeemPairingLink", async () => {
		const { store } = createInMemoryPairingStore();
		const link = await createPairingLink(store);
		const unsubscribe = onDevicePaired(() => {
			throw new Error("listener error");
		});

		try {
			const redeemed = await redeemPairingLink(store, {
				token: link.token,
				name: "Laptop",
			});
			expect(redeemed.device.name).toBe("Laptop");
		} finally {
			unsubscribe();
		}
	});
});

