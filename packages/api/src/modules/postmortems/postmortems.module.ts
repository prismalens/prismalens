// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Module } from "@nestjs/common";
import { PostmortemsController } from "./postmortems.controller.js";
import { PostmortemsService } from "./postmortems.service.js";

@Module({
	controllers: [PostmortemsController],
	providers: [PostmortemsService],
	exports: [PostmortemsService],
})
export class PostmortemsModule {}
