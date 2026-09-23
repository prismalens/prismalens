// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Who is making this request, and why they count as the operator.
 *
 * One answer for the guard and for `operator.whoami`, so the frontend gate and
 * the API agree. Every caller presents a credential, the host included: no
 * address, `Host` header or bind grants anything (ADR 0004 §8).
 */

import { Injectable } from "@nestjs/common";
import type { Session, User } from "@prismalens/auth";
import type { Request } from "express";
import { AuthService } from "./auth.service.js";

export type OperatorVia = "session";

export interface Operator {
	via: OperatorVia;
}

export interface ResolvedOperator {
	operator: Operator;
	user: User;
	session: Session;
}

@Injectable()
export class OperatorResolver {
	constructor(private readonly authService: AuthService) {}

	async resolve(request: Request): Promise<ResolvedOperator | null> {
		const session = await this.authService.auth.api.getSession({
			headers: request.headers as Record<string, string>,
		});
		if (!session?.user) return null;
		return {
			operator: { via: "session" },
			user: session.user as User,
			session: session.session as Session,
		};
	}
}
