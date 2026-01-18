import { Module } from "@nestjs/common";
import { PostmortemsController } from "./postmortems.controller.js";
import { PostmortemsService } from "./postmortems.service.js";

@Module({
	controllers: [PostmortemsController],
	providers: [PostmortemsService],
	exports: [PostmortemsService],
})
export class PostmortemsModule {}
