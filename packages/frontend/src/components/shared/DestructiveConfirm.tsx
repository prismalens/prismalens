// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Loader2 } from "lucide-react";
import { type MouseEvent, type ReactNode, useId, useState } from "react";
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
import { buttonVariants } from "@/components/ui/button";
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
	/**
	 * Return the mutation's promise to keep the dialog open until it settles: it closes on
	 * success and shows the error inside on failure. A void return closes at once.
	 */
	onConfirm: () => unknown;
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

function isThenable(value: unknown): value is PromiseLike<unknown> {
	return (
		typeof value === "object" &&
		value !== null &&
		typeof (value as { then?: unknown }).then === "function"
	);
}

/**
 * Runs the confirm handler. Returns false when it settled synchronously (the dialog closes
 * as before), or the settling promise after calling `onPending` (the dialog stays open).
 */
export function runConfirm(
	onConfirm: () => unknown,
	handlers: {
		onPending: () => void;
		onSuccess: () => void;
		onFailure: (error: Error) => void;
	},
): false | Promise<void> {
	const result = onConfirm();
	if (!isThenable(result)) return false;
	handlers.onPending();
	return Promise.resolve(result).then(handlers.onSuccess, (e: unknown) =>
		handlers.onFailure(e instanceof Error ? e : new Error(String(e))),
	);
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
	const [settling, setSettling] = useState(false);
	const [failure, setFailure] = useState<Error | null>(null);
	const inputId = useId();
	const armed = !confirmWord || typed === confirmWord;
	const pending = isPending || settling;
	const shownError =
		(typeof error === "string" ? new Error(error) : error) ?? failure;

	const handleOpenChange = (next: boolean) => {
		if (!next && settling) return;
		if (!next) {
			setTyped("");
			setFailure(null);
		}
		onOpenChange(next);
	};

	const handleConfirm = (event: MouseEvent) => {
		setFailure(null);
		const settled = runConfirm(onConfirm, {
			onPending: () => setSettling(true),
			onSuccess: () => {
				setSettling(false);
				setTyped("");
				onOpenChange(false);
			},
			onFailure: (e) => {
				setSettling(false);
				setFailure(e);
			},
		});
		if (settled) event.preventDefault();
	};

	return (
		<AlertDialog open={open} onOpenChange={handleOpenChange}>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>{title}</AlertDialogTitle>
					<AlertDialogDescription asChild>
						{/* What goes with it reads as rows, never a bulleted list. */}
						<div className="space-y-2 text-body text-text-2 [&_li]:py-1 [&_li]:text-text-1 [&_ul]:list-none [&_ul]:p-0">
							{description}
						</div>
					</AlertDialogDescription>
				</AlertDialogHeader>

				{children}

				{confirmWord && (
					<div className="space-y-2">
						<Label htmlFor={inputId}>
							Type <span className="font-mono text-text-1">{confirmWord}</span>{" "}
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

				<MutationError error={shownError} />

				<AlertDialogFooter>
					<AlertDialogCancel
						onClick={() => {
							setTyped("");
							setFailure(null);
							onCancel?.();
						}}
						disabled={settling}
					>
						Cancel
					</AlertDialogCancel>
					<AlertDialogAction
						onClick={handleConfirm}
						className={buttonVariants({ variant: "danger-fill" })}
						disabled={!armed || pending || isLoading}
					>
						{pending && (
							<Loader2 className="h-3.5 w-3.5 motion-safe:animate-spin" />
						)}
						{confirmLabel}
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
