// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * `conductRun` has exactly two ports (ADR 0002 §4): a live sink that may drop
 * and a durable store that must be complete. It drives one investigation and
 * classifies the outcome; the API owns concurrency above it.
 */
import type {
	CanonicalEvent,
	InvestigationReport,
} from "@prismalens/contracts/schemas";
import {
	isCancelledError,
	type RunInvestigationOptions,
	runInvestigation,
} from "./investigate.js";

export type InvestigationSink = (event: CanonicalEvent) => void | Promise<void>;

export interface InvestigationStore {
	create(): Promise<void>;
	append(event: CanonicalEvent): Promise<void>;
	finish(report: InvestigationReport): Promise<void>;
	fail(error: string): Promise<void>;
	flush?(): Promise<void>;
}

export interface ConductedOutcome {
	runId: string;
	report: InvestigationReport | null;
	error: string | null;
	failureKind: "none" | "no-evidence" | "error" | "cancelled";
}

export async function conductRun(
	opts: RunInvestigationOptions,
	io: { sink: InvestigationSink; store: InvestigationStore },
): Promise<ConductedOutcome> {
	const { runId } = opts;
	await io.store.create();
	let report: InvestigationReport | null = null;
	let lastError: string | null = null;
	let cancelled = false;
	try {
		for await (const event of runInvestigation(opts)) {
			await io.sink(event);
			await io.store.append(event);
			if (event.kind === "report") report = event.report;
			else if (event.kind === "error") {
				lastError = event.message;
				if (isCancelledError(event.message)) cancelled = true;
			}
		}
	} catch (err) {
		const msg = String((err as { message?: unknown } | null)?.message ?? err);
		await io.store.fail(msg);
		return { runId, report: null, error: msg, failureKind: "error" };
	}
	if (cancelled) {
		await io.store.flush?.();
		return { runId, report: null, error: lastError, failureKind: "cancelled" };
	}
	if (report) {
		await io.store.finish(report);
		return { runId, report, error: null, failureKind: "none" };
	}
	const err = lastError ?? "investigation produced no evidence";
	await io.store.fail(err);
	return {
		runId,
		report: null,
		error: err,
		failureKind: err.includes("no evidence") ? "no-evidence" : "error",
	};
}
