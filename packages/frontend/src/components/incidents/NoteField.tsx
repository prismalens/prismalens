// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { ArrowUp } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useIncidentRecord } from "./record-context";

/**
 * The note field (#743 §6): text for humans on the Timeline. It never reaches
 * an agent, so it has no picker and one send. Enter saves.
 */
export function NoteField({ className }: { className?: string }) {
	const { addNote, isSavingNote } = useIncidentRecord();
	const [text, setText] = useState("");
	const submit = (e: FormEvent) => {
		e.preventDefault();
		const note = text.trim();
		if (!note) return;
		addNote(note, () => setText(""));
	};
	return (
		<form
			onSubmit={submit}
			className={cn(
				"mt-3 flex h-9 items-center gap-1 rounded-surface bg-well-in-pool pr-1.5 pl-3",
				className,
			)}
			data-testid="note-field"
		>
			<input
				value={text}
				onChange={(e) => setText(e.target.value)}
				disabled={isSavingNote}
				placeholder="Add a note"
				aria-label="Add a note to the timeline"
				className="h-7 min-w-0 flex-1 bg-transparent text-body outline-none placeholder:text-text-3 disabled:opacity-60"
				data-testid="note-input"
			/>
			<Button
				type="submit"
				size="icon-sm"
				variant="text"
				disabled={!text.trim() || isSavingNote}
				aria-label="Save note"
			>
				<ArrowUp />
			</Button>
		</form>
	);
}
