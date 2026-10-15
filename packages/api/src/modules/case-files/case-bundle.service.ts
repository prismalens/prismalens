// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The arm-C hook (spec §4): copies the incident's redacted capture into the
 * agent's cwd at `.prismalens/case/` and keeps it current as artifacts land.
 * `attach` does local file work only; it never waits for a capture.
 */
import {
	appendFile,
	mkdir,
	readFile,
	rename,
	stat,
	writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { Injectable, Logger } from "@nestjs/common";
import { OnEvent } from "@nestjs/event-emitter";
import type { Capture, CaptureArtifact } from "@prismalens/database";
import { sanitizeUntrustedLine } from "@prismalens/engine";
import { PrismaService } from "../../core/prisma/prisma.service.js";
import {
	CASE_CAPTURE_UPDATED_EVENT,
	type CaseCaptureUpdatedEvent,
} from "./capture.service.js";
import { CaseFileSettingsService } from "./case-file-settings.service.js";
import { ArtifactStore } from "./storage/artifact-store.js";

/** Relative to the run's cwd: inside it, so the agent's read rule admits it (§4 constraint 1). */
export const BUNDLE_DIR = ".prismalens/case";
export const BUNDLE_TTL_MS = 2 * 60 * 60 * 1000;
export const DIGEST_MAX_LINES = 12;
const DIGEST_LINE_MAX = 160;
const SUBJECT_MAX = 80;
const EXCLUDE_LINE = ".prismalens/";

export interface CaseBundle {
	path: string;
	target: string;
	digest: string[];
}

export type DigestCapture = Pick<
	Capture,
	"state" | "stateReason" | "identityMatches" | "missedFrom" | "missedTo"
>;
export type DigestArtifact = Pick<
	CaptureArtifact,
	| "seq"
	| "purpose"
	| "subject"
	| "retrieval"
	| "retrievalReason"
	| "redactedBytes"
	| "redactions"
	| "expiredAt"
>;

export interface BundleManifestArtifact {
	id: string;
	file: string | null;
	purpose: string;
	subject: string | null;
	command: string;
	retrieval: string;
	reason: string | null;
	collectedAt: string;
	redactions: number;
	withheld: boolean;
	expired: boolean;
}

export interface BundleManifest {
	state: string;
	reason: string | null;
	target: { kubeContext: string; namespace: string };
	identityMatches: boolean | null;
	missed: { from: string; to: string } | null;
	updatedAt: string;
	artifacts: BundleManifestArtifact[];
}

const clock = (d: Date): string => `${d.toISOString().slice(11, 19)}Z`;

const clip = (text: string, max: number): string =>
	text.length > max ? `${text.slice(0, max - 1)}…` : text;

/** Redaction count, or null when redaction failed (or its record is unreadable): the artifact is withheld. */
export function redactionCount(redactions: string): number | null {
	try {
		const parsed: unknown = JSON.parse(redactions);
		if (typeof parsed !== "object" || parsed === null || "error" in parsed)
			return null;
		return Object.values(parsed).reduce<number>(
			(sum, n) => sum + (typeof n === "number" ? n : 0),
			0,
		);
	} catch {
		return null;
	}
}

function retrievalWord(a: DigestArtifact): string {
	if (redactionCount(a.redactions) === null) return "withheld";
	if (a.expiredAt) return "expired";
	return a.retrieval === "complete"
		? "complete"
		: `partial(${a.retrievalReason ?? "error"})`;
}

/**
 * The prompt's retrieval digest: at most 12 lines from the rows that exist at
 * `now`, built only from values PrismaLens wrote, never from artifact content.
 */
export function retrievalDigest(
	capture: DigestCapture | null,
	artifacts: readonly DigestArtifact[],
	now: Date,
): string[] {
	if (!capture)
		return [`capture queued as of ${clock(now)}; nothing has landed`];
	const reason = capture.stateReason ? `(${capture.stateReason})` : "";
	const identity =
		capture.identityMatches === null
			? ""
			: `; identity ${capture.identityMatches ? "matches" : "MISMATCH"}`;
	const missed =
		capture.missedFrom && capture.missedTo
			? `; missed ${clock(capture.missedFrom)}–${clock(capture.missedTo)}`
			: "";
	const head = `capture ${capture.state}${reason} as of ${clock(now)}${identity}${missed}`;

	const lines = [...artifacts]
		.sort((a, b) => a.seq - b.seq)
		.map((a) => {
			const subject = a.subject
				? ` ${clip(sanitizeUntrustedLine(a.subject), SUBJECT_MAX)}`
				: "";
			const count = redactionCount(a.redactions) ?? 0;
			return clip(
				`${a.purpose}${subject}: ${retrievalWord(a)}, ${a.redactedBytes} bytes, ${count} redactions`,
				DIGEST_LINE_MAX,
			);
		});
	const room = DIGEST_MAX_LINES - 1;
	if (lines.length <= room) return [head, ...lines];
	const shown = room - 1;
	return [
		head,
		...lines.slice(0, shown),
		`… ${lines.length - shown} more in manifest.json`,
	];
}

/** `<seq>-<purpose>[-<pod>-<container>].{json,log}`; the subject is a cluster name, kept to filename-safe characters. */
export function bundleFileName(
	a: Pick<CaptureArtifact, "seq" | "purpose" | "subject">,
): string {
	const subject = a.subject
		? `-${a.subject.replace(/[^A-Za-z0-9._-]/g, "-")}`
		: "";
	const ext = a.purpose === "logs-previous" ? "log" : "json";
	return `${a.seq}-${a.purpose}${subject}.${ext}`;
}

function commandLine(command: string): string {
	try {
		const argv: unknown = JSON.parse(command);
		return Array.isArray(argv) ? argv.map(String).join(" ") : command;
	} catch {
		return command;
	}
}

const isEnoent = (err: unknown): boolean =>
	(err as NodeJS.ErrnoException | null)?.code === "ENOENT";

async function exists(path: string): Promise<boolean> {
	try {
		await stat(path);
		return true;
	} catch (err) {
		if (isEnoent(err)) return false;
		throw err;
	}
}

/** Keeps the bundle out of `git status` in a single-repo cwd (§7 R5). */
async function excludeFromGit(cwd: string): Promise<void> {
	const gitDir = join(cwd, ".git");
	try {
		if (!(await stat(gitDir)).isDirectory()) return;
	} catch (err) {
		if (isEnoent(err)) return;
		throw err;
	}
	const file = join(gitDir, "info", "exclude");
	let current = "";
	try {
		current = await readFile(file, "utf8");
	} catch (err) {
		if (!isEnoent(err)) throw err;
		await mkdir(join(gitDir, "info"), { recursive: true });
	}
	if (current.split(/\r?\n/).some((l) => l.trim() === EXCLUDE_LINE)) return;
	const sep = current === "" || current.endsWith("\n") ? "" : "\n";
	await appendFile(file, `${sep}${EXCLUDE_LINE}\n`);
}

/** Write-then-rename, so a reader never sees half a file. */
async function writeAtomic(path: string, data: Buffer | string): Promise<void> {
	const tmp = `${path}.tmp`;
	await writeFile(tmp, data, { mode: 0o600 });
	await rename(tmp, path);
}

interface Snapshot {
	capture: (Capture & { artifacts: CaptureArtifact[] }) | null;
	target: { kubeContext: string; namespace: string };
}

@Injectable()
export class CaseBundleService {
	private readonly logger = new Logger(CaseBundleService.name);
	/** incidentId → cwd → expiry (ms). */
	private readonly registered = new Map<string, Map<string, number>>();
	/** One write at a time per cwd, so two refreshes never share a `.tmp`. */
	private readonly chains = new Map<string, Promise<unknown>>();
	/** Overridable in tests. */
	now: () => Date = () => new Date();

	constructor(
		private readonly prisma: PrismaService,
		private readonly settings: CaseFileSettingsService,
		private readonly store: ArtifactStore,
	) {}

	/** Null when the setting is off or the incident's service is unbound. */
	async attach(incidentId: string, cwd: string): Promise<CaseBundle | null> {
		if (!(await this.settings.isEnabled())) return null;
		const incident = await this.prisma.incident.findUnique({
			where: { id: incidentId },
			select: { service: { select: { binding: true } } },
		});
		const binding = incident?.service?.binding;
		if (!binding) return null;

		await mkdir(join(cwd, BUNDLE_DIR), { recursive: true });
		await excludeFromGit(cwd);
		this.register(incidentId, cwd);
		try {
			const snap = await this.serial(cwd, () =>
				this.materialise(incidentId, cwd),
			);
			const at = snap.target;
			return {
				path: BUNDLE_DIR,
				target: `${at.kubeContext}/${at.namespace}`,
				digest: retrievalDigest(
					snap.capture,
					snap.capture?.artifacts ?? [],
					this.now(),
				),
			};
		} catch (err) {
			this.unregister(incidentId, cwd);
			throw err;
		}
	}

	@OnEvent(CASE_CAPTURE_UPDATED_EVENT)
	async handleCaptureUpdated(event: CaseCaptureUpdatedEvent): Promise<void> {
		this.prune();
		if (this.registered.size === 0) return;
		try {
			const links = await this.prisma.caseCapture.findMany({
				where: { captureId: event.captureId },
				select: { incidentId: true },
			});
			const refreshes = links.flatMap(({ incidentId }) =>
				[...(this.registered.get(incidentId)?.keys() ?? [])].map((cwd) =>
					this.refresh(incidentId, cwd),
				),
			);
			await Promise.all(refreshes);
		} catch (err) {
			this.logger.warn(
				`case bundle refresh failed for capture ${event.captureId}: ${err instanceof Error ? err.message : String(err)}`,
			);
		}
	}

	/** The cwds registered for an incident; for tests. */
	registeredDirs(incidentId: string): string[] {
		return [...(this.registered.get(incidentId)?.keys() ?? [])];
	}

	private async refresh(incidentId: string, cwd: string): Promise<void> {
		try {
			await this.serial(cwd, () => this.materialise(incidentId, cwd));
		} catch (err) {
			// The run dir went with its run (clearRunWorkspace): stop following it.
			if (isEnoent(err)) {
				this.unregister(incidentId, cwd);
				return;
			}
			this.logger.warn(
				`case bundle refresh failed in ${cwd}: ${err instanceof Error ? err.message : String(err)}`,
			);
		}
	}

	/** Copies each new redacted file, then replaces manifest.json. Never recreates a deleted dir. */
	private async materialise(
		incidentId: string,
		cwd: string,
	): Promise<Snapshot> {
		const snap = await this.load(incidentId);
		const dir = join(cwd, BUNDLE_DIR);
		const artifacts: BundleManifestArtifact[] = [];
		for (const a of snap.capture?.artifacts ?? []) {
			const count = redactionCount(a.redactions);
			const withheld = count === null;
			let file: string | null = null;
			if (!withheld && !a.expiredAt) {
				const name = bundleFileName(a);
				const dest = join(dir, name);
				if (await exists(dest)) file = name;
				else {
					const bytes = await this.store.readRedactedBytes(a);
					if (bytes) {
						await writeAtomic(dest, bytes);
						file = name;
					}
				}
			}
			artifacts.push({
				id: a.id,
				file,
				purpose: a.purpose,
				subject: a.subject,
				command: commandLine(a.command),
				retrieval: a.retrieval,
				reason: a.retrievalReason,
				collectedAt: a.endedAt.toISOString(),
				redactions: count ?? 0,
				withheld,
				expired: a.expiredAt !== null,
			});
		}
		const c = snap.capture;
		const manifest: BundleManifest = {
			state: c?.state ?? "queued",
			reason: c?.stateReason ?? null,
			target: snap.target,
			identityMatches: c?.identityMatches ?? null,
			missed:
				c?.missedFrom && c.missedTo
					? { from: c.missedFrom.toISOString(), to: c.missedTo.toISOString() }
					: null,
			updatedAt: this.now().toISOString(),
			artifacts,
		};
		await writeAtomic(
			join(dir, "manifest.json"),
			`${JSON.stringify(manifest, null, 2)}\n`,
		);
		return snap;
	}

	/** The incident's newest linked capture with its artifacts, and the target it names (else the binding's). */
	private async load(incidentId: string): Promise<Snapshot> {
		const [link, incident] = await Promise.all([
			this.prisma.caseCapture.findFirst({
				where: { incidentId },
				orderBy: { capture: { createdAt: "desc" } },
				include: {
					capture: { include: { artifacts: { orderBy: { seq: "asc" } } } },
				},
			}),
			this.prisma.incident.findUnique({
				where: { id: incidentId },
				select: { service: { select: { binding: true } } },
			}),
		]);
		const capture = link?.capture ?? null;
		const from = capture ?? incident?.service?.binding;
		return {
			capture,
			target: {
				kubeContext: from?.kubeContext ?? "",
				namespace: from?.namespace ?? "",
			},
		};
	}

	private serial<T>(cwd: string, fn: () => Promise<T>): Promise<T> {
		const prev = this.chains.get(cwd) ?? Promise.resolve();
		const run = prev.then(fn);
		const settled = run.catch(() => undefined);
		this.chains.set(cwd, settled);
		void settled.then(() => {
			if (this.chains.get(cwd) === settled) this.chains.delete(cwd);
		});
		return run;
	}

	private register(incidentId: string, cwd: string): void {
		const dirs = this.registered.get(incidentId) ?? new Map<string, number>();
		dirs.set(cwd, this.now().getTime() + BUNDLE_TTL_MS);
		this.registered.set(incidentId, dirs);
	}

	private unregister(incidentId: string, cwd: string): void {
		const dirs = this.registered.get(incidentId);
		dirs?.delete(cwd);
		if (dirs?.size === 0) this.registered.delete(incidentId);
	}

	private prune(): void {
		const now = this.now().getTime();
		for (const [incidentId, dirs] of this.registered) {
			for (const [cwd, expiresAt] of dirs) {
				if (expiresAt <= now) dirs.delete(cwd);
			}
			if (dirs.size === 0) this.registered.delete(incidentId);
		}
	}
}
