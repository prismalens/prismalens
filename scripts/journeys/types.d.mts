// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/** The one thing a journey is allowed to touch: a running PrismaLens, reached over HTTP. */
export interface Target {
	name: "in-process" | "packed" | "live";
	/** `scripted`: the fake ACP agent plays a named session; `real`: whatever agent is on PATH. */
	agent: "scripted" | "real";
	/** Where PrismaLens listens now; a restart may change it. */
	readonly baseUrl: string;
	/** A scratch directory the journey builds fixtures in; removed by `cleanup()`. */
	workDir: string;
	/** A checkout to investigate instead of the built-in fixture repo. */
	repo?: string;
	/** The app's data directory, read only to explain a stalled run. */
	workspace?: string;
	/** How long a run may take from its start to a report. */
	runTimeoutMs: number;
	/** An authenticated call under `/api`; throws on a non-2xx answer. */
	// biome-ignore lint/suspicious/noExplicitAny: an answer's shape is what the journey asserts
	api<T = any>(
		path: string,
		init?: { method?: string; body?: unknown },
	): Promise<T>;
	/** POSTs an Alertmanager v4 webhook body with the webhook's bearer token. */
	sendAlert(body: unknown): Promise<Response>;
	/** Stops PrismaLens as a crash would and starts it again on the same data. */
	restart(): Promise<void>;
	/** Skips the wait a restart puts before a run resumes, where the target can. */
	skipRecoveryDelay?(investigationId: string): Promise<void>;
	cleanup(): Promise<void>;
}

export interface JourneyContext {
	log(message: string): void;
	/** The runs a journey started, so a failure or a recording can name them. */
	investigations: string[];
}

export interface Journey {
	name: string;
	title: string;
	timeoutMs: number;
	run(target: Target, ctx: JourneyContext): Promise<void>;
}
