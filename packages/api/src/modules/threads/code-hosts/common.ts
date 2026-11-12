// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * What every code-host adapter shares (#1122): the conditional GET, the bounded
 * readers of host JSON, check tallies and log tails. Nothing here names a host.
 */
import type {
	PrCheckRun,
	PrChecks,
	PrDetail,
	PrPerson,
	PrReview,
	PrState,
} from "@prismalens/contracts";
import { NO_CHECKS, PR_CHECK_RUNS_MAX } from "@prismalens/contracts";
import type { AuthenticatedRequestFn } from "@prismalens/integrations";
import { TRUNCATED_HEADER } from "../../integrations/source-request.js";

export interface HostRead {
	title: string | null;
	state: PrState;
	review: PrReview;
	checks: PrChecks;
	conflicts: boolean | null;
	detail: PrDetail;
	/** The head commit, its branch and repository, and the branch it merges into. */
	headSha: string | null;
	headRef: string | null;
	headRepo: string | null;
	baseRef: string | null;
}

/** Per request path: the host's ETag and what PrismaLens read from that answer. */
export type EtagCache = Record<string, { etag: string; value: unknown }>;

/** The host refused or failed; the message is PrismaLens's own, never the host's text. */
export class HostReadError extends Error {
	constructor(
		message: string,
		readonly status?: number,
	) {
		super(message);
		this.name = "HostReadError";
	}
}

/** One conditional GET: a 304 hands back what the earlier answer was read as. */
export async function cachedGet<T>(
	req: AuthenticatedRequestFn,
	path: string,
	cache: EtagCache,
	read: (body: unknown) => T,
): Promise<T> {
	const prior = cache[path];
	const res = await req("GET", path, {
		headers: {
			Accept: "application/json",
			...(prior ? { "If-None-Match": prior.etag } : {}),
		},
	});
	if (res.status === 304 && prior) return prior.value as T;
	if (!res.ok) {
		await res.body?.cancel();
		throw new HostReadError(`the git host answered ${res.status}`, res.status);
	}
	if (res.headers.get(TRUNCATED_HEADER))
		throw new HostReadError("the git host's answer was over 1 MB");
	let body: unknown;
	try {
		body = await res.json();
	} catch {
		throw new HostReadError("the git host's answer was not JSON");
	}
	const value = read(body);
	const etag = res.headers.get("etag");
	if (etag) cache[path] = { etag, value };
	else delete cache[path];
	return value;
}

export const obj = (v: unknown): Record<string, unknown> =>
	v && typeof v === "object" && !Array.isArray(v)
		? (v as Record<string, unknown>)
		: {};
export const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
export const str = (v: unknown): string | null =>
	typeof v === "string" ? v : null;

/** Email-hash avatar services: loading one sends a commit email's hash to a third party (#1024 decision 11). */
const EMAIL_HASH_HOSTS = /(^|\.)(gravatar\.com|libravatar\.org)$/i;

/** An https image URL the host's API named; anything else, or an email-hash avatar, is dropped. */
export function imageUrl(v: unknown): string | undefined {
	const s = str(v);
	if (!s || s.length > 2000) return undefined;
	try {
		const u = new URL(s);
		return u.protocol === "https:" && !EMAIL_HASH_HOSTS.test(u.hostname)
			? s
			: undefined;
	} catch {
		return undefined;
	}
}

export function person(login: unknown, avatar: unknown): PrPerson | undefined {
	const name = str(login);
	if (!name) return undefined;
	const avatarUrl = imageUrl(avatar);
	return { login: name.slice(0, 200), ...(avatarUrl ? { avatarUrl } : {}) };
}

export const isPerson = (p: PrPerson | undefined): p is PrPerson => !!p;

export function branchPair(
	head: string | null,
	base: string | null,
): Pick<PrDetail, "headRef" | "baseRef"> {
	return {
		...(head ? { headRef: head.slice(0, 300) } : {}),
		...(base ? { baseRef: base.slice(0, 300) } : {}),
	};
}

export interface ChecksRead {
	checks: PrChecks;
	runs: PrCheckRun[];
}

/** Summary counts cover every run; only the first PR_CHECK_RUNS_MAX are kept by name. */
export function tally(runs: PrCheckRun[]): ChecksRead {
	if (!runs.length) return { checks: NO_CHECKS, runs: [] };
	const failed = runs.filter((r) => r.state === "failing").length;
	const pending = runs.filter((r) => r.state === "pending").length;
	return {
		checks: {
			state: failed ? "failing" : pending ? "pending" : "passing",
			total: runs.length,
			failed,
			pending,
		},
		runs: runs.slice(0, PR_CHECK_RUNS_MAX),
	};
}

export type RunIdentity = Partial<
	Pick<PrCheckRun, "id" | "appId" | "headSha">
> & {
	url?: string | null;
};

export const idOf = (v: unknown): string | undefined =>
	typeof v === "number" || (typeof v === "string" && v)
		? String(v).slice(0, 100)
		: undefined;

/** An http(s) link the host gave for a check's log; anything else is dropped. */
export function linkOf(v: unknown): string | undefined {
	const s = str(v);
	if (!s || s.length > 2000) return undefined;
	try {
		const u = new URL(s);
		return u.protocol === "https:" || u.protocol === "http:" ? s : undefined;
	} catch {
		return undefined;
	}
}

export function run(
	name: string | null,
	state: PrCheckRun["state"],
	appName?: string | null,
	appAvatarUrl?: string,
	identity: RunIdentity = {},
): PrCheckRun {
	const url = linkOf(identity.url);
	return {
		name: (name ?? "check").slice(0, 300),
		state,
		...(appName ? { appName: appName.slice(0, 200) } : {}),
		...(appAvatarUrl ? { appAvatarUrl } : {}),
		...(identity.id ? { id: identity.id } : {}),
		...(identity.appId ? { appId: identity.appId } : {}),
		...(identity.headSha ? { headSha: identity.headSha.slice(0, 64) } : {}),
		...(url ? { url } : {}),
	};
}

export type SourceRead =
	| { kind: "ok"; value: ChecksRead }
	| { kind: "absent" }
	| { kind: "failed" };

/** 403 and 404 mean the token may not read that source; any other error means its answer is unknown. */
export async function readable(
	read: () => Promise<ChecksRead>,
): Promise<SourceRead> {
	try {
		return { kind: "ok", value: await read() };
	} catch (e) {
		if (e instanceof HostReadError && (e.status === 403 || e.status === 404))
			return { kind: "absent" };
		return { kind: "failed" };
	}
}

/**
 * Both sources' counts summed, so a failure or a pending result in either one shows.
 * A known failure stays failing; a source that failed, or one that is absent beside a
 * result that would read passing or none, makes the checks unknown.
 */
export function merged(...reads: SourceRead[]): ChecksRead {
	const got = reads.flatMap((r) => (r.kind === "ok" ? [r.value] : []));
	const sum = (k: "total" | "failed" | "pending") =>
		got.reduce((n, r) => n + r.checks[k], 0);
	const total = sum("total");
	const failed = sum("failed");
	const pending = sum("pending");
	const runs = got.flatMap((r) => r.runs).slice(0, PR_CHECK_RUNS_MAX);
	const state: PrChecks["state"] = failed
		? "failing"
		: reads.some((r) => r.kind === "failed")
			? "unknown"
			: pending
				? "pending"
				: reads.some((r) => r.kind === "absent")
					? "unknown"
					: total
						? "passing"
						: "none";
	return { checks: { state, total, failed, pending }, runs };
}

/** A review or comment on a PR, by the host's id, as the PR status feed reads it (#1024 surface F). */
export interface PrActivityItem {
	/** Which of the host's id sequences `id` belongs to: ids only compare within one source. */
	source: string;
	id: number;
	login: string;
	bot: boolean;
	/** A review's verdict; absent on a comment. */
	verdict?: "approved" | "changes_requested" | "commented";
	body: string;
}

const numId = (v: unknown): number | null =>
	typeof v === "number" && Number.isSafeInteger(v) ? v : null;

export function items(
	body: unknown,
	source: PrActivityItem["source"],
	who: (o: Record<string, unknown>) => { login: string | null; bot: boolean },
	verdict?: (o: Record<string, unknown>) => PrActivityItem["verdict"] | null,
): PrActivityItem[] {
	const out: PrActivityItem[] = [];
	for (const raw of arr(body)) {
		const o = obj(raw);
		const id = numId(o.id);
		const { login, bot } = who(o);
		if (id === null || !login) continue;
		const v = verdict?.(o);
		if (v === null) continue;
		out.push({
			source,
			id,
			login: login.slice(0, 200),
			bot,
			...(v ? { verdict: v } : {}),
			body: (str(o.body) ?? "").slice(0, 2000),
		});
	}
	return out;
}

/** A review comment's opening, for the panel's excerpt. */
export function excerptOf(body: string | null): string {
	return (body ?? "").replace(/\r\n/g, "\n").trim().slice(0, 600);
}

export async function jsonOf(res: Response): Promise<unknown> {
	if (!res.ok) {
		await res.body?.cancel();
		throw new HostReadError(`the git host answered ${res.status}`, res.status);
	}
	try {
		return await res.json();
	} catch {
		throw new HostReadError("the git host's answer was not JSON");
	}
}

/** What a check's log read found: its failing step and last lines, or why there are none. */
export interface CheckLogRead {
	step: string | null;
	lines: string[];
	unavailable: string | null;
}

/** Lines a log tail keeps, ending at the last error line when the log marks one. */
export const LOG_TAIL_LINES = 40;
/** Bytes read of a log before giving up on reaching its end, and bytes kept of what was read. */
const LOG_SCAN_BYTES = 8 * 1024 * 1024;
const LOG_KEEP_BYTES = 64 * 1024;

// The runner's timestamp, colour codes and GitLab's section markers.
const ESC = String.fromCharCode(27);
const LOG_NOISE = new RegExp(
	String.raw`^\d{4}-\d\d-\d\dT[\d:.]+Z ?|${ESC}\[[0-9;]*[A-Za-z]|section_(start|end):\d+:[\w.-]+\r?`,
	"g",
);

/** The last lines of a log, cleaned, ending a few lines after its last error mark. */
export function logTail(text: string, n = LOG_TAIL_LINES): string[] {
	const lines = text
		.replace(/\r\n?/g, "\n")
		.split("\n")
		.map((l) => l.replace(LOG_NOISE, "").trimEnd())
		.filter((l) => l && !/^##\[(end)?group\]/.test(l));
	let end = lines.length;
	for (let i = lines.length - 1; i >= 0; i--)
		if (/^##\[error\]|^ERROR:/.test(lines[i] ?? "")) {
			end = Math.min(i + 3, lines.length);
			break;
		}
	return lines.slice(Math.max(0, end - n), end).map((l) => l.slice(0, 400));
}

/** A log body's end: reads at most LOG_SCAN_BYTES and keeps the last LOG_KEEP_BYTES of them. */
export async function readLogEnd(res: Response): Promise<string> {
	if (!res.body) return "";
	const reader = res.body.getReader();
	const kept: Uint8Array[] = [];
	let keptBytes = 0;
	let read = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done || !value) break;
		read += value.byteLength;
		kept.push(value);
		keptBytes += value.byteLength;
		while (
			kept.length > 1 &&
			keptBytes - (kept[0]?.byteLength ?? 0) >= LOG_KEEP_BYTES
		)
			keptBytes -= kept.shift()?.byteLength ?? 0;
		if (read >= LOG_SCAN_BYTES) {
			await reader.cancel();
			break;
		}
	}
	return new TextDecoder().decode(Buffer.concat(kept));
}

/** Plain reasons a log cannot be shown (#1101 category 15). */
export const LOG_UNAVAILABLE = {
	noAccess:
		"The git host gives logs only to a signed-in reader with access to its CI; this repository's token cannot read them.",
	gone: "The git host no longer keeps this log.",
	status:
		"This check is a commit status; its log is only on the check's own page.",
	none: "This check posts no log PrismaLens can read; open its page.",
	host: "The git host did not answer; try again in a minute.",
} as const;

/** How the API answers a log request: a redirect to the file, or a refusal. */
export type LogLocate = (
	path: string,
) => Promise<{ status: number; location: string | null }>;

/** The first item's web URL from a host's list answer; null when it has none or the host refused. */
export async function firstWebUrl(
	req: AuthenticatedRequestFn,
	path: string,
	field: string,
): Promise<string | null> {
	const res = await req("GET", path, {
		headers: { Accept: "application/json" },
	});
	if (!res.ok) {
		await res.body?.cancel();
		return null;
	}
	const list = (await res.json().catch(() => [])) as unknown;
	const url = obj(arr(list)[0])[field];
	return typeof url === "string" ? url : null;
}
