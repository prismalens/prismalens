/**
 * Auth Module
 *
 * NestJS module for Better Auth integration.
 * Provides authentication services, guards, and decorators.
 */

import { Global, Module } from "@nestjs/common";
import { AuthController } from "./auth.controller.js";
import { AuthGuard } from "./auth.guard.js";
import { AuthService } from "./auth.service.js";
import { ConfigModule } from "@nestjs/config";

@Global()
@Module({
	imports: [ConfigModule],
	controllers: [AuthController],
	providers: [AuthService, AuthGuard],
	exports: [AuthService, AuthGuard],
})
export class AuthModule {}
