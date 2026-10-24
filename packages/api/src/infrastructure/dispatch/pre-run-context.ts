// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * What PrismaLens fetches before a run, written as files beside the checkout
 * (#848 ruling 2026-10-24): telemetry, past incidents, runbooks. Best effort:
 * nothing here ever fails the run. A follow-up reads the saved files again.
 */
import {
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
	type ContextPack,
	type FiringAlert,
	type PreRunContext,
	PreRunContextSchema,
	type PreRunSource,
} from "@prismalens/contracts/schemas";
import { Logger } from "@prismalens/logger";
import type {
	RunbookEntry,
	RunbookResult,
} from "../../modules/gateway/runbooks.js";
import type { SnapshotWindow } from "../../modules/integrations/source-query.js";
import { scrubSecrets } from "../../modules/integrations/source-request.js";
import type { SourceOutcome } from "../../modules/integrations/telemetry-snapshot.js";

const logger = new Logger({ context: "PreRunContext" });

/** `<run>/context`: outside every repo snapshot, and kept when the run's workspace is cleared. */
export const CONTEXT_DIR = "context";
const INDEX = "index.json";
const EXCERPT_CHARS = 3_000;
const RUNBOOK_FILES = 10;

export type RunbookDoc = RunbookEntry & { read: RunbookResult };

/** From half an hour before the first alert, at most six hours back, to now. */
export function snapshotWindow(
	alerts: readonly FiringAlert[],
	now: Date,
	service?: string,
): SnapshotWindow {
	const first = alerts
		.map((a) => (a.startsAt ? Date.parse(a.startsAt) : Number.NaN))
		.filter(Number.isFinite)
		.sort((a, b) => a - b)[0];
	const end = now.getTime();
	const from = (first ?? end - 30 * 60_000) - 30 * 60_000;
	const start = Math.min(
		end - 15 * 60_000,
		Math.max(end - 6 * 3_600_000, from),
	);
	return {
		start: new Date(start),
		end: now,
		...(service ? { service } : {}),
	};
}

function runbooksMarkdown(docs: readonly RunbookDoc[]): string {
	const lines = ["# Runbooks in the bound repos", ""];
	for (const [i, d] of docs.entries()) {
		lines.push(
			`## ${d.title} (service ${d.service})`,
			"",
			`Path: ${d.path}`,
			"",
		);
		if (d.link) lines.push(`Link (not fetched): ${d.link}`, "");
		else if (i >= RUNBOOK_FILES)
			lines.push("Not copied here; read it in the checkout.", "");
		else if (d.read.ok && "markdown" in d.read) lines.push(d.read.markdown, "");
		else if (!d.read.ok) lines.push(`Not read: ${d.read.error}`, "");
	}
	return lines.join("\n");
}

/** Writes the run's context folder afresh and returns what the prompt names. */
export function writePreRunContext(
	runDir: string,
	input: {
		window: SnapshotWindow;
		telemetry: readonly SourceOutcome[];
		pastIncidents: ContextPack["priorIncidents"];
		runbooks: readonly RunbookDoc[];
		now: Date;
	},
): PreRunContext {
	const dir = join(runDir, CONTEXT_DIR);
	rmSync(dir, { recursive: true, force: true });
	mkdirSync(dir, { recursive: true });
	const files: PreRunContext["files"] = [];
	const sources: PreRunSource[] = [];
	const counts = new Map<string, number>();
	for (const t of input.telemetry) {
		const who = { kind: t.kind, label: t.label, from: t.from };
		if (t.status === "skipped") {
			logger.warn(
				`pre-run: skipped ${t.label} (${t.kind}, ${t.from}): ${t.reason}`,
			);
			sources.push({ ...who, status: "skipped", detail: t.reason });
			continue;
		}
		const n = (counts.get(t.kind) ?? 0) + 1;
		counts.set(t.kind, n);
		const name = `telemetry-${t.kind}-${n}.json`;
		const text = scrubSecrets(
			JSON.stringify(
				{
					source: who,
					fetchedAt: input.now.toISOString(),
					window: {
						start: input.window.start.toISOString(),
						end: input.window.end.toISOString(),
						...(input.window.service ? { service: input.window.service } : {}),
					},
					...(t.part.data as object),
				},
				null,
				1,
			),
			t.secrets,
		);
		writeFileSync(join(dir, name), text);
		logger.info(`pre-run: read ${t.label} (${t.kind}): ${t.part.summary}`);
		files.push({ name, about: `${t.label} (${t.kind}): ${t.part.summary}` });
		sources.push({
			...who,
			status: "fetched",
			detail: t.part.summary,
			file: name,
			excerpt: text.slice(0, EXCERPT_CHARS),
		});
	}
	if (input.pastIncidents.length) {
		writeFileSync(
			join(dir, "past-incidents.json"),
			JSON.stringify(input.pastIncidents, null, 1),
		);
		files.push({
			name: "past-incidents.json",
			about: `${input.pastIncidents.length} similar past incidents`,
		});
	}
	if (input.runbooks.length) {
		writeFileSync(join(dir, "runbooks.md"), runbooksMarkdown(input.runbooks));
		files.push({
			name: "runbooks.md",
			about: `${input.runbooks.length} runbooks from the bound repos`,
		});
	}
	const ctx: PreRunContext = {
		dir,
		fetchedAt: input.now.toISOString(),
		sources,
		files,
	};
	writeFileSync(join(dir, INDEX), JSON.stringify(ctx, null, 1));
	return ctx;
}

/** A follow-up's context: what its run saved, never a new fetch. Null when it saved none. */
export function readPreRunContext(runDir: string): PreRunContext | null {
	const dir = join(runDir, CONTEXT_DIR);
	const file = join(dir, INDEX);
	if (!existsSync(file)) return null;
	try {
		const parsed = PreRunContextSchema.safeParse(
			JSON.parse(readFileSync(file, "utf8")),
		);
		// The folder is where this run's dir says, whatever the file claims.
		return parsed.success ? { ...parsed.data, dir } : null;
	} catch {
		return null;
	}
}
