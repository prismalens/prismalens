// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Auth Guard
 *
 * Global NestJS guard. A request is the operator when it carries a paired
 * device's token (ADR 0004 §8). Respects the @Public() decorator to skip
 * authentication.
 */

import {
	CanActivate,
	ExecutionContext,
	ForbiddenException,
	Injectable,
	UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { READ_SCOPE } from "@prismalens/auth";
import type { Request } from "express";
import { OperatorResolver } from "./operator.resolver.js";
import { IS_PUBLIC_KEY } from "./public.decorator.js";

@Injectable()
export class AuthGuard implements CanActivate {
	constructor(
		private readonly operator: OperatorResolver,
		private readonly reflector: Reflector,
	) {}

	async canActivate(context: ExecutionContext): Promise<boolean> {
		const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
			context.getHandler(),
			context.getClass(),
		]);
		if (isPublic) return true;

		const request = context.switchToHttp().getRequest<Request>();

		try {
			const resolution = await this.operator.resolveWithReason(request);
			if (!resolution.operator) {
				if (resolution.reason === "revoked") {
					throw new UnauthorizedException({
						message: "Authentication required",
						reason: "revoked",
					});
				}
				throw new UnauthorizedException("Authentication required");
			}
			if (!resolution.operator.device.scopes.includes(READ_SCOPE))
				throw new ForbiddenException("This device can't view runs.");
			request.operator = resolution.operator;
			return true;
		} catch (error) {
			// Re-throw UnauthorizedException as-is; wrap other errors
			// so infrastructure failures (DB outage, etc.) don't silently become 401
			if (
				error instanceof UnauthorizedException ||
				error instanceof ForbiddenException
			) {
				throw error;
			}
			throw new UnauthorizedException("Authentication required");
		}
	}
}
