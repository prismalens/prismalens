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
import { Label } from "@/components/ui/label";
import { DynamicCredentialForm } from "./DynamicCredentialForm";

interface EditConnectionDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	template: AuthTemplateResponse | undefined;
	credentialValues: Record<string, string>;
	onCredentialValuesChange: (values: Record<string, string>) => void;
	connectionFieldValues: Record<string, string>;
	onConnectionFieldValuesChange: (values: Record<string, string>) => void;
	showErrors: boolean;
	error: Error | null;
	onSave: () => void;
	onCancel: () => void;
	isSaving: boolean;
}

export function EditConnectionDialog({
	open,
	onOpenChange,
	template,
	credentialValues,
	onCredentialValuesChange,
	connectionFieldValues,
	onConnectionFieldValuesChange,
	showErrors,
	error,
	onSave,
	onCancel,
	isSaving,
}: EditConnectionDialogProps) {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Edit Connection</DialogTitle>
					<DialogDescription>
						{template?.connectionCreationMode === "oauth_redirect"
							? "Re-authorize your OAuth connection"
							: "Update connection credentials"}
					</DialogDescription>
				</DialogHeader>
				<div className="space-y-4 py-4">
					{/* Connection fields */}
					{template?.connectionFields &&
						template.connectionFields.length > 0 && (
							<DynamicCredentialForm
								fields={template.connectionFields}
								values={connectionFieldValues}
								onChange={onConnectionFieldValuesChange}
								showErrors={showErrors}
							/>
						)}

					{/* Connection credential fields (for non-OAuth) */}
					{template?.connectionCreationMode !== "oauth_redirect" &&
						template?.connectionCredentialFields &&
						template.connectionCredentialFields.length > 0 && (
							<>
								<div className="space-y-1">
									<Label className="text-sm text-muted-foreground">
										Leave fields blank to keep existing values
									</Label>
								</div>
								<DynamicCredentialForm
									fields={template.connectionCredentialFields}
									values={credentialValues}
									onChange={onCredentialValuesChange}
									showErrors={showErrors}
								/>
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
						{template?.connectionCreationMode === "oauth_redirect"
							? "Re-authorize"
							: "Update Connection"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
