import { Module } from "@nestjs/common";
import { PrismaModule } from "../../core/prisma/prisma.module.js";
import { ChangeEventsService } from "./change-events.service.js";

@Module({
	imports: [PrismaModule],
	providers: [ChangeEventsService],
	exports: [ChangeEventsService],
})
export class ChangeEventsModule {}
