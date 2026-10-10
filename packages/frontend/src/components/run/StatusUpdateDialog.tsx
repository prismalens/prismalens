// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { IncidentWithRelations } from "@prismalens/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useId, useRef, useState } from "react";
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
import { timelineKeys } from "@/lib/api/hooks";
import { orpc } from "@/lib/api/orpc-client";
import { getErrorMessage } from "@/lib/get-error-message";
import { statusUpdateDraft } from "./status-update";

/**
 * "Write a status update" (#811): a draft from the record; copying it logs it
 * on the timeline. A blocked clipboard (plain http) selects the text instead
 * and logs nothing, since nothing was confirmed copied.
 */
export function StatusUpdateDialog({
	open,
	onOpenChange,
	incident,
	now,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	incident: IncidentWithRelations;
	now: number | null;
}) {
	const queryClient = useQueryClient();
	const { toast } = useToast();
	const [text, setText] = useState("");
	const [blocked, setBlocked] = useState(false);
	const [wasOpen, setWasOpen] = useState(false);
	if (open !== wasOpen) {
		setWasOpen(open);
		if (open) {
			setText(statusUpdateDraft(incident, now));
			setBlocked(false);
		}
	}
	const area = useRef<HTMLTextAreaElement>(null);
	const textId = useId();
	const log = useMutation({
		...orpc.timeline.create.mutationOptions(),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: timelineKeys.all() });
			onOpenChange(false);
		},
		onError: (error) =>
			toast({
				title: "Copied, but not logged",
				description: getErrorMessage(error),
				variant: "destructive",
			}),
	});

	const copy = async () => {
		const body = text.trim();
		try {
			if (!navigator.clipboard) throw new Error("no clipboard");
			await navigator.clipboard.writeText(body);
		} catch {
			setBlocked(true);
			area.current?.focus();
			area.current?.select();
			return;
		}
		log.mutate({
			incidentId: incident.id,
			type: "comment",
			title: "Status update",
			description: body,
			source: "user",
		});
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent
				className="flex h-[360px] w-[min(560px,calc(100%-2rem))] flex-col"
				data-testid="status-update-dialog"
			>
				<DialogHeader>
					<DialogTitle>Status update</DialogTitle>
					<DialogDescription>
						Drafted from what is recorded on this incident. Copying adds it to
						the timeline.
					</DialogDescription>
				</DialogHeader>
				<label htmlFor={textId} className="sr-only">
					Update text
				</label>
				<Textarea
					id={textId}
					ref={area}
					value={text}
					onChange={(e) => setText(e.target.value)}
					className="min-h-0 flex-1 resize-none"
					dir="auto"
					data-testid="status-update-text"
				/>
				{blocked && (
					<p
						className="text-meta text-warn"
						role="alert"
						data-testid="status-update-blocked"
					>
						This browser blocked the clipboard. The text is selected: press
						Ctrl+C, then close. Nothing was logged.
					</p>
				)}
				<DialogFooter>
					<Button variant="text" onClick={() => onOpenChange(false)}>
						Cancel
					</Button>
					<Button
						variant="primary"
						disabled={!text.trim() || log.isPending}
						onClick={copy}
						data-testid="status-update-copy"
					>
						Copy and log it
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
