// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { PreRunDetail, PreRunSource } from "@prismalens/contracts";
import { Link } from "@tanstack/react-router";
import {
	ChevronDown,
	CircleCheck,
	CircleDashed,
	CircleOff,
	CirclePause,
	TriangleAlert,
} from "lucide-react";
import { useState } from "react";
import {
	CredentialChip,
	KindIcon,
	kindLabel,
	StatePill,
	type Word,
} from "@/components/settings/source-words";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** A run detail's pre-run context that holds a snapshot: ready or not saved. */
export type PreRunRead = Exclude<PreRunDetail, { state: "unavailable" }>;

/** The snapshot of a run's pre-run context; null when there is none to show. */
export const preRunRead = (p: PreRunDetail | null | undefined) =>
	p && p.state !== "unavailable" ? p : null;

/** The run strip's snapshot step, in a few words. */
export function snapshotLine(p: PreRunDetail | null | undefined): string {
	const read = preRunRead(p);
	if (!read) return "No snapshot";
	const line = coverageLine(coverageCounts(read.sources));
	return read.state === "not-saved" ? `${line}, not saved` : line;
}

export interface CoverageCounts {
	found: number;
	empty: number;
	skipped: number;
	notRead: number;
	/** found + empty: both answered for the window (C6, OBJ-015). */
	read: number;
}

export function coverageCounts(
	sources: Pick<PreRunSource, "status">[],
): CoverageCounts {
	const n = (s: PreRunSource["status"]) =>
		sources.filter((x) => x.status === s).length;
	const found = n("found");
	const empty = n("empty");
	return {
		found,
		empty,
		skipped: n("skipped"),
		notRead: n("not-read"),
		read: found + empty,
	};
}

/** "2 read, 1 skipped", "5 read, 1 skipped, 2 not read", "0 read". */
export function coverageLine(c: CoverageCounts): string {
	return [
		`${c.read} read`,
		...(c.skipped ? [`${c.skipped} skipped`] : []),
		...(c.notRead ? [`${c.notRead} not read`] : []),
	].join(", ");
}

const RESULT: Record<PreRunSource["status"], Word> = {
	found: { text: "Data found", tone: "ok" },
	empty: { text: "Nothing in the window", tone: "neutral" },
	skipped: { text: "Skipped", tone: "warn" },
	"not-read": { text: "Not read", tone: "neutral" },
};

const CREDENTIAL: Record<string, string> = {
	stored: "Set in PrismaLens",
	env: "From environment",
	none: "Not set",
};

const SEGMENT = {
	found: "bg-ok",
	empty: "bg-text-3",
	skipped: "bg-warn",
	notRead:
		"bg-[repeating-linear-gradient(135deg,var(--text-3)_0_2px,transparent_2px_5px)]",
} as const;

/** The meter: one segment per result, never colour alone (the legend names each). */
function Meter({ c }: { c: CoverageCounts }) {
	const total = c.found + c.empty + c.skipped + c.notRead;
	if (!total) return null;
	return (
		<div className="flex h-2 gap-0.5 overflow-hidden rounded-full" aria-hidden>
			{(["found", "empty", "skipped", "notRead"] as const).map(
				(k) =>
					c[k] > 0 && (
						<span
							key={k}
							className={cn("h-full rounded-full", SEGMENT[k])}
							style={{ flexGrow: c[k] }}
						/>
					),
			)}
		</div>
	);
}

const LEGEND = [
	{ key: "found", label: "Data found", Icon: CircleCheck, tone: "text-ok" },
	{
		key: "empty",
		label: "Nothing in the window",
		Icon: CircleDashed,
		tone: "text-text-2",
	},
	{ key: "skipped", label: "Skipped", Icon: CirclePause, tone: "text-warn" },
	{ key: "notRead", label: "Not read", Icon: CircleOff, tone: "text-text-2" },
] as const;

/**
 * The report's coverage (#848): what PrismaLens read before the run, as
 * counts (read is data found plus nothing in the window) and one row per
 * source. Selection sentences, paths, the window and the counts dropped stay
 * in the report and the snapshot.
 */
export function PreRunCoverage({ preRun }: { preRun: PreRunDetail }) {
	if (preRun.state === "unavailable")
		return (
			<div className="flex flex-col gap-1" data-testid="coverage-unavailable">
				<p className="flex flex-wrap items-center gap-2">
					<b className="font-semibold">No snapshot for this run</b>
					<StatePill word={{ text: "No snapshot", tone: "neutral" }} />
				</p>
				<p className="text-text-2">
					This follow-up has no stored snapshot, so it ran without telemetry.
				</p>
			</div>
		);
	const sources = preRun.sources;
	const c = coverageCounts(sources);
	return (
		<div className="flex flex-col gap-3" data-testid="pre-run-coverage">
			{preRun.telemetrySkipped && (
				<p className="text-text-2" data-testid="coverage-telemetry-skipped">
					The telemetry read was skipped: {preRun.telemetrySkipped}
				</p>
			)}
			{preRun.state === "not-saved" && (
				<p
					className="flex items-start gap-2 rounded-surface bg-warn/10 px-2.5 py-2"
					data-testid="coverage-not-saved"
				>
					<TriangleAlert
						className="mt-0.5 size-4 shrink-0 text-warn"
						aria-hidden
					/>
					<span>
						<b className="font-semibold">Snapshot not saved.</b> This run read
						it; a follow-up will not have it.
					</span>
				</p>
			)}
			<div>
				<p className="flex items-baseline gap-2">
					<span
						className="text-[28px] leading-8 font-semibold tabular-nums"
						data-testid="coverage-read"
					>
						{c.read}
					</span>
					<span className="text-title font-normal text-text-2">
						{c.read === 1 ? "source" : "sources"} read before the run
					</span>
				</p>
				<p className="sr-only" data-testid="coverage-line">
					{coverageLine(c)}
				</p>
				{(c.skipped > 0 || c.notRead > 0) && (
					<p className="text-text-2" aria-hidden>
						{[
							...(c.skipped ? [`${c.skipped} skipped`] : []),
							...(c.notRead ? [`${c.notRead} not read`] : []),
						].join(" · ")}
					</p>
				)}
			</div>
			<Meter c={c} />
			<ul className="flex flex-wrap gap-x-4 gap-y-1 text-meta">
				{LEGEND.filter((l) => c[l.key] > 0).map(
					({ key, label, Icon, tone }) => (
						<li key={key} className="flex items-center gap-1.5">
							<Icon className={cn("size-3.5", tone)} aria-hidden />
							<span className="text-text-2">{label}</span>
							<b className="font-semibold tabular-nums">{c[key]}</b>
						</li>
					),
				)}
			</ul>
			{sources.length > 0 && (
				<ul
					className="flex flex-col divide-y divide-hairline"
					data-testid="coverage-sources"
				>
					{sources.map((s, i) => (
						<SourceResult
							// biome-ignore lint/suspicious/noArrayIndexKey: a snapshot's sources are fixed and positional.
							key={i}
							source={s}
						/>
					))}
				</ul>
			)}
			<Notes preRun={preRun} />
		</div>
	);
}

function SourceResult({ source: s }: { source: PreRunSource }) {
	const [open, setOpen] = useState(false);
	const word = RESULT[s.status];
	return (
		<li className="py-2" data-testid="coverage-source">
			<div className="flex items-start gap-2.5">
				<KindIcon kind={s.kind} small />
				<div className="min-w-0 flex-1">
					<p className="flex flex-wrap items-center gap-x-2 gap-y-1">
						<b className="font-semibold">{s.label}</b>
						{s.services?.length ? (
							<span className="text-text-2">{s.services.join(", ")}</span>
						) : null}
						<StatePill word={word} testId="coverage-result" />
					</p>
					<p className="text-meta text-text-2" dir="auto">
						{s.detail}
						{s.truncated ? " (truncated)" : ""}
					</p>
				</div>
				{s.status === "skipped" && (
					<Button variant="secondary" size="sm" asChild>
						<Link
							to="/settings"
							search={{ tab: "sources" }}
							data-testid="coverage-fix"
						>
							Fix
						</Link>
					</Button>
				)}
				<Button
					variant="text"
					size="icon-sm"
					aria-expanded={open}
					aria-label={`Details of ${s.label}`}
					onClick={() => setOpen(!open)}
				>
					<ChevronDown
						className={cn("size-4", open && "rotate-180")}
						aria-hidden
					/>
				</Button>
			</div>
			{open && (
				<dl className="mt-2 ml-8 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-meta">
					<dt className="text-text-3">Connection</dt>
					<dd>
						{s.label} · {kindLabel(s.kind)}
					</dd>
					<dt className="text-text-3">Deployment</dt>
					<dd>{s.deployment ?? "Any deployment"}</dd>
					<dt className="text-text-3">Credential</dt>
					<dd className="flex flex-wrap items-center gap-2">
						<CredentialChip
							text={CREDENTIAL[s.credentialFrom ?? "none"] ?? "Not set"}
						/>
						{s.overridesEnv && (
							<span className="text-text-2" data-testid="coverage-over">
								Over <code className="font-mono">{s.overridesEnv}</code>
							</span>
						)}
					</dd>
				</dl>
			)}
		</li>
	);
}

/** The kinds nothing serves. */
function Notes({ preRun }: { preRun: PreRunRead }) {
	const lines = preRun.notConfigured.map(
		(n) =>
			`No ${kindLabel(n.kind)} is set up for ${n.services.join(", ") || "this service"}.`,
	);
	if (!lines.length) return null;
	return (
		<ul className="text-meta text-text-3" data-testid="coverage-notes">
			{lines.map((l) => (
				<li key={l}>{l}</li>
			))}
		</ul>
	);
}
