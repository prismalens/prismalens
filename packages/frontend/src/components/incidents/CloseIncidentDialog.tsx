// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type {
	CloseIncidentInput,
	RootCauseCategory,
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

const CATEGORIES: RootCauseCategory[] = [
	"code",
	"config",
	"infrastructure",
	"external",
	"unknown",
];

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

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Close incident</DialogTitle>
					<DialogDescription>
						What actually caused it? Optional. The next similar incident's
						report cites it.
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
							value={category}
							onValueChange={(v) => setCategory(v as RootCauseCategory)}
						>
							<SelectTrigger id="actual-cause-category">
								<SelectValue placeholder="Not set" />
							</SelectTrigger>
							<SelectContent>
								{CATEGORIES.map((c) => (
									<SelectItem key={c} value={c}>
										{c}
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
