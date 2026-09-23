// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Who is making this request, and why they count as the operator.
 *
 * One answer for the guard and for `operator.whoami`, so the frontend gate and
 * the API agree. Every caller presents a credential, the host included: no
 * address, `Host` header or bind grants anything (ADR 0004 §8). Order: a
 * Better Auth session, then a paired device's token. A device acts as the
 * instance's one account, when it exists, so records that attribute to a user
 * (integrations, timeline) keep working.
 */

import { Injectable } from "@nestjs/common";
import {
	authenticateDevice,
	type DeviceRecord,
	prismaPairingStore,
	type Session,
	type User,
} from "@prismalens/auth";
import type { Request } from "express";
import { PrismaService } from "../prisma/prisma.service.js";
import { AuthService } from "./auth.service.js";
import { readDeviceToken } from "./device-cookie.js";

export type OperatorVia = "session" | "device";

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
		if (!deviceToken) return null;
		const device = await authenticateDevice(
			prismaPairingStore(this.prisma),
			deviceToken,
		);
		if (!device) return null;
		return {
			operator: { via: "device", device },
			user: (await this.owner()) ?? undefined,
		};
	}

	private async owner(): Promise<User | null> {
		return (await this.prisma.user.findFirst()) as User | null;
	}
}
