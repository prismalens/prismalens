// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * File-backed `InvestigationStore` adapter (ADR-0018) — wraps the CLI's
 * {@link SessionManager} so `conductRun` can drive the durable lifecycle
 * (create -> append(per event) -> finish|fail) without the engine knowing
 * anything about `~/.prismalens` (ADR-0011).
 *
 * `create()` retains the session record so its `workspacePath` can be read back
 * afterwards (e.g. the CLI's "Report saved to <workspacePath>/report.json" line).
 */
import type {
	CanonicalEvent,
	InvestigationReport,
} from "@prismalens/contracts";
import type { InvestigationStore } from "@prismalens/engine";
import type {
	CreateSessionInput,
	SessionManager,
	SessionRecord,
} from "./session.js";

export interface FileSessionStore {
	store: InvestigationStore;
	/** The created session's workspace dir. Throws if read before `create()` resolves. */
	workspacePath(): string;
}

/** Build a `conductRun`-ready store over `sessions`, scoped to one run's `meta`. */
export function createFileSessionStore(
	sessions: SessionManager,
	meta: CreateSessionInput,
): FileSessionStore {
	let session: SessionRecord | undefined;

	const store: InvestigationStore = {
		async create() {
			session = await sessions.create(meta);
		},
		async append(event: CanonicalEvent) {
			await sessions.appendEvent(meta.runId, event);
		},
		async finish(report: InvestigationReport) {
			await sessions.writeReport(meta.runId, report);
			await sessions.update(meta.runId, {
				status: "done",
				completedAt: new Date().toISOString(),
			});
		},
		async fail() {
			await sessions.update(meta.runId, { status: "errored" });
		},
	};

	return {
		store,
		workspacePath() {
			if (!session) {
				throw new Error(
					"workspacePath() called before store.create() resolved",
				);
			}
			return session.workspacePath;
		},
	};
}
