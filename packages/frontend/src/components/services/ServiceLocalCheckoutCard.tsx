// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Service → local checkout mapping (#331).
 *
 * This is the field that makes an investigation real: without it the worker has
 * no idea where this service's code lives on this machine, runs in its own
 * working directory, and reports confident findings about the wrong tree. The
 * card therefore leads with the consequence, not with the input.
 *
 * Validation is server-side (it stats the path and asks git about it); "Check"
 * surfaces that verdict before saving, and saving re-runs it regardless.
 */
import type { CheckoutPathValidation } from "@prismalens/contracts";
import {
	AlertTriangle,
	CheckCircle2,
	FolderSearch,
	Loader2,
	XCircle,
} from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useUpdateService, useValidateCheckoutPath } from "@/lib/api/hooks";

interface ServiceLocalCheckoutCardProps {
	serviceId: string;
	/** The currently stored mapping; `null` means this service is unmapped. */
	localCheckoutPath: string | null;
}

export function ServiceLocalCheckoutCard({
	serviceId,
	localCheckoutPath,
}: ServiceLocalCheckoutCardProps) {
	const [path, setPath] = useState(localCheckoutPath ?? "");
	const [validation, setValidation] = useState<CheckoutPathValidation | null>(
		null,
	);
	const [saveError, setSaveError] = useState<string | null>(null);
	const [saved, setSaved] = useState(false);

	const validate = useValidateCheckoutPath();
	const updateService = useUpdateService();

	const trimmed = path.trim();
	const dirty = trimmed !== (localCheckoutPath ?? "");
	const busy = validate.isPending || updateService.isPending;

	function resetFeedback() {
		setValidation(null);
		setSaveError(null);
		setSaved(false);
	}

	function handleCheck() {
		resetFeedback();
		validate.mutate(
			{ path: trimmed },
			{
				onSuccess: setValidation,
				onError: (err) =>
					setSaveError(err.message || "Could not check that path"),
			},
		);
	}

	function handleSave(next: string | null) {
		resetFeedback();
		updateService.mutate(
			{ id: serviceId, localCheckoutPath: next },
			{
				onSuccess: () => {
					// Clear the input only once the server has accepted the clear —
					// wiping it optimistically would hide the still-stored path if the
					// request failed.
					if (next === null) setPath("");
					setSaved(true);
				},
				// The API returns the validator's own sentence on a refused path,
				// so this renders the actionable reason, not a generic 400.
				onError: (err) =>
					setSaveError(err.message || "Failed to save the local checkout"),
			},
		);
	}

	return (
		<Card>
			<CardHeader>
				{/*
				 * `CardTitle` renders a plain div, so the title carries no heading
				 * semantics on its own — the h3 gives screen readers (and the e2e
				 * spec) a real landmark for this section.
				 */}
				<CardTitle className="flex items-center gap-2">
					<FolderSearch className="h-4 w-4" aria-hidden="true" />
					<h3>Local checkout</h3>
				</CardTitle>
			</CardHeader>
			<CardContent className="space-y-4">
				<p className="text-sm text-muted-foreground">
					The directory on this machine that investigations for this service run
					in. Without it, a run reads whatever directory the worker happens to
					be in and its findings may describe the wrong code.
				</p>

				{!localCheckoutPath && (
					<p
						role="status"
						className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300"
					>
						<AlertTriangle
							className="mt-0.5 h-4 w-4 flex-shrink-0"
							aria-hidden="true"
						/>
						<span>
							No local checkout mapped — investigations for this service run
							unmapped and say so in their timeline.
						</span>
					</p>
				)}

				<div className="space-y-2">
					<Label htmlFor="local-checkout-path">Checkout path</Label>
					<div className="flex gap-2">
						<Input
							id="local-checkout-path"
							value={path}
							spellCheck={false}
							autoComplete="off"
							className="font-mono"
							placeholder="/home/you/code/api-gateway"
							disabled={busy}
							onChange={(e) => {
								setPath(e.target.value);
								resetFeedback();
							}}
						/>
						<Button
							type="button"
							variant="outline"
							disabled={busy || trimmed.length === 0}
							onClick={handleCheck}
						>
							{validate.isPending && (
								<Loader2
									className="mr-1 h-4 w-4 animate-spin"
									aria-hidden="true"
								/>
							)}
							Check
						</Button>
					</div>
					<p className="text-xs text-muted-foreground">
						An absolute path to a git checkout. A package inside a monorepo
						works too. <code className="font-mono">~</code> is expanded.
					</p>
				</div>

				{validation?.valid && (
					<p
						role="status"
						className="flex items-start gap-2 text-sm text-emerald-700 dark:text-emerald-400"
					>
						<CheckCircle2
							className="mt-0.5 h-4 w-4 flex-shrink-0"
							aria-hidden="true"
						/>
						<span>
							Valid git checkout
							{validation.repoSlug ? ` — ${validation.repoSlug}` : ""}
							{validation.isSubdirectory
								? ` (inside ${validation.repoRoot})`
								: ""}
						</span>
					</p>
				)}

				{validation && !validation.valid && (
					<p
						role="alert"
						className="flex items-start gap-2 text-sm text-destructive"
					>
						<XCircle
							className="mt-0.5 h-4 w-4 flex-shrink-0"
							aria-hidden="true"
						/>
						<span>{validation.message}</span>
					</p>
				)}

				{saveError && (
					<p
						role="alert"
						className="flex items-start gap-2 text-sm text-destructive"
					>
						<XCircle
							className="mt-0.5 h-4 w-4 flex-shrink-0"
							aria-hidden="true"
						/>
						<span>{saveError}</span>
					</p>
				)}

				{saved && (
					<p
						role="status"
						className="text-sm text-emerald-700 dark:text-emerald-400"
					>
						Saved. Investigations for this service will run in this checkout.
					</p>
				)}

				<div className="flex items-center gap-2">
					<Button
						type="button"
						disabled={busy || !dirty || trimmed.length === 0}
						onClick={() => handleSave(trimmed)}
					>
						{updateService.isPending && (
							<Loader2
								className="mr-1 h-4 w-4 animate-spin"
								aria-hidden="true"
							/>
						)}
						Save checkout
					</Button>
					{localCheckoutPath && (
						<Button
							type="button"
							variant="ghost"
							disabled={busy}
							onClick={() => handleSave(null)}
						>
							Clear mapping
						</Button>
					)}
				</div>
			</CardContent>
		</Card>
	);
}
