// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type {
	AskAnswer,
	AskQuestion,
	ElicitField,
	PendingAsk,
} from "@prismalens/contracts";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { type FormEvent, type ReactNode, useEffect, useState } from "react";
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
import { alwaysLine, whyAsked } from "@/lib/ask-lines";
import { getErrorMessage } from "@/lib/get-error-message";
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
}: {
	asks: readonly PendingAsk[];
	threadId: string;
	agent: string;
	/** `?ask=<id>`: the card a link or push landed on. */
	focusAskId?: string | null;
}) {
	const list = [...asks].sort((a, b) => a.openedAt.localeCompare(b.openedAt));
	// The host's own session may answer an ask only it can; any other browser is pointed there.
	const { managesPairing: onHost } = useOperator();
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
			className="flex flex-col gap-2"
			data-testid="ask-dock"
			data-kind={ask.kind}
			onKeyDown={(e) => {
				if (e.key === "Escape") {
					e.stopPropagation();
					setHidden(true);
				}
			}}
		>
			<header className="flex items-center gap-2 text-meta text-text-3">
				<span className="min-w-0 flex-1 truncate" data-testid="ask-dock-who">
					{who(ask, agent)} asks
				</span>
				{list.length > 1 && (
					<span className="inline-flex items-center gap-0.5">
						<Button
							variant="ghost"
							size="icon-sm"
							aria-label="Previous ask"
							disabled={i === 0}
							onClick={() => setAt(i - 1)}
						>
							<ChevronLeft />
						</Button>
						<span data-testid="ask-dock-page">
							{i + 1} of {list.length}
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
					</span>
				)}
				<Button
					variant="text"
					size="sm"
					onClick={() => setHidden(true)}
					data-testid="ask-dock-reply"
				>
					Reply instead
				</Button>
			</header>
			<p className="text-body text-text-1" data-testid="ask-dock-title">
				{ask.title}
			</p>
			{ask.detail && (
				<p className="truncate font-mono text-meta text-text-2">{ask.detail}</p>
			)}
			<p className="text-meta text-text-3" data-testid="ask-dock-why">
				{whyAsked(ask, null)}
			</p>
			{ask.requiresHost && !onHost ? (
				<p className="text-meta text-text-2" data-testid="ask-dock-host">
					Answer on the host machine
				</p>
			) : (
				<AskBody key={ask.askId} ask={ask} threadId={threadId} />
			)}
		</section>
	);
}

function AskBody({ ask, threadId }: { ask: PendingAsk; threadId: string }) {
	const answer = useAnswerAsk();
	const secret = useAnswerSecret();
	const [error, setError] = useState<string | null>(null);
	const busy = answer.isPending || secret.isPending;
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
	return (
		<>
			{body}
			{ask.kind !== "secret" && (
				<Button
					variant="text"
					size="sm"
					className="self-start"
					disabled={busy}
					onClick={() => send({ kind: "decline" })}
					data-testid="ask-dock-decline"
				>
					Skip
				</Button>
			)}
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
				data-testid="ask-dock-allow"
			>
				{plan ? "Approve" : "Allow once"} <Kbd>Alt Y</Kbd>
			</Button>
			{!plan && ask.permission?.identity && (
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
			)}
			<Button
				variant="secondary"
				disabled={busy}
				onClick={() => onAnswer({ kind: "permission", decision: "deny" })}
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
			{always && (
				<p
					className="w-full text-meta text-text-3"
					data-testid="ask-dock-always-line"
				>
					{always}
				</p>
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
		<div className="flex flex-col gap-2.5">
			{questions.map((q) => (
				<fieldset
					key={q.id}
					className="flex flex-col gap-1"
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
								className={cn(
									"flex min-h-8 items-baseline gap-2 rounded-control px-2.5 py-1 text-left text-body text-text-1 hover:bg-surface-4 focus-visible:ring-2 focus-visible:ring-accent/60",
									on && "bg-surface-4",
								)}
								data-testid="ask-dock-option"
							>
								{n < 9 && (
									<span className="font-mono text-meta text-text-3">
										{n + 1}
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
					{q.allowOther && (
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
			{!single || questions.some((q) => q.allowOther) ? (
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
