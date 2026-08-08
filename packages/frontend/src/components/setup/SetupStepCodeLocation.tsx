// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

"use client";

/**
 * Wizard step 3 — where the code actually lives (#332).
 *
 * Consumes the service→checkout surface that landed in #352 verbatim:
 * `POST /services/validate-checkout-path` for the pre-flight verdict, then
 * `PATCH /services/:id` (or `POST /services` for a fresh instance with no
 * catalog yet) to store `localCheckoutPath`. Saving re-validates server-side,
 * so "Check" is a courtesy, never the enforcement point.
 *
 * The empty-catalog case is not an edge case here: a production first run has
 * zero services, so the step must be able to CREATE one rather than telling the
 * operator to go build a catalog first and come back.
 */

import type { CheckoutPathValidation } from "@prismalens/contracts";
import {
	AlertCircle,
	CheckCircle2,
	FolderSearch,
	Loader2,
	XCircle,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	useCreateService,
	useServices,
	useUpdateService,
	useValidateCheckoutPath,
} from "@/lib/api/hooks";

/** Sentinel for the "create a new service" option in the picker. */
const NEW_SERVICE = "__new__";

export interface SetupStepCodeLocationProps {
	onComplete: () => void;
	onSkip: () => void;
}

export function SetupStepCodeLocation({
	onComplete,
	onSkip,
}: SetupStepCodeLocationProps) {
	const { data: servicesResponse, isLoading } = useServices({ limit: 100 });
	const validate = useValidateCheckoutPath();
	const updateService = useUpdateService();
	const createService = useCreateService();

	const services = useMemo(
		() => servicesResponse?.data ?? [],
		[servicesResponse?.data],
	);
	const hasServices = services.length > 0;

	const [serviceId, setServiceId] = useState<string>("");
	const [newServiceName, setNewServiceName] = useState("");
	const [path, setPath] = useState("");
	const [validation, setValidation] = useState<CheckoutPathValidation | null>(
		null,
	);
	const [error, setError] = useState<string | null>(null);

	// Default the picker once the catalog arrives: an existing unmapped service
	// if there is one, otherwise "create a new one".
	const effectiveServiceId =
		serviceId ||
		(hasServices
			? (services.find((s) => !s.localCheckoutPath)?.id ?? services[0].id)
			: NEW_SERVICE);

	const creatingService = effectiveServiceId === NEW_SERVICE;
	const trimmedPath = path.trim();
	const busy =
		validate.isPending || updateService.isPending || createService.isPending;
	const canSave =
		trimmedPath.length > 0 &&
		(!creatingService || newServiceName.trim().length > 0);

	function resetFeedback() {
		setValidation(null);
		setError(null);
	}

	function handleCheck() {
		resetFeedback();
		validate.mutate(
			{ path: trimmedPath },
			{
				onSuccess: setValidation,
				onError: (err) => setError(err.message || "Could not check that path"),
			},
		);
	}

	async function handleSave() {
		resetFeedback();
		try {
			if (creatingService) {
				await createService.mutateAsync({
					name: newServiceName.trim(),
					localCheckoutPath: trimmedPath,
				});
			} else {
				await updateService.mutateAsync({
					id: effectiveServiceId,
					localCheckoutPath: trimmedPath,
				});
			}
			onComplete();
		} catch (err) {
			// The API returns the validator's own sentence for a refused path, so
			// this renders the actionable reason rather than a generic 400.
			setError(
				err instanceof Error
					? err.message
					: "Failed to save the local checkout",
			);
		}
	}

	return (
		<Card>
			<CardHeader className="text-center">
				<div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4">
					<FolderSearch className="h-8 w-8 text-primary" />
				</div>
				<CardTitle>
					<h2>Point PrismaLens at your code</h2>
				</CardTitle>
				<CardDescription>
					An investigation runs inside a directory on this machine. Without a
					mapping it reads whatever directory the worker happens to be in, and
					reports confident findings about the wrong tree.
				</CardDescription>
			</CardHeader>

			<CardContent className="space-y-5">
				{isLoading ? (
					<div className="flex items-center justify-center py-8">
						<Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
					</div>
				) : (
					<>
						<div className="space-y-2">
							<Label htmlFor="setup-service">Service</Label>
							<Select
								value={effectiveServiceId}
								onValueChange={(value) => {
									setServiceId(value);
									resetFeedback();
								}}
								disabled={busy}
							>
								<SelectTrigger id="setup-service">
									<SelectValue placeholder="Choose a service" />
								</SelectTrigger>
								<SelectContent>
									{services.map((service) => (
										<SelectItem key={service.id} value={service.id}>
											{service.displayName || service.name}
											{service.localCheckoutPath ? " (mapped)" : ""}
										</SelectItem>
									))}
									<SelectItem value={NEW_SERVICE}>
										Create a new service…
									</SelectItem>
								</SelectContent>
							</Select>
							{!hasServices && (
								<p className="text-xs text-muted-foreground">
									No services yet — name one below and it will be created with
									this checkout attached.
								</p>
							)}
						</div>

						{creatingService && (
							<div className="space-y-2">
								<Label htmlFor="setup-service-name">New service name</Label>
								<Input
									id="setup-service-name"
									value={newServiceName}
									spellCheck={false}
									autoComplete="off"
									placeholder="api-gateway"
									disabled={busy}
									onChange={(e) => {
										setNewServiceName(e.target.value);
										resetFeedback();
									}}
								/>
							</div>
						)}

						<div className="space-y-2">
							<Label htmlFor="setup-checkout-path">Checkout path</Label>
							<div className="flex gap-2">
								<Input
									id="setup-checkout-path"
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
									disabled={busy || trimmedPath.length === 0}
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

						{error && (
							<Alert variant="destructive">
								<AlertCircle className="h-4 w-4" />
								<AlertDescription>{error}</AlertDescription>
							</Alert>
						)}
					</>
				)}
			</CardContent>

			<CardFooter className="flex items-center justify-between gap-3">
				<Button variant="ghost" onClick={onSkip} disabled={busy}>
					Skip for now
				</Button>
				<Button onClick={handleSave} disabled={busy || !canSave}>
					{(updateService.isPending || createService.isPending) && (
						<Loader2 className="mr-2 h-4 w-4 animate-spin" />
					)}
					Save & continue
				</Button>
			</CardFooter>
		</Card>
	);
}
