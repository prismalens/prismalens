import { Module } from "@nestjs/common";
import { PrismaModule } from "../../core/prisma/prisma.module.js";
import { IntegrationsModule } from "../integrations/integrations.module.js";
import { ServiceDiscoveryController } from "./service-discovery.controller.js";
import { ServiceDiscoveryService } from "./service-discovery.service.js";

@Module({
	imports: [PrismaModule, IntegrationsModule],
	providers: [ServiceDiscoveryService],
	controllers: [ServiceDiscoveryController],
	exports: [ServiceDiscoveryService],
})
export class ServiceDiscoveryModule {}
