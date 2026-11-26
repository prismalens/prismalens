// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { RewindBlock } from "@prismalens/contracts";
import { createContext, type ReactNode, useContext, useState } from "react";
import type { MessageEdit } from "@/components/investigation/message.actions";
import { Button } from "@/components/ui/button";

/** What the page lets a transcript do with a sent message (#1193). */
export interface TranscriptEdit {
	/** The block every sent message has now: a live run, queued messages, a view-only device. */
	block: RewindBlock | null;
	/** Opens the confirm dialog for the edited text of message `seq`. */
	send: (seq: number, text: string) => void;
}

interface EditState {
	edit: TranscriptEdit | undefined;
	/** Messages before the report: Edit points to Fork instead. */
	beforeReport: ReadonlySet<string>;
	editing: { key: string; text: string } | null;
	setEditing: (e: { key: string; text: string } | null) => void;
}

const EditContext = createContext<EditState | null>(null);

/** Edit opens the field to type in; a callback ref runs once per mount. */
const focusOnMount = (el: HTMLTextAreaElement | null) => el?.focus();

export function EditProvider({
	edit,
	beforeReport,
	children,
}: {
	edit: TranscriptEdit | undefined;
	beforeReport: ReadonlySet<string>;
	children: ReactNode;
}) {
	const [editing, setEditing] = useState<{ key: string; text: string } | null>(
		null,
	);
	return (
		<EditContext.Provider value={{ edit, beforeReport, editing, setEditing }}>
			{children}
		</EditContext.Provider>
	);
}

/**
 * A user's sent message, editable in place (#1193): Edit swaps it for the same field the
 * dock's queued edit uses, with Cancel and Send edit; Esc cancels.
 */
export function EditableMessage({
	itemKey,
	seq,
	text,
	children,
}: {
	itemKey: string;
	seq: number | undefined;
	text: string;
	children: (edit: MessageEdit | undefined) => ReactNode;
}) {
	const state = useContext(EditContext);
	const edit = state?.edit;
	if (!state || !edit || seq === undefined) return <>{children(undefined)}</>;
	const open = state.editing?.key === itemKey ? state.editing : null;
	if (open)
		return (
			<li data-testid="message-edit">
				<form
					className="ml-auto flex w-full max-w-[85%] flex-col gap-2"
					onSubmit={(e) => {
						e.preventDefault();
						const next = open.text.trim();
						if (next) edit.send(seq, next);
					}}
				>
					<textarea
						ref={focusOnMount}
						aria-label="Edit message"
						rows={Math.min(8, Math.max(2, open.text.split("\n").length))}
						className="min-w-0 resize-y rounded-control bg-surface-4 px-2.5 py-2 text-body text-text-1 outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
						value={open.text}
						onChange={(e) =>
							state.setEditing({ key: itemKey, text: e.target.value })
						}
						onKeyDown={(e) => {
							if (e.key === "Escape") state.setEditing(null);
						}}
						data-testid="message-edit-text"
					/>
					<span className="flex justify-end gap-2">
						<Button
							type="button"
							variant="secondary"
							size="sm"
							onClick={() => state.setEditing(null)}
						>
							Cancel
						</Button>
						<Button
							type="submit"
							size="sm"
							disabled={!open.text.trim()}
							data-testid="message-edit-send"
						>
							Send edit
						</Button>
					</span>
				</form>
			</li>
		);
	const block =
		edit.block ?? (state.beforeReport.has(itemKey) ? "before-report" : null);
	return (
		<>
			{children({
				block,
				run: () => state.setEditing({ key: itemKey, text }),
			})}
		</>
	);
}
