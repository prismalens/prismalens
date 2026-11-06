// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Injectable } from "@nestjs/common";

interface DispatchHandle {
	drain(on: boolean): void;
	running(): number;
}

/**
 * Whether dispatch may claim new work (#724). An update install drains it:
 * webhooks, manual starts, wakes and schedules still queue their jobs, and the
 * loop claims none until admission is restored or the next process boots.
 */
@Injectable()
export class AdmissionService {
	private dispatch: DispatchHandle | null = null;
	private drainingNow = false;

	attach(dispatch: DispatchHandle): void {
		this.dispatch = dispatch;
		if (this.drainingNow) dispatch.drain(true);
	}

	get draining(): boolean {
		return this.drainingNow;
	}

	drain(): void {
		this.drainingNow = true;
		this.dispatch?.drain(true);
	}

	restore(): void {
		this.drainingNow = false;
		this.dispatch?.drain(false);
	}

	/** Runs this process's dispatch loop holds right now. */
	running(): number {
		return this.dispatch?.running() ?? 0;
	}
}
