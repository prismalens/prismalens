// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Controller } from "@nestjs/common";
import { Implement, implement } from "@orpc/nest";
import { settingsContract, usageContract } from "@prismalens/contracts";
import { PrismaService } from "../../core/prisma/prisma.service.js";
import { readShortcuts, writeShortcuts } from "./shortcuts.js";
import { UsageService } from "./usage.service.js";

/** The Usage view (#1101 cat 17), and the keyboard remaps Settings keeps (cat 18). */
@Controller()
export class UsageController {
	constructor(
		private readonly usage: UsageService,
		private readonly prisma: PrismaService,
	) {}

	@Implement(usageContract)
	routes() {
		return {
			summary: implement(usageContract.summary).handler(({ input }) =>
				this.usage.summary(input),
			),
			limits: implement(usageContract.limits).handler(() =>
				this.usage.limits(),
			),
			enforcement: implement(usageContract.enforcement).handler(() =>
				this.usage.enforcement(),
			),
		};
	}

	@Implement(settingsContract.shortcuts)
	shortcuts() {
		return {
			get: implement(settingsContract.shortcuts.get).handler(() =>
				readShortcuts(this.prisma),
			),
			update: implement(settingsContract.shortcuts.update).handler(
				({ input }) => writeShortcuts(this.prisma, input),
			),
		};
	}
}
