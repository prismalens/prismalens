// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Controller } from "@nestjs/common";
import { Implement, implement } from "@orpc/nest";
import { settingsContract, usageContract } from "@prismalens/contracts";
import { PrismaService } from "../../core/prisma/prisma.service.js";
import {
	readPersonSettings,
	readShortcuts,
	writePersonSettings,
	writeShortcuts,
} from "./shortcuts.js";
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
			readLimits: implement(usageContract.readLimits).handler(({ input }) =>
				this.usage.readLimits(input.agent),
			),
			prices: implement(usageContract.prices).handler(() =>
				this.usage.prices(),
			),
			setPrices: implement(usageContract.setPrices).handler(({ input }) =>
				this.usage.setPrices(input),
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

	@Implement(settingsContract.person)
	person() {
		return {
			get: implement(settingsContract.person.get).handler(() =>
				readPersonSettings(this.prisma),
			),
			update: implement(settingsContract.person.update).handler(({ input }) =>
				writePersonSettings(this.prisma, input),
			),
		};
	}
}
