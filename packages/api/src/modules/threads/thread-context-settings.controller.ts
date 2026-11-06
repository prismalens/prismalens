// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Controller, UseGuards } from "@nestjs/common";
import { Implement, implement, ORPCError } from "@orpc/nest";
import { settingsContract } from "@prismalens/contracts";
import type { Request } from "express";
import { PrismaService } from "../../core/prisma/prisma.service.js";
import { isHost } from "../../core/settings/settings.controller.js";
import { MutationThrottleGuard } from "../../core/throttle/mutation-throttle.guard.js";
import { detectEditors } from "../run-workspaces/editors.js";
import {
	readThreadContextSettings,
	writeThreadContextSettings,
} from "./thread-context-settings.js";

/** Settings → "Show pull request status" and General → "Open files in" (#1024). */
@UseGuards(MutationThrottleGuard)
@Controller()
export class ThreadContextSettingsController {
	constructor(private readonly prisma: PrismaService) {}

	@Implement(settingsContract.editors)
	editors() {
		return {
			list: implement(settingsContract.editors.list).handler(() => ({
				editors: detectEditors(),
			})),
		};
	}

	@Implement(settingsContract.threadContext)
	threadContext() {
		return {
			get: implement(settingsContract.threadContext.get).handler(() =>
				readThreadContextSettings(this.prisma),
			),
			// The editor setting names what this computer launches, so only the host changes it.
			update: implement(settingsContract.threadContext.update).handler(
				async ({ input, context }) => {
					if (!isHost(context.request as Request))
						throw new ORPCError("FORBIDDEN", {
							message:
								"These settings can be changed only on the computer PrismaLens runs on.",
						});
					return writeThreadContextSettings(this.prisma, input);
				},
			),
		};
	}
}
