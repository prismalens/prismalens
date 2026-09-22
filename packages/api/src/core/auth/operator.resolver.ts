// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Who is making this request, and why they count as the operator.
 *
 * One answer for the guard and for `operator.whoami`, so the frontend gate and
 * the API agree. Order: a Better Auth session (a signed-in browser keeps its
 * own session), then a paired device's token, then the loopback rule. On
 * loopback with no session the instance's one account, when it exists, is the
 * acting user so records that attribute to a user (integrations, timeline)
 * keep working.
 */

import { Injectable } from "@nestjs/common";
import {
	authenticateDevice,
	type DeviceRecord,
	prismaPairingStore,
	type Session,
	type User,
} from "@prismalens/auth";
import { resolvePlacement } from "@prismalens/config/harness";
import type { Request } from "express";
import { PrismaService } from "../prisma/prisma.service.js";
import { AuthService } from "./auth.service.js";
import { readDeviceToken } from "./device-cookie.js";
import { isLocalOperatorRequest } from "./local-operator.js";

export type OperatorVia = "session" | "loopback" | "device";

export interface Operator {
	via: OperatorVia;
	/** Present when `via` is `device`. */
	device?: DeviceRecord;
}

export interface ResolvedOperator {
	operator: Operator;
	user?: User;
	session?: Session;
}

@Injectable()
export class OperatorResolver {
	constructor(
		private readonly authService: AuthService,
		private readonly prisma: PrismaService,
	) {}

	async resolve(request: Request): Promise<ResolvedOperator | null> {
		const session = await this.authService.auth.api.getSession({
			headers: request.headers as Record<string, string>,
		});
		if (session?.user) {
			return {
				operator: { via: "session" },
				user: session.user as User,
				session: session.session as Session,
			};
		}

		const deviceToken = readDeviceToken(request);
		if (deviceToken) {
			const device = await authenticateDevice(
				prismaPairingStore(this.prisma),
				deviceToken,
			);
			if (device) {
				return {
					operator: { via: "device", device },
					user: (await this.owner()) ?? undefined,
				};
			}
		}

		const local = isLocalOperatorRequest({
			remoteAddress: request.socket?.remoteAddress,
			headers: request.headers,
			placement: resolvePlacement(),
		});
		if (!local) return null;

		return {
			operator: { via: "loopback" },
			user: (await this.owner()) ?? undefined,
		};
	}

	private async owner(): Promise<User | null> {
		return (await this.prisma.user.findFirst()) as User | null;
	}
}
