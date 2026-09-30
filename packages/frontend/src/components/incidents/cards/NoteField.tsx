// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { ArrowUp } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { useIncidentRecord } from "../record-context";

/**
 * The note field (#743 §6): text for humans on the Timeline. It never reaches
 * an agent, so it has no picker and one send. Enter saves.
 */
export function NoteField() {
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
			className="flex items-center gap-1 rounded-md border bg-background py-0.5 pr-0.5 pl-2 focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50"
			data-testid="note-field"
		>
			<input
				value={text}
				onChange={(e) => setText(e.target.value)}
				disabled={isSavingNote}
				placeholder="Add a note"
				aria-label="Add a note to the timeline"
				className="h-7 min-w-0 flex-1 bg-transparent text-record outline-none placeholder:text-muted-foreground disabled:opacity-60"
				data-testid="note-input"
			/>
			<Button
				type="submit"
				size="icon-xs"
				variant={text.trim() ? "default" : "ghost"}
				disabled={!text.trim() || isSavingNote}
				aria-label="Save note"
			>
				<ArrowUp />
			</Button>
		</form>
	);
}
