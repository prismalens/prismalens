// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	type CloseIncidentInput,
	enumOptions,
	ROOT_CAUSE_CATEGORY_LABEL,
	type RootCauseCategory,
	RootCauseCategorySchema,
} from "@prismalens/contracts";
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
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

const CATEGORIES = enumOptions(
	RootCauseCategorySchema,
	ROOT_CAUSE_CATEGORY_LABEL,
);

/**
 * Radix refuses an empty `SelectItem` value — it reserves it for "nothing
 * selected" — so the way back to unset needs a sentinel of its own.
 */
const NO_CATEGORY = "__none";

/**
 * Closing asks what actually caused the incident (#338). Both fields are
 * optional; what is recorded outranks the investigation's guess the next time a
 * similar incident is investigated.
 */
export function CloseIncidentDialog({
	open,
	onOpenChange,
	onConfirm,
	isPending,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onConfirm: (cause: Omit<CloseIncidentInput, "id">) => void;
	isPending?: boolean;
}) {
	const [actualCause, setActualCause] = useState("");
	const [category, setCategory] = useState<RootCauseCategory | "">("");

	// The dialog stays mounted when it closes, so without this a cancel kept
	// whatever was typed and the next open could submit it against a different
	// incident. Resetting when `open` goes false catches every close path,
	// including the parent closing it programmatically after a successful
	// confirm — which an `onOpenChange` wrapper would miss.
	const [wasOpen, setWasOpen] = useState(open);
	if (open !== wasOpen) {
		setWasOpen(open);
		if (!open) {
			setActualCause("");
			setCategory("");
		}
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Close incident</DialogTitle>
					<DialogDescription>
						What actually caused it? Optional. This can appear alongside similar
						past incidents in future investigations.
					</DialogDescription>
				</DialogHeader>
				<div className="space-y-4">
					<div className="space-y-2">
						<Label htmlFor="actual-cause">Actual cause</Label>
						<Textarea
							id="actual-cause"
							value={actualCause}
							maxLength={2000}
							placeholder="e.g. deploy 41 dropped DB_POOL_SIZE from 50 to 5"
							onChange={(e) => setActualCause(e.target.value)}
						/>
					</div>
					<div className="space-y-2">
						<Label htmlFor="actual-cause-category">Category</Label>
						<Select
							value={category || NO_CATEGORY}
							onValueChange={(v) =>
								setCategory(v === NO_CATEGORY ? "" : (v as RootCauseCategory))
							}
						>
							<SelectTrigger id="actual-cause-category">
								<SelectValue placeholder="Not set" />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value={NO_CATEGORY}>Not set</SelectItem>
								{CATEGORIES.map((c) => (
									<SelectItem key={c.value} value={c.value}>
										{c.label}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>
				</div>
				<DialogFooter>
					<Button variant="outline" onClick={() => onOpenChange(false)}>
						Cancel
					</Button>
					<Button
						disabled={isPending}
						onClick={() =>
							onConfirm({
								...(actualCause.trim()
									? { actualCause: actualCause.trim() }
									: {}),
								...(category ? { actualCauseCategory: category } : {}),
							})
						}
						data-testid="confirm-close-incident"
					>
						Close incident
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
