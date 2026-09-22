// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { type ExecutionContext, Injectable } from "@nestjs/common";
import { ThrottlerGuard } from "@nestjs/throttler";
import type { Request } from "express";

/**
 * The rate limit on the setup, settings and delivery contracts guards what a
 * caller can *do* there: create the owner, reset the data, probe an agent,
 * post a report. Reads are what the UI does on every navigation (setup status
 * on each page load; agent status, settings, integrations and connections on
 * each record and each settings section), so they pass untouched.
 *
 * An oRPC controller is one Nest handler for a whole contract, so the stock key
 * (class + handler + caller) would pool every route of a contract into one
 * bucket. Writes are keyed by method and path instead: a run of harness probes
 * cannot lock the owner out of resetting the data.
 */
@Injectable()
export class MutationThrottleGuard extends ThrottlerGuard {
	protected override async shouldSkip(
		context: ExecutionContext,
	): Promise<boolean> {
		const method = context.switchToHttp().getRequest<Request>().method;
		return method === "GET" || method === "HEAD";
	}

	protected override generateKey(
		context: ExecutionContext,
		suffix: string,
		name: string,
	): string {
		const req = context.switchToHttp().getRequest<Request>();
		return super.generateKey(
			context,
			`${req.method} ${req.path} ${suffix}`,
			name,
		);
	}
}
