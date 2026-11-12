// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { AccessLevel } from "@prismalens/config/harness";
import {
	ACCESS_LEVEL_LABEL,
	type AskAnswer,
	type AskQuestion,
	type ElicitField,
	type PendingAsk,
} from "@prismalens/contracts";
import { Check, ChevronLeft, ChevronRight, X } from "lucide-react";
import { type FormEvent, type ReactNode, useEffect, useState } from "react";
import { Help } from "@/components/kit";
import { Hint } from "@/components/shared/Hint";
import { Kbd } from "@/components/shell/RowAsk";
import { Button } from "@/components/ui/button";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { useAskKeys } from "@/hooks/use-ask-keys";
import { useOperator } from "@/hooks/use-operator";
import {
	useAnswerAsk,
	useAnswerSecret,
} from "@/lib/api/hooks/use-investigations-orpc";
import { alwaysLine, askSubject, whyAsked } from "@/lib/ask-lines";
import { askRefusal } from "@/lib/ask-refusal";
import { getErrorMessage } from "@/lib/get-error-message";
import { toolTitle } from "@/lib/tool-title";
import { cn } from "@/lib/utils";

/**
 * The legacy permission asks the run dock already shows (#1090): their projection
 * offers no options. Every other open ask docks here.
 */
export const docksHere = (a: PendingAsk) =>
	!(a.kind === "permission" && (a.permission?.options.length ?? 0) === 0);

const who = (a: PendingAsk, agent: string) =>
	a.source.kind === "subagent" ? a.source.title : agent;

const field =
	"h-8 w-full rounded-control bg-surface-4 px-2.5 text-body text-text-1 outline-none focus-visible:ring-2 focus-visible:ring-accent/60";

/**
 * The agent's open asks, docked at the box (#1024): one card at a time, oldest first,
 * paged "1 of 3". Esc hides the cards and returns to the draft; nothing is answered.
 */
export function AskDock({
	asks,
	threadId,
	agent,
	focusAskId,
	ended = false,
	accessLevel = null,
	hostOnlyRun,
	onHost: onHostFixed,
}: {
	/** The run is not live: only a PrismaLens tool's ask still takes an answer (#1101 cat 8 item 5). */
	ended?: boolean;
	/** The thread's mode, shown on the card (#1101 cat 8 item 7). */
	accessLevel?: AccessLevel | null;
	asks: readonly PendingAsk[];
	threadId: string;
	agent: string;
	/** `?ask=<id>`: the card a link or push landed on. */
	focusAskId?: string | null;
	/** A run PrismaLens started: only the host answers its asks. */
	hostOnlyRun?: boolean;
	/** Fixtures only: whether this browser is the host, in place of asking the API. */
	onHost?: boolean;
}) {
	const list = [...asks].sort((a, b) => a.openedAt.localeCompare(b.openedAt));
	// The host's own session may answer an ask only it can; any other browser is pointed there.
	const operator = useOperator();
	const onHost = onHostFixed ?? operator.managesPairing;
	const [at, setAt] = useState(0);
	const [hidden, setHidden] = useState(false);
	const focusAt = focusAskId
		? list.findIndex((a) => a.askId === focusAskId)
		: -1;
	useEffect(() => {
		if (focusAt < 0) return;
		setAt(focusAt);
		setHidden(false);
	}, [focusAt]);
	const i = Math.min(at, list.length - 1);
	const ask = list[i];
	if (!ask) return null;
	const refusal = askRefusal(ask, onHost, hostOnlyRun);
	const subject = askSubject(ask);
	const inert = ended && ask.source.kind !== "tool";
	if (hidden)
		return (
			<div
				className="flex items-center gap-2 text-meta text-text-2"
				data-testid="ask-dock-hidden"
			>
				{list.length === 1 ? "1 question waits" : `${list.length} asks wait`}
				<Button variant="text" size="sm" onClick={() => setHidden(false)}>
					Show
				</Button>
			</div>
		);
	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: Esc anywhere in the card returns to the draft.
		<section
			aria-label={`${who(ask, agent)} asks`}
			className="flex flex-col gap-1.5 max-md:[&_button]:min-h-11 max-md:[&_button]:min-w-11 max-md:[&_input]:h-11"
			data-testid="ask-dock"
			data-kind={ask.kind}
			onKeyDown={(e) => {
				if (e.key === "Escape") {
					e.stopPropagation();
					setHidden(true);
				}
			}}
		>
			{/* The ask is the box's top line (#1105): its words, then ?, the pager and hide. */}
			<header className="flex items-start gap-2">
				<p
					className="min-w-0 flex-1 pt-0.5 text-body text-text-1"
					data-testid="ask-dock-title"
				>
					{ask.source.kind === "subagent" && (
						<span className="text-text-3" data-testid="ask-dock-who">
							{who(ask, agent)} ·{" "}
						</span>
					)}
					{toolTitle(ask.title)}
				</p>
				<span className="flex shrink-0 items-center gap-0.5 text-meta text-text-3">
					<span data-testid="ask-dock-why">
						<Help
							about="Why this asks"
							text={whyAsked(ask, accessLevel)}
							{...(accessLevel
								? { more: `Mode: ${ACCESS_LEVEL_LABEL[accessLevel]}.` }
								: {})}
						/>
					</span>
					{list.length > 1 && (
						<>
							<Button
								variant="ghost"
								size="icon-sm"
								aria-label="Previous ask"
								disabled={i === 0}
								onClick={() => setAt(i - 1)}
							>
								<ChevronLeft />
							</Button>
							<span className="tabular-nums" data-testid="ask-dock-page">
								{i + 1}/{list.length}
							</span>
							<Button
								variant="ghost"
								size="icon-sm"
								aria-label="Next ask"
								disabled={i === list.length - 1}
								onClick={() => setAt(i + 1)}
							>
								<ChevronRight />
							</Button>
						</>
					)}
					<Hint label="Reply instead (Esc)">
						<Button
							variant="ghost"
							size="icon-sm"
							aria-label="Reply instead"
							onClick={() => setHidden(true)}
							data-testid="ask-dock-reply"
						>
							<X />
						</Button>
					</Hint>
				</span>
			</header>
			{subject && (
				// The exact command or path, whole: never an Approve without it (#1101 cat 8 item 2).
				<code
					className="block max-h-36 overflow-y-auto rounded-control bg-surface-3 px-2.5 py-1.5 font-mono text-meta whitespace-pre-wrap break-all text-text-1"
					data-testid="ask-dock-subject"
				>
					{subject}
				</code>
			)}
			{inert ? (
				<p className="text-meta text-text-2" data-testid="ask-dock-ended">
					Ended with its run; nothing to answer
				</p>
			) : (
				<>
					{refusal && (
						<div
							role="note"
							className="flex flex-col gap-0.5 rounded-control bg-surface-3 px-2.5 py-1.5"
							data-testid="ask-dock-host"
						>
							<p className="text-meta text-text-1">{refusal.text}</p>
						</div>
					)}
					{/* Refused, the buttons stay in view and inert, so the card shows what it asks of the host. */}
					<AskBody
						key={ask.askId}
						ask={ask}
						threadId={threadId}
						locked={!!refusal}
					/>
				</>
			)}
		</section>
	);
}

function AskBody({
	ask,
	threadId,
	locked = false,
}: {
	ask: PendingAsk;
	threadId: string;
	locked?: boolean;
}) {
	const answer = useAnswerAsk();
	const secret = useAnswerSecret();
	const [error, setError] = useState<string | null>(null);
	const busy = locked || answer.isPending || secret.isPending;
	const send = (a: AskAnswer) => {
		setError(null);
		answer.mutate(
			{ id: threadId, askId: ask.askId, answer: a },
			{ onError: (e) => setError(getErrorMessage(e)) },
		);
	};
	let body: ReactNode = null;
	if (ask.kind === "permission")
		body = <Approval ask={ask} busy={busy} onAnswer={send} />;
	else if (ask.kind === "question" && ask.questions)
		body = <Questions questions={ask.questions} busy={busy} onAnswer={send} />;
	else if (ask.kind === "input" && ask.input)
		body = (
			<InputForm
				fields={ask.input.schema.properties}
				required={ask.input.schema.required ?? []}
				busy={busy}
				onAnswer={send}
			/>
		);
	else if (ask.kind === "secret")
		body = (
			<SecretForm
				busy={busy}
				onSecret={(value) => {
					setError(null);
					secret.mutate(
						{ id: threadId, requestId: ask.askId, value },
						{ onError: (e) => setError(getErrorMessage(e)) },
					);
				}}
			/>
		);
	const skip =
		ask.kind !== "secret" ? (
			<Button
				variant="text"
				size="sm"
				disabled={busy}
				onClick={() => send({ kind: "decline" })}
				data-testid="ask-dock-decline"
			>
				Skip
			</Button>
		) : null;
	return (
		<>
			<div className="flex flex-wrap items-end justify-between gap-x-2 gap-y-1.5">
				<div className="min-w-0 flex-1">{body}</div>
				{skip}
			</div>
			{error && (
				<p className="text-meta text-danger" role="alert">
					{error}
				</p>
			)}
		</>
	);
}

function Approval({
	ask,
	busy,
	onAnswer,
}: {
	ask: PendingAsk;
	busy: boolean;
	onAnswer: (a: AskAnswer) => void;
}) {
	const [reason, setReason] = useState<string | null>(null);
	const plan = ask.permission?.variant === "plan";
	useAskKeys(reason === null && !busy, {
		approve: () =>
			onAnswer({ kind: "permission", decision: "approve", scope: "once" }),
		decline: () => onAnswer({ kind: "permission", decision: "deny" }),
	});
	const always = alwaysLine(ask);
	if (reason !== null)
		return (
			<form
				className="flex items-center gap-2"
				onSubmit={(e) => {
					e.preventDefault();
					onAnswer({
						kind: "permission",
						decision: "deny",
						...(reason.trim() ? { reason: reason.trim() } : {}),
					});
				}}
			>
				<input
					// biome-ignore lint/a11y/noAutofocus: the reason is the one thing to type.
					autoFocus
					aria-label="Reason"
					className={field}
					value={reason}
					onChange={(e) => setReason(e.target.value)}
					data-testid="ask-dock-reason"
				/>
				<Button type="submit" variant="secondary" disabled={busy}>
					Deny
				</Button>
			</form>
		);
	return (
		<div className="flex flex-wrap items-center gap-1.5">
			<Button
				disabled={busy}
				onClick={() =>
					onAnswer({ kind: "permission", decision: "approve", scope: "once" })
				}
				aria-keyshortcuts="Alt+Y"
				data-testid="ask-dock-allow"
			>
				{plan ? "Approve" : "Allow once"} <Kbd>Alt Y</Kbd>
			</Button>
			{!plan && ask.permission?.identity && (
				<Hint label={always ?? "Always allow this in this thread"}>
					<Button
						variant="secondary"
						disabled={busy}
						onClick={() =>
							onAnswer({
								kind: "permission",
								decision: "approve",
								scope: "always",
							})
						}
						data-testid="ask-dock-always"
					>
						Always
					</Button>
				</Hint>
			)}
			<Button
				variant="secondary"
				disabled={busy}
				onClick={() => onAnswer({ kind: "permission", decision: "deny" })}
				aria-keyshortcuts="Alt+N"
				data-testid="ask-dock-deny"
			>
				{plan ? "Keep planning" : "Deny"} <Kbd>Alt N</Kbd>
			</Button>
			{!plan && (
				<Button
					variant="text"
					size="sm"
					disabled={busy}
					onClick={() => setReason("")}
					data-testid="ask-dock-deny-reason"
				>
					Deny with a reason
				</Button>
			)}
		</div>
	);
}

type Picks = Record<string, { options: string[]; other: string | null }>;

function Questions({
	questions,
	busy,
	onAnswer,
}: {
	questions: AskQuestion[];
	busy: boolean;
	onAnswer: (a: AskAnswer) => void;
}) {
	const [picks, setPicks] = useState<Picks>({});
	const toggle = (q: AskQuestion, id: string) =>
		setPicks((p) => {
			const now = p[q.id] ?? { options: [], other: null };
			const options = q.multiSelect
				? now.options.includes(id)
					? now.options.filter((o) => o !== id)
					: [...now.options, id]
				: [id];
			return {
				...p,
				[q.id]: { options, other: q.multiSelect ? now.other : null },
			};
		});
	const single = questions.length === 1 && !questions[0]?.multiSelect;
	const submit = (p: Picks) =>
		onAnswer({
			kind: "question",
			answers: Object.fromEntries(
				questions.map((q) => {
					const a = p[q.id] ?? { options: [], other: null };
					return [
						q.id,
						{
							options: a.options,
							...(a.other?.trim() ? { other: a.other.trim() } : {}),
						},
					];
				}),
			),
		});
	const ready = questions.every(
		(q) =>
			!q.required ||
			(picks[q.id]?.options.length ?? 0) > 0 ||
			!!picks[q.id]?.other?.trim(),
	);
	// Keys 1 to 9 pick the first question's options while focus is not in a text field.
	useEffect(() => {
		const q = questions[0];
		if (!q) return;
		const onKey = (e: KeyboardEvent) => {
			const t = e.target as HTMLElement | null;
			if (t?.closest("input, textarea, [contenteditable]")) return;
			const n = Number(e.key);
			const opt = Number.isInteger(n) && n >= 1 ? q.options[n - 1] : undefined;
			if (!opt || busy) return;
			e.preventDefault();
			if (single) submit({ [q.id]: { options: [opt.id], other: null } });
			else toggle(q, opt.id);
		};
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	});
	return (
		<div className="flex flex-col gap-1.5">
			{questions.map((q) => (
				<fieldset
					key={q.id}
					className="flex flex-col gap-0.5"
					data-testid="ask-dock-question"
				>
					{questions.length > 1 && (
						<legend className="text-meta text-text-2">{q.prompt}</legend>
					)}
					{q.options.map((o, n) => {
						const on = picks[q.id]?.options.includes(o.id) ?? false;
						return (
							<button
								key={o.id}
								type="button"
								disabled={busy}
								aria-pressed={on}
								onClick={() =>
									single
										? submit({ [q.id]: { options: [o.id], other: null } })
										: toggle(q, o.id)
								}
								aria-keyshortcuts={n < 9 ? String(n + 1) : undefined}
								className={cn(
									"flex min-h-7 items-center gap-2 rounded-control px-1.5 py-0.5 text-left text-body text-text-1 hover:bg-surface-4 focus-visible:ring-1 focus-visible:ring-accent",
									on && "bg-surface-4",
								)}
								data-testid="ask-dock-option"
							>
								{q.multiSelect ? (
									<span
										aria-hidden
										className={cn(
											"grid size-3.5 shrink-0 place-items-center rounded-[3px] border-[1.5px] border-text-2",
											on && "border-accent bg-accent text-canvas",
										)}
									>
										{on && <Check className="size-2.5 stroke-[3]" />}
									</span>
								) : (
									<span
										aria-hidden
										className={cn(
											"grid size-3.5 shrink-0 place-items-center rounded-full border-[1.5px] border-text-2",
											on && "border-accent",
										)}
									>
										{on && <span className="size-1.5 rounded-full bg-accent" />}
									</span>
								)}
								<span>{o.label}</span>
								{o.description && (
									<span className="min-w-0 truncate text-meta text-text-3">
										{o.description}
									</span>
								)}
							</button>
						);
					})}
					{/* A typed answer goes in the box itself; Send answers this question (#1105). */}
					{q.allowOther && questions.length > 1 && (
						<input
							aria-label="Other"
							placeholder="Other"
							className={field}
							value={picks[q.id]?.other ?? ""}
							onChange={(e) =>
								setPicks((p) => ({
									...p,
									[q.id]: {
										options: q.multiSelect ? (p[q.id]?.options ?? []) : [],
										other: e.target.value,
									},
								}))
							}
							data-testid="ask-dock-other"
						/>
					)}
				</fieldset>
			))}
			{!single ||
			(questions.length > 1 && questions.some((q) => q.allowOther)) ? (
				<Button
					className="self-start"
					disabled={busy || !ready}
					onClick={() => submit(picks)}
					data-testid="ask-dock-submit"
				>
					Answer
				</Button>
			) : null}
		</div>
	);
}

function InputForm({
	fields,
	required,
	busy,
	onAnswer,
}: {
	fields: Record<string, ElicitField>;
	required: string[];
	busy: boolean;
	onAnswer: (a: AskAnswer) => void;
}) {
	const [values, setValues] = useState<
		Record<string, string | number | boolean>
	>(() =>
		Object.fromEntries(
			Object.entries(fields).flatMap(([k, f]) =>
				f.default !== undefined ? [[k, f.default]] : [],
			),
		),
	);
	const onSubmit = (e: FormEvent) => {
		e.preventDefault();
		onAnswer({ kind: "input", values });
	};
	const set = (k: string, v: string | number | boolean) =>
		setValues((p) => ({ ...p, [k]: v }));
	return (
		<form
			className="flex flex-col gap-2"
			onSubmit={onSubmit}
			data-testid="ask-dock-form"
		>
			{Object.entries(fields).map(([k, f]) => (
				<label key={k} className="flex flex-col gap-1 text-meta text-text-2">
					{f.title ?? k}
					{f.type === "boolean" ? (
						<input
							type="checkbox"
							className="size-4"
							checked={values[k] === true}
							onChange={(e) => set(k, e.target.checked)}
						/>
					) : f.type === "string" && f.enum ? (
						<Select
							value={values[k] === undefined ? undefined : String(values[k])}
							onValueChange={(v) => set(k, v)}
						>
							<SelectTrigger aria-label={f.title ?? k}>
								<SelectValue placeholder="Choose" />
							</SelectTrigger>
							<SelectContent>
								{f.enum.map((v, n) => (
									<SelectItem key={v} value={v}>
										{f.enumNames?.[n] ?? v}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					) : (
						<input
							className={field}
							type={f.type === "string" ? "text" : "number"}
							required={required.includes(k)}
							value={String(values[k] ?? "")}
							onChange={(e) =>
								set(
									k,
									f.type === "string" ? e.target.value : Number(e.target.value),
								)
							}
						/>
					)}
					{f.description && (
						<span className="text-text-3">{f.description}</span>
					)}
				</label>
			))}
			<Button type="submit" className="self-start" disabled={busy}>
				Answer
			</Button>
		</form>
	);
}

/** The value goes only to the write-only secrets route: never the draft, the transcript or a log. */
function SecretForm({
	busy,
	onSecret,
}: {
	busy: boolean;
	onSecret: (value: string) => void;
}) {
	const [value, setValue] = useState("");
	return (
		<form
			className="flex items-center gap-2"
			autoComplete="off"
			onSubmit={(e) => {
				e.preventDefault();
				if (!value) return;
				onSecret(value);
				setValue("");
			}}
		>
			<input
				type="password"
				aria-label="Secret"
				autoComplete="new-password"
				className={field}
				value={value}
				onChange={(e) => setValue(e.target.value)}
				data-testid="ask-dock-secret"
			/>
			<Button type="submit" disabled={busy || !value}>
				Give
			</Button>
		</form>
	);
}
