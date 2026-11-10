// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Controller, UseGuards } from "@nestjs/common";
import { Implement, implement, ORPCError } from "@orpc/nest";
import { settingsContract } from "@prismalens/contracts";
import type { Request } from "express";
import { requireOwner } from "../../core/auth/owner.js";
import { PrismaService } from "../../core/prisma/prisma.service.js";
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
			// The editor setting names what the host launches, so only the owner changes it.
			update: implement(settingsContract.threadContext.update).handler(
				async ({ input, context }) => {
					requireOwner(
						context.request,
						"Only the owner can change these settings.",
					);
					return writeThreadContextSettings(this.prisma, input);
				},
			),
		};
	}
}
