// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Injectable, Optional } from "@nestjs/common";
import { sourceType } from "@prismalens/contracts/schemas";
import type { PrismaService } from "../../core/prisma/prisma.service.js";
import type { IntegrationsService } from "./integrations.service.js";
import { type OpenedSource, openSource } from "./open-source.js";
import {
	failureReason,
	LIMITS,
	QUERY_KINDS,
	QueryFailed,
	type QueryKind,
	SNAPSHOT_QUERIES,
	type SnapshotPart,
	type SnapshotWindow,
} from "./source-query.js";
import { sourceRequestFn } from "./source-request.js";

/** Each source's own limit; a slow one is skipped, never waited on (#848 ruling 2026-10-24). */
export const SOURCE_TIMEOUT_MS = 10_000;

export interface SnapshotSource {
	kind: QueryKind;
	label: string;
	/** The user's env, or the entry saved in PrismaLens (#907's states). */
	from: "env" | "set";
	open(timeoutMs: number): Promise<OpenedSource>;
}

export type SourceOutcome = {
	kind: QueryKind;
	label: string;
	from: "env" | "set";
} & (
	| { status: "fetched"; part: SnapshotPart; secrets: string[] }
	| { status: "skipped"; reason: string }
);

type Env = Record<string, string | undefined>;

/** The source of `kind` named in the env, or null; a URL without a token sends none. */
export function envSource(kind: QueryKind, env: Env): SnapshotSource | null {
	const detect = sourceType(kind)?.detect;
	const urlVar = detect?.urlEnv?.find((v) => env[v]?.trim());
	if (!urlVar) return null;
	const url = (env[urlVar] as string).trim();
	const token = detect?.tokenEnv?.map((v) => env[v]?.trim()).find(Boolean);
	return {
		kind,
		label: urlVar,
		from: "env",
		open: async (timeoutMs) => {
			const base = { id: `env:${urlVar}`, label: urlVar, kind };
			try {
				new URL(url);
			} catch {
				return { ...base, secrets: [], unusable: `${urlVar} is not a URL` };
			}
			return {
				...base,
				secrets: token ? [token] : [],
				request: sourceRequestFn(
					url,
					{
						ok: true,
						credential: token ? { kind: "bearer", token } : { kind: "none" },
					},
					{ timeoutMs, maxBytes: LIMITS.responseBytes },
				),
			};
		},
	};
}

/** Rejects when `ms` passes, so a source that ignores the signal still ends. */
function within<T>(ms: number, work: Promise<T>): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const late = new Promise<never>((_, reject) => {
		timer = setTimeout(
			() => reject(new DOMException("timed out", "TimeoutError")),
			ms,
		);
	});
	return Promise.race([work, late]).finally(() => clearTimeout(timer));
}

/** Every source in parallel, each under its own limit; one that fails is skipped with its reason. */
export async function fetchSnapshot(
	sources: readonly SnapshotSource[],
	window: SnapshotWindow,
	opts: { timeoutMs?: number; signal?: AbortSignal } = {},
	queries = SNAPSHOT_QUERIES,
): Promise<SourceOutcome[]> {
	const ms = opts.timeoutMs ?? SOURCE_TIMEOUT_MS;
	return Promise.all(
		sources.map(async (s): Promise<SourceOutcome> => {
			const who = { kind: s.kind, label: s.label, from: s.from };
			const timeout = AbortSignal.timeout(ms);
			const signal = opts.signal
				? AbortSignal.any([timeout, opts.signal])
				: timeout;
			try {
				const opened = await within(ms, s.open(ms));
				if (!opened.request)
					return {
						...who,
						status: "skipped",
						reason: opened.unusable ?? "it cannot be opened here",
					};
				const part = await within(ms, queries[s.kind](opened, window, signal));
				return { ...who, status: "fetched", part, secrets: opened.secrets };
			} catch (e) {
				return {
					...who,
					status: "skipped",
					reason: e instanceof QueryFailed ? e.message : failureReason(e),
				};
			}
		}),
	);
}

/**
 * The pre-run telemetry fetch (#848 ruling 2026-10-24). Per kind, a source named in the
 * env wins; otherwise every connection saved in PrismaLens. Nothing configured, nothing read.
 */
@Injectable()
export class TelemetrySnapshotService {
	constructor(
		private readonly prisma: PrismaService,
		@Optional() private readonly integrations?: IntegrationsService,
	) {}

	async sources(env: Env = process.env): Promise<SnapshotSource[]> {
		const rows = await this.prisma.connection.findMany({
			where: {
				status: { not: "REVOKED" },
				integration: { templateId: { in: [...QUERY_KINDS] } },
			},
			select: {
				id: true,
				label: true,
				integration: { select: { templateId: true, label: true } },
			},
		});
		return QUERY_KINDS.flatMap((kind): SnapshotSource[] => {
			const fromEnv = envSource(kind, env);
			if (fromEnv) return [fromEnv];
			return rows
				.filter((r) => r.integration.templateId === kind)
				.map((r) => {
					const src = {
						id: r.id,
						label: r.label || r.integration.label,
						kind,
					};
					return {
						kind,
						label: src.label,
						from: "set",
						open: async (timeoutMs) =>
							this.integrations
								? openSource(this.integrations, src, {
										timeoutMs,
										maxBytes: LIMITS.responseBytes,
									})
								: {
										...src,
										secrets: [],
										unusable: "PrismaLens cannot open this source here",
									},
					};
				});
		});
	}

	async fetch(
		window: SnapshotWindow,
		signal?: AbortSignal,
	): Promise<SourceOutcome[]> {
		return fetchSnapshot(await this.sources(), window, {
			...(signal ? { signal } : {}),
		});
	}
}
