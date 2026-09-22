// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Loader2 } from "lucide-react";
import { type ReactNode, useId, useState } from "react";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MutationError } from "./MutationError";

export interface DestructiveConfirmProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	title: string;
	description: ReactNode;
	/** The verb on the red button. Same word as the thing that opened the dialog. */
	confirmLabel: string;
	onConfirm: () => void;
	onCancel?: () => void;
	isPending?: boolean;
	/** Disables the confirm button while something the body needs is still loading. */
	isLoading?: boolean;
	error?: Error | string | null;
	/** When set, the operator must type this word before the confirm button enables. */
	confirmWord?: string;
	/** Extra body: an impact summary, a list of what goes with it. */
	children?: ReactNode;
}

/**
 * The one destructive confirmation. Every delete and reset in the app is this dialog
 * with a different title, body and verb; a typed acknowledgement is a parameter.
 */
export function DestructiveConfirm({
	open,
	onOpenChange,
	title,
	description,
	confirmLabel,
	onConfirm,
	onCancel,
	isPending = false,
	isLoading = false,
	error,
	confirmWord,
	children,
}: DestructiveConfirmProps) {
	const [typed, setTyped] = useState("");
	const inputId = useId();
	const armed = !confirmWord || typed === confirmWord;

	const handleOpenChange = (next: boolean) => {
		if (!next) setTyped("");
		onOpenChange(next);
	};

	return (
		<AlertDialog open={open} onOpenChange={handleOpenChange}>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>{title}</AlertDialogTitle>
					<AlertDialogDescription asChild>
						<div className="space-y-2 text-sm text-muted-foreground">
							{description}
						</div>
					</AlertDialogDescription>
				</AlertDialogHeader>

				{children}

				{confirmWord && (
					<div className="space-y-2">
						<Label htmlFor={inputId}>
							Type{" "}
							<span className="font-mono font-semibold text-foreground">
								{confirmWord}
							</span>{" "}
							to confirm
						</Label>
						<Input
							id={inputId}
							value={typed}
							onChange={(e) => setTyped(e.target.value)}
							placeholder={confirmWord}
							autoComplete="off"
							className="font-mono"
						/>
					</div>
				)}

				<MutationError
					error={typeof error === "string" ? new Error(error) : (error ?? null)}
				/>

				<AlertDialogFooter>
					<AlertDialogCancel
						onClick={() => {
							setTyped("");
							onCancel?.();
						}}
					>
						Cancel
					</AlertDialogCancel>
					<AlertDialogAction
						onClick={onConfirm}
						className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
						disabled={!armed || isPending || isLoading}
					>
						{isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
						{confirmLabel}
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
