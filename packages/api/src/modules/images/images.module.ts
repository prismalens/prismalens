// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Module } from "@nestjs/common";
import { PrismaModule } from "../../core/prisma/prisma.module.js";
import { ImagesController } from "./images.controller.js";
import { ImagesService } from "./images.service.js";

/** The one image proxy (#1024 E); surface D's avatars use `ImagesService.urlFor` too. */
@Module({
	imports: [PrismaModule],
	controllers: [ImagesController],
	providers: [ImagesService],
	exports: [ImagesService],
})
export class ImagesModule {}
