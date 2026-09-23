// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Global, Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { AuthGuard } from "./auth.guard.js";
import { OperatorController } from "./operator.controller.js";
import { OperatorResolver } from "./operator.resolver.js";
import {
	PairingController,
	PairingRedeemController,
} from "./pairing.controller.js";

@Global()
@Module({
	imports: [ConfigModule],
	controllers: [OperatorController, PairingController, PairingRedeemController],
	providers: [OperatorResolver, AuthGuard],
	exports: [OperatorResolver, AuthGuard],
})
export class AuthModule {}
