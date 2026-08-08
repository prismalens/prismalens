// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

"use client";

import type { Priority, Severity } from "@prismalens/contracts";
import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
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
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useCreateIncident, useServices } from "@/lib/api/hooks";

export interface CreateIncidentDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** Called with the id of the incident the API just created. */
	onCreated?: (incidentId: string) => void;
}

const SEVERITIES: { value: Severity; label: string }[] = [
	{ value: "critical", label: "Critical" },
	{ value: "high", label: "High" },
	{ value: "medium", label: "Medium" },
	{ value: "low", label: "Low" },
	{ value: "info", label: "Info" },
];

const PRIORITIES: { value: Priority; label: string }[] = [
	{ value: "p1", label: "P1" },
	{ value: "p2", label: "P2" },
	{ value: "p3", label: "P3" },
	{ value: "p4", label: "P4" },
	{ value: "p5", label: "P5" },
];

/** Select forbids an empty-string item value, so "no service" needs a sentinel. */
const NO_SERVICE = "none";

const DEFAULT_SEVERITY: Severity = "medium";
const DEFAULT_PRIORITY: Priority = "p3";

/**
 * Author an incident by hand.
 *
 * This is the entry point for C10 — demonstrating the product on an install
 * that has no alert source wired yet. It calls the same `incidents.create`
 * procedure the correlation engine calls, so a hand-authored incident is an
 * ordinary incident: it can be acknowledged, investigated, and resolved.
 *
 * Picking a service is optional but load-bearing for what comes next: an
 * investigation resolves which code it reads from the incident's service and
 * that service's local checkout. An incident with no service investigates
 * UNMAPPED.
 */
export function CreateIncidentDialog({
	open,
	onOpenChange,
	onCreated,
}: CreateIncidentDialogProps) {
	const [title, setTitle] = useState("");
	const [description, setDescription] = useState("");
	const [severity, setSeverity] = useState<Severity>(DEFAULT_SEVERITY);
	const [priority, setPriority] = useState<Priority>(DEFAULT_PRIORITY);
	const [serviceId, setServiceId] = useState<string>(NO_SERVICE);
	const [error, setError] = useState<string | null>(null);

	const { data: servicesResponse } = useServices({ limit: 100 });
	const services = servicesResponse?.data ?? [];

	const createIncident = useCreateIncident();
	const isPending = createIncident.isPending;

	// Reset on every open so a cancelled draft never leaks into the next one.
	useEffect(() => {
		if (open) {
			setTitle("");
			setDescription("");
			setSeverity(DEFAULT_SEVERITY);
			setPriority(DEFAULT_PRIORITY);
			setServiceId(NO_SERVICE);
			setError(null);
		}
	}, [open]);

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();

		const trimmedTitle = title.trim();
		if (!trimmedTitle) {
			setError("Title is required");
			return;
		}

		setError(null);

		try {
			const incident = await createIncident.mutateAsync({
				title: trimmedTitle,
				description: description.trim() || undefined,
				severity,
				priority,
				serviceId: serviceId === NO_SERVICE ? undefined : serviceId,
			});
			onOpenChange(false);
			onCreated?.(incident.id);
		} catch (err) {
			setError(
				err instanceof Error ? err.message : "Failed to create the incident",
			);
		}
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent
				className="sm:max-w-[480px]"
				data-testid="create-incident-dialog"
			>
				<form onSubmit={handleSubmit}>
					<DialogHeader>
						<DialogTitle>Create Incident</DialogTitle>
						<DialogDescription>
							Author an incident by hand — useful for trying an investigation
							before any alert source is wired up.
						</DialogDescription>
					</DialogHeader>

					<div className="grid gap-4 py-4">
						<div className="grid gap-2">
							<Label htmlFor="incident-title">Title *</Label>
							<Input
								id="incident-title"
								data-testid="create-incident-title"
								placeholder="e.g., Checkout latency spike after 14:00 UTC"
								value={title}
								onChange={(e) => setTitle(e.target.value)}
								disabled={isPending}
								required
							/>
						</div>

						<div className="grid gap-2">
							<Label htmlFor="incident-description">
								Description (optional)
							</Label>
							<Textarea
								id="incident-description"
								data-testid="create-incident-description"
								placeholder="What is happening, and what makes you think so?"
								value={description}
								onChange={(e) => setDescription(e.target.value)}
								disabled={isPending}
								rows={3}
							/>
						</div>

						<div className="grid grid-cols-2 gap-4">
							<div className="grid gap-2">
								<Label htmlFor="incident-severity">Severity</Label>
								<Select
									value={severity}
									onValueChange={(v) => setSeverity(v as Severity)}
									disabled={isPending}
								>
									<SelectTrigger id="incident-severity">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										{SEVERITIES.map((opt) => (
											<SelectItem key={opt.value} value={opt.value}>
												{opt.label}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>

							<div className="grid gap-2">
								<Label htmlFor="incident-priority">Priority</Label>
								<Select
									value={priority}
									onValueChange={(v) => setPriority(v as Priority)}
									disabled={isPending}
								>
									<SelectTrigger id="incident-priority">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										{PRIORITIES.map((opt) => (
											<SelectItem key={opt.value} value={opt.value}>
												{opt.label}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>
						</div>

						<div className="grid gap-2">
							<Label htmlFor="incident-service">Service (optional)</Label>
							<Select
								value={serviceId}
								onValueChange={setServiceId}
								disabled={isPending}
							>
								<SelectTrigger id="incident-service">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value={NO_SERVICE}>No service</SelectItem>
									{services.map((service) => (
										<SelectItem key={service.id} value={service.id}>
											{service.displayName || service.name}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
							<p className="text-xs text-muted-foreground">
								An investigation reads the code at the service's local checkout.
								Without a service it runs unmapped.
							</p>
						</div>

						{error && (
							<p
								className="text-sm text-destructive"
								data-testid="create-incident-error"
								role="alert"
							>
								{error}
							</p>
						)}
					</div>

					<DialogFooter>
						<Button
							type="button"
							variant="outline"
							onClick={() => onOpenChange(false)}
							disabled={isPending}
						>
							Cancel
						</Button>
						<Button
							type="submit"
							data-testid="create-incident-submit"
							disabled={!title.trim() || isPending}
						>
							{isPending ? (
								<>
									<Loader2 className="h-4 w-4 mr-2 animate-spin" />
									Creating...
								</>
							) : (
								"Create Incident"
							)}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
