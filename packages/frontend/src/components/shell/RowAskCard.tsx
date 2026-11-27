// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { AccessLevel } from "@prismalens/config/harness";
import { ACCESS_LEVEL_LABEL } from "@prismalens/contracts";
import { useState } from "react";

const focusOnMount = (el: HTMLInputElement | null) => el?.focus();

import { CommandText } from "@/components/kit/CommandText";
import { fact } from "@/components/kit/fact";
import { Status } from "@/components/kit/Status";
import { Hint } from "@/components/shared/Hint";
import { Button } from "@/components/ui/button";
import { alwaysLine, askSubject, waitedFor, whyAsked } from "@/lib/ask-lines";
import { askRefusal } from "@/lib/ask-refusal";
import type { RowAskState } from "./RowAsk";

/**
 * A waiting ask in the card beside its row (sheet §1; #1101 category 8 item 2): the
 * exact command or path, Approve and Decline, Always and Deny with reason under ⋯.
 * Its keys live in the row (Y, N, 1 to 9) and in the hints, never on the buttons.
 */
export function RowAsk({
	state,
	ended,
	accessLevel,
	now,
	count,
	openHref,
}: {
	state: RowAskState;
	ended: boolean;
	accessLevel: AccessLevel | null;
	now: number;
	/** Asks this thread holds; the card shows the oldest. */
	count: number;
	openHref: () => void;
}) {
	const { ask } = state;
	const [reason, setReason] = useState<string | null>(null);
	if (!ask) return null;
	const subject = askSubject(ask);
	const always = alwaysLine(ask);
	const who =
		ask.source.kind === "subagent" ? `${ask.source.title} asks` : "Asks";
	return (
		<div
			className="flex flex-col gap-2"
			data-testid="row-ask"
			data-kind={ask.kind}
		>
			<p className="flex items-center gap-1.5 text-meta text-text-3">
				<Status
					kind={ask.kind === "question" ? "question" : "approval"}
					showWord={false}
				/>
				<span className="min-w-0 flex-1 truncate">
					{who} · {waitedFor(ask.openedAt, now)}
					{accessLevel && (
						<Hint label={whyAsked(ask, accessLevel)}>
							<span data-testid="row-ask-mode">
								{" "}
								· {ACCESS_LEVEL_LABEL[accessLevel]}
							</span>
						</Hint>
					)}
				</span>
				{count > 1 && <span data-testid="row-ask-count">1 of {count}</span>}
			</p>
			<p className="text-body font-medium text-text-1">{ask.title}</p>
			{subject && (
				<code
					className="block max-h-24 overflow-y-auto whitespace-pre-wrap [overflow-wrap:anywhere] rounded-control bg-surface-3 px-2 py-1 font-mono text-meta text-text-1"
					data-testid="row-ask-subject"
					{...fact("cause")}
				>
					<CommandText text={subject} />
				</code>
			)}
			{!ended && ask.kind === "permission" && (
				// Why it asked and what Always keeps, on the card itself (#1101 cat 8 item 6).
				<p className="text-meta text-text-3" data-testid="row-ask-why">
					{whyAsked(ask, accessLevel)}
					{always ? ` ${always}` : ""}
				</p>
			)}
			{ended ? (
				<p className="text-meta text-text-2" data-testid="row-ask-ended">
					Ended
				</p>
			) : ask.requiresHost && !state.onHost ? (
				<p className="text-meta text-text-2">{askRefusal(ask, false)?.text}</p>
			) : ask.kind === "permission" ? (
				reason !== null ? (
					<form
						className="flex items-center gap-1.5"
						onSubmit={(e) => {
							e.preventDefault();
							state.decline(reason);
						}}
					>
						<input
							// The reason is the one thing to type once Deny with reason opens it.
							ref={focusOnMount}
							aria-label="Reason"
							placeholder="Reason"
							value={reason}
							onChange={(e) => setReason(e.target.value)}
							onKeyDown={(e) => e.stopPropagation()}
							className="h-7 min-w-0 flex-1 rounded-control bg-surface-3 px-2 text-meta text-text-1 outline-none placeholder:text-text-3 focus-visible:ring-2 focus-visible:ring-accent"
							data-testid="row-ask-reason"
						/>
						<Button
							type="submit"
							size="sm"
							variant="secondary"
							disabled={state.busy}
						>
							Deny
						</Button>
					</form>
				) : (
					<div className="flex flex-wrap items-center gap-1.5">
						<Hint label="Approve" keys={["Y"]}>
							<Button
								size="sm"
								variant="primary"
								disabled={state.busy}
								onClick={state.approve}
								aria-keyshortcuts="Y"
								data-testid="row-ask-approve"
							>
								Approve
							</Button>
						</Hint>
						<Hint label="Decline" keys={["N"]}>
							<Button
								size="sm"
								variant="secondary"
								disabled={state.busy}
								onClick={() => state.decline()}
								aria-keyshortcuts="N"
								data-testid="row-ask-decline"
							>
								Decline
							</Button>
						</Hint>
						{/* Always and Deny with reason are one step away, never in a menu (#1101 cat 8 item 2). */}
						{always && (
							<Hint label={always}>
								<Button
									size="sm"
									variant="secondary"
									disabled={state.busy}
									onClick={state.always}
									data-testid="row-ask-always"
								>
									Always
								</Button>
							</Hint>
						)}
						<Button
							size="sm"
							variant="text"
							disabled={state.busy}
							onClick={() => setReason("")}
							data-testid="row-ask-deny-reason"
						>
							Deny with reason
						</Button>
					</div>
				)
			) : ask.kind === "question" && state.single ? (
				<div className="flex flex-col">
					{ask.questions?.[0]?.options.map((o, n) => (
						<Hint
							key={o.id}
							label={o.label}
							keys={[String(n + 1)]}
							side="right"
						>
							<button
								type="button"
								disabled={state.busy}
								onClick={() => state.pick(n + 1)}
								className="flex min-h-7 items-center rounded-control px-2 text-left text-body text-text-1 outline-none hover:bg-surface-3 focus-visible:ring-2 focus-visible:ring-accent"
								data-testid="row-ask-option"
							>
								{o.label}
							</button>
						</Hint>
					))}
				</div>
			) : (
				<Button
					size="sm"
					variant="secondary"
					className="self-start"
					onClick={openHref}
				>
					Open to answer
				</Button>
			)}
			{state.error && (
				<p className="text-meta text-danger" role="alert">
					{state.error}
				</p>
			)}
		</div>
	);
}
