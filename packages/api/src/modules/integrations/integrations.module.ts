import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { PrismaModule } from "../../core/prisma/prisma.module.js";
import { CredentialsService } from "./crypto/credentials.service.js";
import { IntegrationsController } from "./integrations.controller.js";
import { IntegrationsService } from "./integrations.service.js";
import { OAuthController } from "./oauth/oauth.controller.js";
import { OAuthService } from "./oauth/oauth.service.js";

@Module({
	imports: [PrismaModule, ConfigModule],
	controllers: [IntegrationsController, OAuthController],
	providers: [IntegrationsService, CredentialsService, OAuthService],
	exports: [IntegrationsService, CredentialsService, OAuthService],
})
export class IntegrationsModule {}
