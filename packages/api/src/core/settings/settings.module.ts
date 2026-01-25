import { Module, forwardRef } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module.js";
import { IntegrationsModule } from "../../modules/integrations/integrations.module.js";
import { SettingsController } from "./settings.controller.js";
import { SettingsService } from "./settings.service.js";

@Module({
	imports: [PrismaModule, forwardRef(() => IntegrationsModule)],
	controllers: [SettingsController],
	providers: [SettingsService],
	exports: [SettingsService],
})
export class SettingsModule {}
