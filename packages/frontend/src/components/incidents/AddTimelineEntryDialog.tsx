// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

"use client";

import type { TimelineEntryType } from "@prismalens/contracts";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

export interface AddTimelineEntryDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onSubmit: (entry: {
		title: string;
		description?: string;
		type: TimelineEntryType;
	}) => void;
	isSubmitting?: boolean;
}

// Only allow user-creatable entry types
const userEntryTypes: { value: TimelineEntryType; label: string }[] = [
	{ value: "comment", label: "Comment" },
	{ value: "custom", label: "Action Taken" },
];

export function AddTimelineEntryDialog({
	open,
	onOpenChange,
	onSubmit,
	isSubmitting,
}: AddTimelineEntryDialogProps) {
	const [title, setTitle] = useState("");
	const [description, setDescription] = useState("");
	const [type, setType] = useState<TimelineEntryType>("comment");

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault();
		if (!title.trim()) return;

		onSubmit({
			title: title.trim(),
			description: description.trim() || undefined,
			type,
		});

		// Reset form
		setTitle("");
		setDescription("");
		setType("comment");
	};

	const handleOpenChange = (newOpen: boolean) => {
		if (!newOpen) {
			// Reset form on close
			setTitle("");
			setDescription("");
			setType("comment");
		}
		onOpenChange(newOpen);
	};

	return (
		<Dialog open={open} onOpenChange={handleOpenChange}>
			<DialogContent className="sm:max-w-[425px]">
				<form onSubmit={handleSubmit}>
					<DialogHeader>
						<DialogTitle>Add Timeline Entry</DialogTitle>
						<DialogDescription>
							Add a manual note or record an action taken during this incident.
						</DialogDescription>
					</DialogHeader>

					<div className="grid gap-4 py-4">
						<div className="grid gap-2">
							<Label htmlFor="title">Title *</Label>
							<Input
								id="title"
								placeholder="e.g., Fix deployed, Root cause identified"
								value={title}
								onChange={(e) => setTitle(e.target.value)}
								disabled={isSubmitting}
								required
							/>
						</div>

						<div className="grid gap-2">
							<Label htmlFor="description">Description (optional)</Label>
							<Textarea
								id="description"
								placeholder="Add more details about this event..."
								value={description}
								onChange={(e) => setDescription(e.target.value)}
								disabled={isSubmitting}
								rows={3}
							/>
						</div>

						<div className="grid gap-2">
							<Label htmlFor="type">Type</Label>
							<Select
								value={type}
								onValueChange={(v) => setType(v as TimelineEntryType)}
								disabled={isSubmitting}
							>
								<SelectTrigger id="type">
									<SelectValue placeholder="Select type" />
								</SelectTrigger>
								<SelectContent>
									{userEntryTypes.map((opt) => (
										<SelectItem key={opt.value} value={opt.value}>
											{opt.label}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
					</div>

					<DialogFooter>
						<Button
							type="button"
							variant="outline"
							onClick={() => handleOpenChange(false)}
							disabled={isSubmitting}
						>
							Cancel
						</Button>
						<Button type="submit" disabled={!title.trim() || isSubmitting}>
							{isSubmitting ? "Adding..." : "Add Entry"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
