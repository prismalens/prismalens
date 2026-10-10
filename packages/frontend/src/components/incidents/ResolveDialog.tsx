// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	ACTUAL_CAUSE_MAX,
	type CloseIncidentInput,
	enumOptions,
	type IncidentWithRelations,
	isAlertFiring,
	ROOT_CAUSE_CATEGORY_LABEL,
	type RootCauseCategory,
	RootCauseCategorySchema,
} from "@prismalens/contracts";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { stripInlineMarkdown } from "@/lib/strip-inline-markdown";
import { cn } from "@/lib/utils";

const CATEGORIES = enumOptions(
	RootCauseCategorySchema,
	ROOT_CAUSE_CATEGORY_LABEL,
);

/** Radix reserves the empty value for "nothing selected"; unset needs its own. */
const NO_CATEGORY = "__none";

/** What the report answered, for the dialog to start from (adversarial v2 finding 19). */
export function reportAnswer(incident: IncidentWithRelations): {
	cause: string;
	category: RootCauseCategory | "";
} {
	const done = incident.investigations?.find((r) => r.status === "completed");
	return {
		// The agent writes inline Markdown; a field a person edits reads plain (L80).
		cause: stripInlineMarkdown(done?.rootCause ?? ""),
		category: (done?.rootCauseCategory as RootCauseCategory | null) ?? "",
	};
}

/** The cause as recorded, for Edit after Resolve. */
function recorded(incident: IncidentWithRelations): {
	cause: string;
	category: RootCauseCategory | "";
} {
	return {
		cause: incident.actualCause ?? "",
		category: incident.actualCauseCategory ?? "",
	};
}

/**
 * The operator's one step (R1a d7): Resolve, from any open status or from
 * Alerts cleared. Cause and category start from the report and stay editable
 * after; a still-firing alert is named with what follows if it fires again.
 */
export function ResolveDialog({
	open,
	onOpenChange,
	incident,
	onConfirm,
	isPending,
	mode = "resolve",
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	incident: IncidentWithRelations;
	onConfirm: (cause: Omit<CloseIncidentInput, "id">) => void;
	isPending?: boolean;
	/** `edit`: the cause of a Resolved incident, which stays editable (R1a d3). */
	mode?: "resolve" | "edit";
}) {
	const editing = mode === "edit";
	const answer = editing ? recorded(incident) : reportAnswer(incident);
	const [cause, setCause] = useState(answer.cause);
	const [category, setCategory] = useState<RootCauseCategory | "">(
		answer.category,
	);
	const causeId = useId();
	const causeHintId = useId();
	const categoryId = useId();

	// Each open starts from the report again, never from a cancelled edit.
	const [wasOpen, setWasOpen] = useState(open);
	if (open !== wasOpen) {
		setWasOpen(open);
		if (open) {
			setCause(answer.cause);
			setCategory(answer.category);
		}
	}

	const causeLength = cause.trim().length;
	const tooLong = causeLength > ACTUAL_CAUSE_MAX;
	const firing = editing
		? 0
		: (incident.alerts ?? []).filter((a) => isAlertFiring(a.status)).length;
	const fromReport = (field: "cause" | "category") =>
		!editing &&
		(field === "cause"
			? !!answer.cause && cause === answer.cause
			: !!answer.category && category === answer.category);

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent data-testid="resolve-dialog">
				<DialogHeader>
					<DialogTitle>
						{editing
							? `The cause of INC-${incident.number}`
							: `Resolve INC-${incident.number}`}
					</DialogTitle>
					{firing > 0 && (
						<DialogDescription data-testid="resolve-still-firing">
							{firing === 1
								? "1 alert is still firing in Alertmanager. Resolving ends it here;"
								: `${firing} alerts are still firing in Alertmanager. Resolving ends them here;`}{" "}
							if {firing === 1 ? "it fires" : "they fire"} again, a new incident
							opens and names this one.
						</DialogDescription>
					)}
				</DialogHeader>
				<div className="space-y-4">
					<div className="space-y-1.5">
						<label htmlFor={causeId} className="block text-body">
							<span className="font-medium">Cause</span>{" "}
							<span className="text-text-3" data-testid="resolve-cause-note">
								{fromReport("cause")
									? "from the report, edit if wrong"
									: editing
										? ""
										: "optional, you can edit it later"}
							</span>
						</label>
						{/* No maxLength: it cuts a paste silently and never trims the report's own answer (#673 walk 4, QA-04). */}
						<Textarea
							id={causeId}
							value={cause}
							onChange={(e) => setCause(e.target.value)}
							aria-invalid={tooLong || undefined}
							aria-describedby={causeHintId}
							data-testid="resolve-cause"
						/>
						<p
							id={causeHintId}
							className={cn(
								"text-meta tabular-nums",
								tooLong ? "text-danger" : "text-text-3",
							)}
							data-testid="resolve-cause-count"
							role={tooLong ? "alert" : undefined}
						>
							{tooLong
								? `${causeLength.toLocaleString("en-US")} characters. Shorten the cause to ${ACTUAL_CAUSE_MAX.toLocaleString("en-US")} to save it.`
								: `${causeLength.toLocaleString("en-US")} of ${ACTUAL_CAUSE_MAX.toLocaleString("en-US")} characters`}
						</p>
					</div>
					<div className="space-y-1.5">
						<label htmlFor={categoryId} className="block text-body">
							<span className="font-medium">Category</span>
							{fromReport("category") && (
								<span className="text-text-3"> from the report</span>
							)}
						</label>
						<Select
							value={category || NO_CATEGORY}
							onValueChange={(v) =>
								setCategory(v === NO_CATEGORY ? "" : (v as RootCauseCategory))
							}
						>
							<SelectTrigger id={categoryId} data-testid="resolve-category">
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
					<Button variant="text" onClick={() => onOpenChange(false)}>
						Cancel
					</Button>
					<Button
						variant="primary"
						disabled={isPending || tooLong}
						onClick={() =>
							onConfirm(
								editing
									? // An emptied field clears what was recorded.
										{
											actualCause: cause.trim(),
											...(category ? { actualCauseCategory: category } : {}),
										}
									: {
											...(cause.trim() ? { actualCause: cause.trim() } : {}),
											...(category ? { actualCauseCategory: category } : {}),
										},
							)
						}
						data-testid="confirm-resolve"
					>
						{editing ? "Save" : "Resolve"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
