/**
 * Auth Guard
 *
 * NestJS guard that validates Better Auth sessions.
 * Use with @UseGuards(AuthGuard) on controllers or routes.
 */

import {
	CanActivate,
	ExecutionContext,
	Injectable,
	UnauthorizedException,
} from "@nestjs/common";
import type { Request } from "express";
import { AuthService } from "./auth.service.js";

@Injectable()
export class AuthGuard implements CanActivate {
	constructor(private readonly authService: AuthService) {}

	async canActivate(context: ExecutionContext): Promise<boolean> {
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
			(request as any).user = session.user;
			(request as any).session = session.session;

			return true;
		} catch {
			throw new UnauthorizedException("Authentication required");
		}
	}
}
