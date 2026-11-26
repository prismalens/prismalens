// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	type CustomModel,
	MODEL_LABELS,
	type ModelLabel,
} from "@prismalens/contracts";
import { type FormEvent, useState } from "react";
import { MARKS } from "@/components/kit/marks";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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

const LABEL_WORDS: Record<ModelLabel, string> = MARKS.modelCapability.words;

/** The model as saved: an empty name and no labels leave only the id (#1180). */
export function editedModel(
	id: string,
	name: string,
	labels: readonly ModelLabel[],
): CustomModel {
	const trimmed = name.trim();
	return {
		id,
		...(trimmed ? { name: trimmed } : {}),
		...(labels.length
			? { labels: MODEL_LABELS.filter((l) => labels.includes(l)) }
			: {}),
	};
}

/** A custom model's name and what the person says it is; PrismaLens never checks either. */
export function CustomModelDialog({
	model,
	onOpenChange,
	onSave,
	isPending,
}: {
	/** The model being edited; null keeps the dialog closed. */
	model: CustomModel | null;
	onOpenChange: (open: boolean) => void;
	onSave: (next: CustomModel) => void;
	isPending?: boolean;
}) {
	return (
		<Dialog open={model !== null} onOpenChange={onOpenChange}>
			<DialogContent data-testid="custom-model-dialog">
				{model && (
					<EditForm
						key={model.id}
						model={model}
						onSave={onSave}
						isPending={isPending}
					/>
				)}
			</DialogContent>
		</Dialog>
	);
}

function EditForm({
	model,
	onSave,
	isPending,
}: {
	model: CustomModel;
	onSave: (next: CustomModel) => void;
	isPending?: boolean;
}) {
	const [name, setName] = useState(model.name ?? "");
	const [labels, setLabels] = useState<ModelLabel[]>(model.labels ?? []);
	const submit = (e: FormEvent) => {
		e.preventDefault();
		onSave(editedModel(model.id, name, labels));
	};
	return (
		<form onSubmit={submit}>
			<DialogHeader>
				<DialogTitle>Edit name and options</DialogTitle>
				<DialogDescription>
					{model.id}. What you set here is shown beside it; PrismaLens never
					checks it.
				</DialogDescription>
			</DialogHeader>
			<div className="flex flex-col gap-3 py-3">
				<Label htmlFor="custom-model-name">Name</Label>
				<Input
					id="custom-model-name"
					value={name}
					maxLength={80}
					placeholder={model.id}
					onChange={(e) => setName(e.target.value)}
					data-testid="custom-model-name"
				/>
				{MODEL_LABELS.map((l) => (
					<div key={l} className="flex items-center gap-2">
						<Checkbox
							id={`custom-model-${l}`}
							checked={labels.includes(l)}
							onCheckedChange={(on) =>
								setLabels((was) =>
									on ? [...was, l] : was.filter((x) => x !== l),
								)
							}
							data-testid={`custom-model-label-${l}`}
						/>
						<Label htmlFor={`custom-model-${l}`}>{LABEL_WORDS[l]}</Label>
					</div>
				))}
			</div>
			<DialogFooter>
				<Button
					type="submit"
					size="sm"
					disabled={isPending}
					data-testid="custom-model-save"
				>
					Save
				</Button>
			</DialogFooter>
		</form>
	);
}
