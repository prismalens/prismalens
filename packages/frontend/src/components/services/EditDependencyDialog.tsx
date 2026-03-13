"use client";

import { useState, useEffect } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
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
import { useUpdateServiceDependency } from "@/lib/api/hooks";

export interface EditDependencyDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	serviceId: string;
	dependencyId: string;
	dependencyName: string;
	currentType: string;
	currentCriticality: string;
	onSuccess?: () => void;
}

export function EditDependencyDialog({
	open,
	onOpenChange,
	serviceId,
	dependencyId,
	dependencyName,
	currentType,
	currentCriticality,
	onSuccess,
}: EditDependencyDialogProps) {
	const [dependencyType, setDependencyType] = useState(currentType);
	const [criticality, setCriticality] = useState(currentCriticality);
	const [error, setError] = useState<string | null>(null);

	const updateDependency = useUpdateServiceDependency();

	// Reset state when dialog opens with new values
	useEffect(() => {
		if (open) {
			setDependencyType(currentType);
			setCriticality(currentCriticality);
			setError(null);
		}
	}, [open, currentType, currentCriticality]);

	const handleSave = async () => {
		setError(null);
		try {
			await updateDependency.mutateAsync({
				id: serviceId,
				dependencyId,
				dependencyType: dependencyType as any,
				criticality: criticality as any,
			});
			onOpenChange(false);
			onSuccess?.();
		} catch (err) {
			const message =
				err instanceof Error ? err.message : "Failed to update dependency";
			setError(message);
		}
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Edit Dependency — {dependencyName}</DialogTitle>
				</DialogHeader>

				<div className="space-y-4 py-4">
					<div className="space-y-2">
						<label className="text-sm font-medium">Dependency Type</label>
						<Select value={dependencyType} onValueChange={setDependencyType}>
							<SelectTrigger>
								<SelectValue placeholder="Select type" />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="runtime">Runtime</SelectItem>
								<SelectItem value="build">Build</SelectItem>
								<SelectItem value="data">Data</SelectItem>
							</SelectContent>
						</Select>
					</div>

					<div className="space-y-2">
						<label className="text-sm font-medium">Criticality</label>
						<Select value={criticality} onValueChange={setCriticality}>
							<SelectTrigger>
								<SelectValue placeholder="Select criticality" />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="required">Required</SelectItem>
								<SelectItem value="optional">Optional</SelectItem>
								<SelectItem value="degraded">Degraded</SelectItem>
							</SelectContent>
						</Select>
					</div>

					{error && (
						<p className="text-sm text-destructive text-center">{error}</p>
					)}
				</div>

				<DialogFooter>
					<Button
						variant="outline"
						onClick={() => onOpenChange(false)}
						disabled={updateDependency.isPending}
					>
						Cancel
					</Button>
					<Button
						onClick={handleSave}
						disabled={updateDependency.isPending}
					>
						{updateDependency.isPending ? (
							<>
								<Loader2 className="h-4 w-4 mr-2 animate-spin" />
								Saving...
							</>
						) : (
							"Save"
						)}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
