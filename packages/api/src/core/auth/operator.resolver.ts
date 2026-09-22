// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Who is making this request, and why they count as the operator.
 *
 * One answer for the guard and for `operator.whoami`, so the frontend gate and
 * the API agree. Order: a Better Auth session first (a signed-in browser on
 * the host keeps its own session), then the loopback rule. On loopback with
 * no session the instance's one account, when it exists, is the acting user
 * so records that attribute to a user (integrations, timeline) keep working.
 */

import { Injectable } from "@nestjs/common";
import type { Session, User } from "@prismalens/auth";
import { resolvePlacement } from "@prismalens/config/harness";
import type { Request } from "express";
import { PrismaService } from "../prisma/prisma.service.js";
import { AuthService } from "./auth.service.js";
import { isLocalOperatorRequest } from "./local-operator.js";

export type OperatorVia = "session" | "loopback";

export interface Operator {
	via: OperatorVia;
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

		const local = isLocalOperatorRequest({
			remoteAddress: request.socket?.remoteAddress,
			headers: request.headers,
			placement: resolvePlacement(),
		});
		if (!local) return null;

		const owner = await this.prisma.user.findFirst();
		return {
			operator: { via: "loopback" },
			user: (owner as User | null) ?? undefined,
		};
	}
}
