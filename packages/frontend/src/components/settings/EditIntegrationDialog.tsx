"use client";

import type { AuthTemplateResponse } from "@prismalens/contracts/schemas";
import { Loader2 } from "lucide-react";

import { MutationError } from "@/components/shared/MutationError";
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
import { DynamicCredentialForm } from "./DynamicCredentialForm";

interface EditIntegrationDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	template: AuthTemplateResponse | undefined;
	label: string;
	onLabelChange: (label: string) => void;
	credentialValues: Record<string, string>;
	onCredentialValuesChange: (values: Record<string, string>) => void;
	showErrors: boolean;
	error: Error | null;
	onSave: () => void;
	onCancel: () => void;
	isSaving: boolean;
}

export function EditIntegrationDialog({
	open,
	onOpenChange,
	template,
	label,
	onLabelChange,
	credentialValues,
	onCredentialValuesChange,
	showErrors,
	error,
	onSave,
	onCancel,
	isSaving,
}: EditIntegrationDialogProps) {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Edit Integration</DialogTitle>
					<DialogDescription>
						Update integration label and credentials
					</DialogDescription>
				</DialogHeader>
				<div className="space-y-4 py-4">
					<div className="space-y-2">
						<Label htmlFor="editIntegrationLabel">Label</Label>
						<Input
							id="editIntegrationLabel"
							value={label}
							onChange={(e) => onLabelChange(e.target.value)}
							placeholder="e.g., Production GitHub"
							aria-invalid={showErrors && !label.trim() ? true : undefined}
						/>
						{showErrors && !label.trim() && (
							<p className="text-sm text-destructive">Label is required</p>
						)}
					</div>

					{/* Integration credential fields with "leave blank to keep" hint */}
					{template?.integrationCredentialFields &&
						template.integrationCredentialFields.length > 0 && (
							<>
								<div className="space-y-1">
									<Label className="text-sm text-muted-foreground">
										Leave fields blank to keep existing values
									</Label>
								</div>
								<DynamicCredentialForm
									fields={template.integrationCredentialFields}
									values={credentialValues}
									onChange={onCredentialValuesChange}
									showErrors={showErrors}
								/>
							</>
						)}

					{/* OAuth credential fields */}
					{template?.connectionCreationMode === "oauth_redirect" && (
						<>
							<div className="space-y-1">
								<Label className="text-sm text-muted-foreground">
									Leave fields blank to keep existing values
								</Label>
							</div>
							<div className="space-y-2">
								<Label htmlFor="editClientId">Client ID</Label>
								<Input
									id="editClientId"
									value={credentialValues.clientId ?? ""}
									onChange={(e) =>
										onCredentialValuesChange({
											...credentialValues,
											clientId: e.target.value,
										})
									}
									placeholder="OAuth App Client ID"
								/>
							</div>
							<div className="space-y-2">
								<Label htmlFor="editClientSecret">Client Secret</Label>
								<Input
									id="editClientSecret"
									type="password"
									value={credentialValues.clientSecret ?? ""}
									onChange={(e) =>
										onCredentialValuesChange({
											...credentialValues,
											clientSecret: e.target.value,
										})
									}
									placeholder="OAuth App Client Secret"
								/>
							</div>
						</>
					)}
				</div>
				<MutationError error={error} className="mb-2" />
				<DialogFooter>
					<Button variant="outline" onClick={onCancel}>
						Cancel
					</Button>
					<Button onClick={onSave} disabled={isSaving}>
						{isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
						Update Integration
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
