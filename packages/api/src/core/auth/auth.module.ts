// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Auth Module
 *
 * NestJS module for Better Auth integration.
 * Provides authentication services, guards, and decorators.
 */

import { Global, Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { AuthController } from "./auth.controller.js";
import { AuthGuard } from "./auth.guard.js";
import { AuthService } from "./auth.service.js";
import { OperatorController } from "./operator.controller.js";
import { OperatorResolver } from "./operator.resolver.js";
import {
	PairingController,
	PairingRedeemController,
} from "./pairing.controller.js";

@Global()
@Module({
	imports: [ConfigModule],
	controllers: [
		AuthController,
		OperatorController,
		PairingController,
		PairingRedeemController,
	],
	providers: [AuthService, OperatorResolver, AuthGuard],
	exports: [AuthService, OperatorResolver, AuthGuard],
})
export class AuthModule {}
