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
	Injectable,
	UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
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
			const operator = await this.operator.resolve(request);
			if (!operator) {
				throw new UnauthorizedException("Authentication required");
			}
			request.operator = operator;
			return true;
		} catch (error) {
			// Re-throw UnauthorizedException as-is; wrap other errors
			// so infrastructure failures (DB outage, etc.) don't silently become 401
			if (error instanceof UnauthorizedException) {
				throw error;
			}
			throw new UnauthorizedException("Authentication required");
		}
	}
}
