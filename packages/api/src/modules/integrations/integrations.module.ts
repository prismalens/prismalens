// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { BullModule } from "@nestjs/bullmq";
import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { PrismaModule } from "../../core/prisma/prisma.module.js";
import { CredentialsService } from "./crypto/credentials.service.js";
import { IntegrationsController } from "./integrations.controller.js";
import { IntegrationsService } from "./integrations.service.js";
import { OAuthController } from "./oauth/oauth.controller.js";
import { OAuthService } from "./oauth/oauth.service.js";
import {
	TOKEN_REFRESH_QUEUE,
	TokenRefreshProcessor,
} from "./token-refresh.processor.js";

@Module({
	imports: [
		PrismaModule,
		ConfigModule,
		BullModule.registerQueue({ name: TOKEN_REFRESH_QUEUE }),
	],
	controllers: [IntegrationsController, OAuthController],
	providers: [
		IntegrationsService,
		CredentialsService,
		OAuthService,
		TokenRefreshProcessor,
	],
	exports: [IntegrationsService, CredentialsService, OAuthService],
})
export class IntegrationsModule {}
