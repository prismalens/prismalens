// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * What PrismaLens reads before a run (#848): built in memory, scrubbed and bounded,
 * stored with the run as the source of truth, and copied for the agent under each
 * session cwd at `.prismalens/runs/<id>/`. Nothing here ever fails the run.
 */
import { execFile } from "node:child_process";
import {
	existsSync,
	lstatSync,
	mkdirSync,
	realpathSync,
	writeFileSync,
} from "node:fs";
import { join, relative } from "node:path";
import { promisify } from "node:util";
import {
	type CheckoutSkipped,
	type ContextPack,
	type FiringAlert,
	type PreRunContext,
	type PreRunCopy,
	type PreRunSnapshot,
	PreRunSnapshotSchema,
	type PreRunSource,
	type PreRunSummary,
} from "@prismalens/contracts/schemas";
import { Logger } from "@prismalens/logger";
import type { RunbookEntry } from "../../modules/gateway/runbooks.js";
import {
	boundSnapshot,
	type SnapshotWindow,
} from "../../modules/integrations/source-query.js";
import { scrubSecrets } from "../../modules/integrations/source-request.js";
import type { SourceOutcome } from "../../modules/integrations/telemetry-snapshot.service.js";

const run = promisify(execFile);
const logger = new Logger({ context: "PreRunContext" });

/** Each save or load of the stored snapshot races this (#848). */
export const SNAPSHOT_IO_MS = 5_000;
const EXCERPT_CHARS = 3_000;
const INDEX = "index.json";
const RUN_ID = /^[A-Za-z0-9-]+$/;
/** A stored snapshot is read back on a follow-up, so its file names are checked before any write. */
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const GITIGNORE_REFUSAL =
	"an existing .prismalens/runs/.gitignore belongs to the repository";

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

/** Every string value and key with each secret replaced, before anything is serialized. */
export function scrubDeep(value: unknown, secrets: readonly string[]): unknown {
	if (!secrets.length) return value;
	if (typeof value === "string") return scrubSecrets(value, [...secrets]);
	if (Array.isArray(value)) return value.map((v) => scrubDeep(v, secrets));
	if (value && typeof value === "object")
		return Object.fromEntries(
			Object.entries(value).map(([k, v]) => [
				scrubSecrets(k, [...secrets]),
				scrubDeep(v, secrets),
			]),
		);
	return value;
}

function runbooksMarkdown(entries: readonly RunbookEntry[]): string {
	const lines = [
		"# Runbooks in the bound repos",
		"",
		"Read one with runbooks_read, or in the checkout.",
		"",
	];
	for (const d of entries) {
		lines.push(
			`## ${d.title} (service ${d.service})`,
			"",
			`Path: ${d.path}`,
			"",
		);
		if (d.link) lines.push(`Link (not fetched): ${d.link}`, "");
	}
	return lines.join("\n");
}

/** The run's pre-run snapshot, in memory: every text in it is scrubbed, each source bounded. */
export function buildPreRunSnapshot(input: {
	window: SnapshotWindow;
	telemetry: readonly SourceOutcome[];
	notConfigured?: PreRunSnapshot["notConfigured"];
	pastIncidents: ContextPack["priorIncidents"];
	runbooks: readonly RunbookEntry[];
	runbooksSkipped?: string;
	checkoutsSkipped?: readonly CheckoutSkipped[];
	now: Date;
}): PreRunSnapshot {
	const secrets = input.telemetry.flatMap((t) =>
		"secrets" in t ? t.secrets : [],
	);
	const clean = (text: string) => scrubSecrets(text, secrets);
	const files: PreRunSnapshot["files"] = [];
	const sources: PreRunSource[] = [];
	const counts = new Map<string, number>();
	const window = {
		start: input.window.start.toISOString(),
		end: input.window.end.toISOString(),
		...(input.window.service ? { service: input.window.service } : {}),
	};
	for (const t of input.telemetry) {
		const who = {
			kind: t.kind,
			label: t.label,
			from: t.from,
			...(t.facts ?? {}),
		};
		const why = t.facts?.selectedBy ? ` (${t.facts.selectedBy})` : "";
		if (!("part" in t)) {
			logger.warn(
				clean(
					`pre-run: ${t.status === "skipped" ? "skipped" : "not read"} ${t.label} (${t.kind}, ${t.from})${why}: ${t.reason}`,
				),
			);
			sources.push({ ...who, status: t.status, detail: clean(t.reason) });
			continue;
		}
		const n = (counts.get(t.kind) ?? 0) + 1;
		counts.set(t.kind, n);
		const name = `telemetry-${t.kind}-${n}.json`;
		const head = { source: who, fetchedAt: input.now.toISOString(), window };
		const { text, truncated } = boundSnapshot(
			scrubDeep(t.part.data, secrets),
			(data) =>
				clean(
					JSON.stringify(
						scrubDeep({ ...head, ...(data as object) }, secrets),
						null,
						1,
					),
				),
		);
		const detail = clean(t.part.summary);
		logger.info(`pre-run: read ${t.label} (${t.kind})${clean(why)}: ${detail}`);
		files.push({ name, about: `${t.label} (${t.kind}): ${detail}`, text });
		sources.push({
			...who,
			status: t.status,
			detail,
			file: name,
			excerpt: text.slice(0, EXCERPT_CHARS),
			...(truncated ? { truncated } : {}),
		});
	}
	if (input.pastIncidents.length)
		files.push({
			name: "past-incidents.json",
			about: `${input.pastIncidents.length} similar past incidents`,
			text: clean(
				JSON.stringify(scrubDeep(input.pastIncidents, secrets), null, 1),
			),
		});
	if (input.runbooks.length)
		files.push({
			name: "runbooks.md",
			about: `${input.runbooks.length} runbooks from the bound repos`,
			text: clean(runbooksMarkdown(input.runbooks)),
		});
	if (input.runbooksSkipped)
		logger.warn(`pre-run: runbooks skipped: ${input.runbooksSkipped}`);
	return {
		fetchedAt: input.now.toISOString(),
		window,
		sources,
		notConfigured: [...(input.notConfigured ?? [])],
		runbooks: input.runbooks.map((r) => ({
			title: r.title,
			service: r.service,
			path: r.path,
			origin: r.origin,
			...(r.link ? { link: r.link } : {}),
		})),
		...(input.runbooksSkipped
			? { runbooksSkipped: input.runbooksSkipped }
			: {}),
		checkoutsSkipped: [...(input.checkoutsSkipped ?? [])],
		files,
	};
}

/** The snapshot without the files' text: what the prompt, the report and the API read. */
export function summaryOf(snap: PreRunSnapshot): PreRunSummary {
	return {
		...snap,
		files: snap.files.map(({ name, about }) => ({ name, about })),
	};
}

/** The stored text a follow-up reads again; null when it does not parse. */
export function parseStoredSnapshot(text: string): PreRunSnapshot | null {
	try {
		const parsed = PreRunSnapshotSchema.safeParse(JSON.parse(text));
		return parsed.success ? parsed.data : null;
	} catch {
		return null;
	}
}

/** The run's state from the snapshot, how its save went and how its copies went. */
export function preRunContext(
	snap: PreRunSnapshot,
	saved: { ok: true } | { ok: false; error: string },
	copy: PreRunCopy,
): PreRunContext {
	if (saved.ok) return { state: "ready", ...summaryOf(snap), copy };
	logger.warn(
		`snapshot not saved; a follow-up will not have it (${saved.error})`,
	);
	return {
		state: "not-saved",
		...summaryOf(snap),
		saveError: saved.error,
		copy,
	};
}

/** A session cwd that gets a read copy; `checkout` is the clone it sits in, when it is one. */
export interface CopyTarget {
	dir: string;
	checkout?: string;
}

type Refusal = { ok: false; reason: string };

/** The read copies, under each target's `.prismalens/runs/<runId>/`; a target that refuses is left untouched. */
export async function writeReadCopies(
	targets: readonly CopyTarget[],
	runId: string,
	snap: PreRunSnapshot,
): Promise<PreRunCopy> {
	if (!RUN_ID.test(runId))
		throw new Error(`Invalid run id for the pre-run copy: ${runId}`);
	const dir = `.prismalens/runs/${runId}`;
	const refused: string[] = [];
	let written = 0;
	for (const target of targets) {
		const out = await writeOne(target, runId, snap).catch(
			(e): Refusal => ({
				ok: false,
				reason: e instanceof Error ? e.message : String(e),
			}),
		);
		if (out.ok) written++;
		else {
			logger.warn(`pre-run: no read copy in ${target.dir}: ${out.reason}`);
			refused.push(out.reason);
		}
	}
	const reason = [...new Set(refused)].join("; ");
	return written
		? { state: "written", dir, ...(reason ? { reason } : {}) }
		: { state: "failed", reason: reason || "the run has no working directory" };
}

/** No step but the last writes, and none unlinks or removes. */
async function writeOne(
	target: CopyTarget,
	runId: string,
	snap: PreRunSnapshot,
): Promise<{ ok: true } | Refusal> {
	const refuse = (reason: string): Refusal => ({ ok: false, reason });
	const C = target.dir;
	let Cr: string;
	try {
		Cr = realpathSync(C);
	} catch {
		return refuse("the working directory is not there");
	}
	const root = ".prismalens";
	const runs = join(root, "runs");
	const gitignore = join(runs, ".gitignore");
	const own = join(runs, runId);
	for (const rel of [root, runs, gitignore, own]) {
		const path = join(C, rel);
		let st: ReturnType<typeof lstatSync>;
		try {
			st = lstatSync(path);
		} catch {
			continue;
		}
		if (st.isSymbolicLink()) return refuse(`${rel} is a link`);
		if (realpathSync(path) !== join(Cr, rel))
			return refuse(`${rel} resolves outside the working directory`);
		if (rel === gitignore) return refuse(GITIGNORE_REFUSAL);
		if (rel === own) return refuse(`${rel} already exists`);
		if (!st.isDirectory()) return refuse(`${rel} is not a folder`);
	}
	if (target.checkout) {
		const inRepo = relative(target.checkout, C).split("\\").join("/");
		const pathspec = inRepo ? `${inRepo}/.prismalens` : ".prismalens";
		try {
			const { stdout } = await run(
				"git",
				["-C", target.checkout, "ls-files", "-z", "--", pathspec],
				{ timeout: 5_000, killSignal: "SIGKILL", windowsHide: true },
			);
			if (stdout.length) return refuse("the repository tracks .prismalens");
		} catch {
			return refuse("could not check what the repository tracks");
		}
	}
	for (const rel of [root, runs, own]) {
		const path = join(C, rel);
		if (!existsSync(path)) mkdirSync(path);
		if (realpathSync(path) !== join(Cr, rel))
			return refuse(`${rel} resolves outside the working directory`);
	}
	writeFileSync(join(C, gitignore), "*\n", { flag: "wx" });
	const out = join(C, own);
	for (const f of snap.files)
		if (SAFE_NAME.test(f.name) && f.name !== INDEX)
			writeFileSync(join(out, f.name), f.text, { flag: "wx" });
	writeFileSync(join(out, INDEX), JSON.stringify(summaryOf(snap), null, 1), {
		flag: "wx",
	});
	return { ok: true };
}
