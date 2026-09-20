// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Injectable, Logger, type OnApplicationShutdown } from "@nestjs/common";
import { disarmForcedExit, releaseWorkspaceLock } from "@prismalens/config";

/**
 * Releases the workspace lock as the last step of an ordinary shutdown
 * (#605 edge 5).
 *
 * This hangs off Nest's own shutdown hooks rather than a second signal handler
 * of its own, for one reason: ordering. The lock is what stops a second
 * `pl up` touching this workspace's database, so it must not come off until
 * the application has finished closing — releasing it from a parallel handler
 * would open the workspace while this process was still writing to it.
 * `onApplicationShutdown` is the last hook Nest runs, immediately before it
 * re-raises the signal, which is exactly the moment we want.
 *
 * `releaseWorkspaceLock` is idempotent and re-checks the recorded pid, so this
 * is safe when the lock was never taken, was already released, or has since
 * been reclaimed by another process.
 */
@Injectable()
export class WorkspaceLockShutdownService implements OnApplicationShutdown {
	private readonly logger = new Logger(WorkspaceLockShutdownService.name);

	onApplicationShutdown(signal?: string): void {
		// Before Nest re-raises: otherwise the re-raised signal looks like a
		// second stop request and the forced-exit path would pre-empt the
		// conventional exit code.
		disarmForcedExit();
		if (releaseWorkspaceLock()) {
			this.logger.log(
				`Workspace lock released${signal ? ` on ${signal}` : ""}`,
			);
		}
	}
}
