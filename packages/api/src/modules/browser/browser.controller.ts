// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Controller, UseGuards } from "@nestjs/common";
import { Implement, implement, ORPCError } from "@orpc/nest";
import { ACCESS_SCOPE } from "@prismalens/auth";
import { browserContract } from "@prismalens/contracts";
import type { Request } from "express";
import { OperatorResolver } from "../../core/auth/operator.resolver.js";
import { isOwner, requireOwner } from "../../core/auth/owner.js";
import { MutationThrottleGuard } from "../../core/throttle/mutation-throttle.guard.js";
import { BrowserError, BrowserHostService } from "./browser-host.service.js";

/** Frames can show what the user is signed in to: only the owner watches, types or decides (#1061). */
const OWNER_ONLY = "Only the host can watch the browser.";
const RECHECK_MS = 15_000;

async function mapped<T>(work: () => Promise<T>): Promise<T> {
	try {
		return await work();
	} catch (e) {
		if (e instanceof BrowserError)
			throw new ORPCError(e.code, { message: e.message });
		throw e;
	}
}

@UseGuards(MutationThrottleGuard)
@Controller()
export class BrowserController {
	constructor(
		private readonly browser: BrowserHostService,
		private readonly operator: OperatorResolver,
	) {}

	@Implement(browserContract)
	routes() {
		const owner = (request: unknown) => requireOwner(request, OWNER_ONLY);
		return {
			status: implement(browserContract.status).handler(
				async ({ input, context }) => {
					const engine = await this.browser.engineState();
					const canDrive = isOwner(context.request);
					return {
						engine: engine.state,
						engineName: engine.name,
						canDrive,
						tabs: canDrive ? this.browser.threadTabs(input.id) : [],
					};
				},
			),
			stream: implement(browserContract.stream).handler(
				({ input, context, signal }) => {
					owner(context.request);
					if (
						!this.browser.threadTabs(input.id).some((t) => t.id === input.tab)
					)
						throw new ORPCError("NOT_FOUND", { message: "No such tab." });
					return this.watch(
						input.id,
						input.tab,
						context.request as Request,
						signal,
					);
				},
			),
			open: implement(browserContract.open).handler(({ input, context }) => {
				owner(context.request);
				return mapped(() => this.browser.openByUser(input.id, input.url));
			}),
			navigate: implement(browserContract.navigate).handler(
				({ input, context }) => {
					owner(context.request);
					return mapped(() =>
						this.browser.navigateByUser(input.id, input.tab, input.to),
					);
				},
			),
			input: implement(browserContract.input).handler(
				async ({ input, context }) => {
					owner(context.request);
					await mapped(() =>
						this.browser.input(input.id, input.tab, input.input),
					);
					return { ok: true };
				},
			),
			control: implement(browserContract.control).handler(
				({ input, context }) => {
					owner(context.request);
					return mapped(async () =>
						this.browser.control(input.id, input.tab, input.to),
					);
				},
			),
			close: implement(browserContract.close).handler(
				async ({ input, context }) => {
					owner(context.request);
					return {
						closed: await mapped(() =>
							this.browser.closeByUser(input.id, input.tab),
						),
					};
				},
			),
			clear: implement(browserContract.clear).handler(async ({ context }) => {
				owner(context.request);
				await this.browser.clear();
				return { cleared: true };
			}),
			getSettings: implement(browserContract.getSettings).handler(() =>
				this.browser.settings(),
			),
			setSettings: implement(browserContract.setSettings).handler(
				({ input, context }) => {
					requireOwner(context.request);
					return this.browser.setSettings(input);
				},
			),
		};
	}

	/** A revoked or demoted device stops watching within one recheck. */
	private async *watch(
		threadId: string,
		tab: string,
		request: Request,
		signal?: AbortSignal,
	) {
		const stop = new AbortController();
		const both = signal ? AbortSignal.any([signal, stop.signal]) : stop.signal;
		const timer = setInterval(() => {
			void this.operator
				.resolve(request)
				.catch(() => null)
				.then((op) => {
					if (!op?.device.scopes.includes(ACCESS_SCOPE)) stop.abort();
				});
		}, RECHECK_MS);
		timer.unref?.();
		try {
			yield* this.browser.watch(threadId, tab, both);
		} finally {
			clearInterval(timer);
		}
	}
}
