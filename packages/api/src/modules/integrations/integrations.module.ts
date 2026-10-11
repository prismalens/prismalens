// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { PrismaModule } from "../../core/prisma/prisma.module.js";
import { ConnectorResolverService } from "./connector-resolver.service.js";
import { CredentialsService } from "./crypto/credentials.service.js";
import { GitCredentialService } from "./git-credential.service.js";
import { IntegrationsController } from "./integrations.controller.js";
import { IntegrationsService } from "./integrations.service.js";
import { TokenRefreshProcessor } from "./token-refresh.processor.js";

@Module({
	imports: [PrismaModule, ConfigModule],
	controllers: [IntegrationsController],
	providers: [
		IntegrationsService,
		CredentialsService,
		TokenRefreshProcessor,
		ConnectorResolverService,
		GitCredentialService,
	],
	exports: [
		IntegrationsService,
		CredentialsService,
		ConnectorResolverService,
		GitCredentialService,
	],
})
export class IntegrationsModule {}
