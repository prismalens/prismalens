/**
 * Auth Controller
 *
 * Handles all Better Auth routes at /api/auth/*
 * This controller acts as a bridge between NestJS and Better Auth's handler.
 */

import { All, Controller, Req, Res } from "@nestjs/common";
import { toNodeHandler } from "better-auth/node";
import type { Request, Response } from "express";
import { AuthService } from "./auth.service.js";
import { Public } from "./public.decorator.js";

@Public()
@Controller("auth")
export class AuthController {
	constructor(private readonly authService: AuthService) {}

	/**
	 * Handle all auth routes (GET, POST, etc.)
	 * Better Auth expects routes like:
	 * - POST /api/auth/sign-in/email
	 * - POST /api/auth/sign-up/email
	 * - POST /api/auth/sign-out
	 * - GET /api/auth/session
	 * - etc.
	 */
	@All("*path")
	async handleAuth(@Req() req: Request, @Res() res: Response) {
		const handler = toNodeHandler(this.authService.auth);
		return handler(req, res);
	}
}
