/**
 * Auth Guard
 *
 * Global NestJS guard that validates Better Auth sessions.
 * Respects the @Public() decorator to skip authentication.
 */

import {
	CanActivate,
	ExecutionContext,
	Injectable,
	UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import { AuthService } from "./auth.service.js";
import { IS_PUBLIC_KEY } from "./public.decorator.js";

@Injectable()
export class AuthGuard implements CanActivate {
	constructor(
		private readonly authService: AuthService,
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
			// Get session from Better Auth
			const session = await this.authService.auth.api.getSession({
				headers: request.headers as Record<string, string>,
			});

			if (!session?.user) {
				throw new UnauthorizedException("Invalid session");
			}

			// Attach user and session to request for use in handlers
			// Coerce null role to undefined to match UserWithRole type
			// (Better Auth's Prisma adapter returns null for nullable columns)
			request.user = {
				...session.user,
				role: session.user.role ?? undefined,
			} as typeof request.user;
			request.session = session.session;

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
