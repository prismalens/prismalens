import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { OpenAPIController } from "./openapi.controller.js";

@Module({
	imports: [ConfigModule],
	controllers: [OpenAPIController],
})
export class OpenAPIModule {}
