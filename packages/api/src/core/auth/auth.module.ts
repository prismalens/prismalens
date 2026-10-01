// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Global, Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { AuthGuard } from "./auth.guard.js";
import { InstanceController } from "./instance.controller.js";
import { InstanceIdentity } from "./instance-identity.js";
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
		InstanceController,
		OperatorController,
		PairingController,
		PairingRedeemController,
	],
	providers: [InstanceIdentity, OperatorResolver, AuthGuard],
	exports: [InstanceIdentity, OperatorResolver, AuthGuard],
})
export class AuthModule {}
