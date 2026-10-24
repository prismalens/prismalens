// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Settings, Sources in words (#848): one state per thing, one credential chip,
 * and at most one note. The API names the facts (`problem`, `credential`); the
 * resolution behind them stays in the report and `pl doctor`.
 */
import {
	type GitHostView,
	type SourceRow,
	sourceType,
} from "@prismalens/contracts/schemas";
import {
	Bell,
	ChartLine,
	CircleCheck,
	CircleDashed,
	CircleMinus,
	CircleX,
	GitBranch,
	Link2,
	Lock,
	Logs,
	SquareTerminal,
	TriangleAlert,
} from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type WordTone = "ok" | "warn" | "danger" | "neutral";
export interface Word {
	text: string;
	tone: WordTone;
}

const CONNECTED: Word = { text: "Connected", tone: "ok" };
const UNTESTED: Word = { text: "Not tested yet", tone: "neutral" };

/** A telemetry connection's one state word, from what the API derived (C17 table). */
export function sourceState(
	row: Pick<SourceRow, "status" | "testedAt" | "problem">,
): Word {
	if (row.problem === "credential-refused")
		return { text: "Credential refused", tone: "warn" };
	if (row.problem === "cant-reach")
		return { text: "Can't reach", tone: "warn" };
	if (row.problem === "needs-credential")
		return { text: "Needs a credential", tone: "warn" };
	if (row.status === "TOKEN_EXPIRED") return { text: "Expired", tone: "warn" };
	if (row.status === "ACTIVE") return row.testedAt ? CONNECTED : UNTESTED;
	if (row.status === "ERROR") return { text: "Problem", tone: "warn" };
	return UNTESTED;
}

/** A stored git token's state; "Not tested yet" until a Test passes (OBJ-007). */
export function tokenState(t: {
	status: string;
	testedAt: string | null;
}): Word {
	if (t.status === "CREDENTIALS_INVALID" || t.status === "REFRESH_FAILED")
		return { text: "Credential refused", tone: "warn" };
	if (t.status === "TOKEN_EXPIRED") return { text: "Expired", tone: "warn" };
	if (t.status === "ERROR") return { text: "Problem", tone: "warn" };
	return t.testedAt ? CONNECTED : UNTESTED;
}

/** A git host's state: its ambiguity first, then its tokens; none when nothing is set. */
export function hostState(h: GitHostView): Word | null {
	if (h.ambiguous) return { text: "Pick a token", tone: "warn" };
	if (h.stored.length) {
		const words = h.stored.map(tokenState);
		return (
			words.find((w) => w.tone === "ok") ??
			words.find((w) => w.tone === "warn") ??
			UNTESTED
		);
	}
	return h.env ? UNTESTED : null;
}

export type CredentialWord =
	| "Set in PrismaLens"
	| "No credential"
	| "From environment"
	| "Not set";

export function credentialWord(
	row: Pick<SourceRow, "credential" | "credentialKind">,
): CredentialWord {
	if (row.credential === "stored")
		return row.credentialKind === "none"
			? "No credential"
			: "Set in PrismaLens";
	return row.credential === "env" ? "From environment" : "Not set";
}

export function hostCredentialWord(h: GitHostView): string {
	if (h.stored.length)
		return `${h.stored.length} ${h.stored.length === 1 ? "token" : "tokens"} stored`;
	return h.env ? "From environment" : "Not set";
}

export const KIND_LABEL: Record<string, string> = {
	prometheus: "Prometheus",
	alertmanager: "Alertmanager",
	loki: "Loki",
};

export const kindLabel = (kind: string) =>
	KIND_LABEL[kind] ?? sourceType(kind)?.vendor ?? kind;

/** The vendor a git host belongs to, for its second line. */
export function hostVendor(host: string): string {
	const h = host.toLowerCase();
	if (h === "github.com") return "GitHub";
	if (h === "gitlab.com") return "GitLab";
	if (h === "bitbucket.org") return "Bitbucket";
	return "Git host";
}

/** `host[:port]` of an address, for display. */
export function hostOf(url: string | null | undefined): string {
	if (!url) return "";
	try {
		return new URL(url).host;
	} catch {
		return url;
	}
}

const TONE_CLASS: Record<WordTone, string> = {
	ok: "bg-ok/12 text-ok",
	warn: "bg-warn/12 text-warn",
	danger: "bg-danger/12 text-danger",
	neutral: "bg-text-2/10 text-text-2",
};

const TONE_ICON: Record<WordTone, typeof CircleCheck> = {
	ok: CircleCheck,
	warn: TriangleAlert,
	danger: CircleX,
	neutral: CircleDashed,
};

/** A state: icon, word and colour together, never colour alone. */
export function StatePill({
	word,
	className,
	testId,
}: {
	word: Word;
	className?: string;
	testId?: string;
}) {
	const Icon = TONE_ICON[word.tone];
	return (
		<span
			className={cn(
				"inline-flex h-5 shrink-0 items-center gap-1 rounded-full pr-[7px] pl-[5px] text-meta font-medium whitespace-nowrap",
				TONE_CLASS[word.tone],
				className,
			)}
			data-tone={word.tone}
			data-testid={testId}
		>
			<Icon className="size-[13px] stroke-2" aria-hidden />
			{word.text}
		</span>
	);
}

const CRED_ICON: Record<string, typeof Lock> = {
	"Set in PrismaLens": Lock,
	"No credential": CircleMinus,
	"From environment": SquareTerminal,
	"Not set": CircleDashed,
};

/** The credential chip; "Not set" is the one drawn as an outline, the rest as a fill. */
export function CredentialChip({
	text,
	testId,
}: {
	text: string;
	testId?: string;
}) {
	const Icon = text.endsWith("stored") ? Lock : (CRED_ICON[text] ?? Lock);
	const ghost = text === "Not set";
	return (
		<span
			className={cn(
				"inline-flex h-[22px] max-w-full shrink-0 items-center gap-1.5 rounded-control px-2 text-meta whitespace-nowrap",
				ghost
					? "text-text-2 outline-1 -outline-offset-1 outline-text-3/60"
					: "bg-surface-3 text-text-1",
			)}
			data-testid={testId}
		>
			<Icon className="size-[13px] text-text-2" aria-hidden />
			<span className="truncate">{text}</span>
		</span>
	);
}

/** "Overrides PROMETHEUS_TOKEN": a stored credential wins over the shell's (C5). */
export function OverridesNote({ variable }: { variable: string }) {
	return (
		<span
			className="inline-flex items-center gap-1 text-meta text-text-2"
			data-testid="source-overrides"
		>
			Overrides
			<code className="rounded-[4px] bg-surface-3 px-1 font-mono text-mono text-text-1">
				{variable}
			</code>
		</span>
	);
}

/** One connection, two pages: the note both carry (#848). */
export function AlsoInNote({ page }: { page: "Alert intake" | "Sources" }) {
	return (
		<span
			className="inline-flex items-center gap-1 text-meta text-text-2"
			data-testid="source-also-in"
		>
			<Link2 className="size-3" aria-hidden />
			Also in {page}; editing it changes both
		</span>
	);
}

const KIND_ICON: Record<string, typeof Bell> = {
	prometheus: ChartLine,
	alertmanager: Bell,
	loki: Logs,
};

/** The kind's icon in its well; git hosts share one. */
export function KindIcon({
	kind,
	small,
	className,
}: {
	kind: string;
	small?: boolean;
	className?: string;
}): ReactNode {
	const Icon = KIND_ICON[kind] ?? GitBranch;
	return (
		<span
			aria-hidden
			className={cn(
				"grid shrink-0 place-items-center bg-well-in-pool text-text-2",
				small ? "size-6 rounded-control" : "size-8 rounded-[9px]",
				className,
			)}
		>
			<Icon className={small ? "size-3.5" : "size-4"} />
		</span>
	);
}
