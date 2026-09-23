// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Device pairing (ADR 0004 §8).
 *
 * `redeem` is public: a device arrives with nothing but the link. Everything
 * else is the operator's, and a paired device is refused: a device can never
 * mint another device or revoke one (the non-escalation rule).
 */

import { Controller, UseGuards } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Implement, implement, ORPCError } from "@orpc/nest";
import {
	buildPairingUrl,
	createPairingLink,
	PairingError,
	prismaPairingStore,
	redeemPairingLink,
} from "@prismalens/auth";
import { pairingContract } from "@prismalens/contracts";
import type { Request } from "express";
import { PrismaService } from "../prisma/prisma.service.js";
import { MutationThrottleGuard } from "../throttle/mutation-throttle.guard.js";
import { deviceCookieHeader } from "./device-cookie.js";
import { Public } from "./public.decorator.js";

@Controller()
export class PairingController {
	constructor(private readonly prisma: PrismaService) {}

	private get store() {
		return prismaPairingStore(this.prisma);
	}

	@Implement(pairingContract.manage)
	manage() {
		return {
			createLink: implement(pairingContract.manage.createLink).handler(
				async ({ input, context }) => {
					const request = context.request as Request;
					operatorOnly(request);
					const origin = input.origin ?? requestOrigin(request);
					const link = await createPairingLink(this.store, {
						label: input.label,
					});
					return {
						url: buildPairingUrl(origin, link.token),
						expiresAt: link.expiresAt.toISOString(),
					};
				},
			),

			listDevices: implement(pairingContract.manage.listDevices).handler(
				async ({ context }) => {
					const request = context.request as Request;
					operatorOnly(request);
					const devices = await this.store.listDevices();
					return {
						devices: devices.map((d) => ({
							id: d.id,
							name: d.name,
							createdAt: d.createdAt.toISOString(),
							lastSeenAt: d.lastSeenAt?.toISOString() ?? null,
						})),
					};
				},
			),

			revokeDevice: implement(pairingContract.manage.revokeDevice).handler(
				async ({ input, context }) => {
					operatorOnly(context.request as Request);
					const revoked = await this.store.revokeDevice(input.id, new Date());
					if (!revoked) {
						throw new ORPCError("NOT_FOUND", {
							message: "No such device, or it is already revoked.",
						});
					}
					return { revoked: true };
				},
			),
		};
	}
}

/**
 * The public half, on its own controller so `@Public()` cannot leak onto the
 * operator routes above (class-level is the only level that reaches the
 * handlers `@Implement` generates).
 */
@Public()
@UseGuards(MutationThrottleGuard)
@Controller()
export class PairingRedeemController {
	constructor(
		private readonly prisma: PrismaService,
		private readonly config: ConfigService,
	) {}

	/** `Secure` follows the resolved origin's scheme, never NODE_ENV. */
	private get secureCookies(): boolean {
		const publicUrl = this.config.get<string>("PRISMALENS_PUBLIC_URL");
		if (publicUrl) return publicUrl.startsWith("https://");
		return this.config.get<string>("PRISMALENS_PROTOCOL") === "https";
	}

	@Implement(pairingContract.redeem)
	redeem() {
		return implement(pairingContract.redeem).handler(
			async ({ input, context }) => {
				const request = context.request as Request;
				try {
					const redeemed = await redeemPairingLink(
						prismaPairingStore(this.prisma),
						{
							token: input.token,
							name: input.name ?? "",
							userAgent: request.headers["user-agent"],
						},
					);
					request.res?.append(
						"Set-Cookie",
						deviceCookieHeader(redeemed.token, this.secureCookies),
					);
					return {
						device: { id: redeemed.device.id, name: redeemed.device.name },
					};
				} catch (error) {
					if (error instanceof PairingError) {
						throw new ORPCError("BAD_REQUEST", {
							message: error.message,
							data: { reason: error.reason },
						});
					}
					throw error;
				}
			},
		);
	}
}

/** A paired device may use the instance; it may not manage who else can. */
function operatorOnly(request: Request): void {
	if (request.operator?.via === "device") {
		throw new ORPCError("FORBIDDEN", {
			message: "Pairing is managed from the host, not from a paired device.",
		});
	}
}

function requestOrigin(request: Request): string {
	const host = request.headers.host ?? "localhost";
	return `${request.protocol}://${host}`;
}
