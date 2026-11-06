// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { useState } from "react";
import { useIncidentRecord } from "@/components/incidents/record-context";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { getErrorMessage } from "@/lib/get-error-message";

/** A note on the incident's timeline, from any of its pages; the agent does not read it as a message. */
export function NoteDialog({
	open,
	onOpenChange,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const record = useIncidentRecord();
	const { toast } = useToast();
	const [text, setText] = useState("");
	const save = () =>
		record.addNote(
			text.trim(),
			() => {
				setText("");
				onOpenChange(false);
			},
			(error) =>
				toast({
					title: "Note not saved",
					description: getErrorMessage(error),
					variant: "destructive",
				}),
		);
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent data-testid="note-dialog">
				<DialogHeader>
					<DialogTitle>Add a note</DialogTitle>
					<DialogDescription>
						It goes on the incident's timeline. The agent doesn't get it as a
						message.
					</DialogDescription>
				</DialogHeader>
				<Textarea
					value={text}
					onChange={(e) => setText(e.target.value)}
					rows={4}
					aria-label="Note"
					data-testid="note-text"
				/>
				<DialogFooter>
					<Button variant="text" onClick={() => onOpenChange(false)}>
						Cancel
					</Button>
					<Button
						onClick={save}
						disabled={!text.trim() || record.isSavingNote}
						data-testid="note-save"
					>
						Add note
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
