// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

"use client";

import {
	enumOptions,
	PRIORITY_LABEL,
	type Priority,
	PrioritySchema,
	SEVERITY_LABEL,
	type Severity,
	SeveritySchema,
} from "@prismalens/contracts";
import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Field } from "@/components/settings/Field";
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
	/** The service picked when the dialog opens, from a sidebar group's + (#743). */
	defaultServiceId?: string;
}

const SEVERITIES = enumOptions(SeveritySchema, SEVERITY_LABEL);

const PRIORITIES = enumOptions(PrioritySchema, PRIORITY_LABEL);

/** Select forbids an empty-string item value, so "no service" needs a sentinel. */
const NO_SERVICE = "none";

const DEFAULT_SEVERITY: Severity = "medium";
const DEFAULT_PRIORITY: Priority = "p3";

/**
 * Author an incident by hand.
 *
 * This is the entry point for C10, demonstrating the product on an install
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
	defaultServiceId,
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
			setServiceId(defaultServiceId ?? NO_SERVICE);
			setError(null);
		}
	}, [open, defaultServiceId]);

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();

		const trimmedTitle = title.trim();
		if (!trimmedTitle) {
			setError("An incident needs a title.");
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
				err instanceof Error ? err.message : "The incident was not created.",
			);
		}
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent data-testid="create-incident-dialog">
				<form onSubmit={handleSubmit} className="grid gap-4">
					<DialogHeader>
						<DialogTitle>New incident</DialogTitle>
						<DialogDescription>
							By hand, to try a run before an alert source is wired up.
						</DialogDescription>
					</DialogHeader>

					<Field label="Title" htmlFor="incident-title">
						<Input
							id="incident-title"
							data-testid="create-incident-title"
							placeholder="Checkout latency spike after 14:00 UTC"
							value={title}
							onChange={(e) => setTitle(e.target.value)}
							disabled={isPending}
							required
						/>
					</Field>

					<Field
						label="Description"
						note="optional"
						htmlFor="incident-description"
					>
						<Textarea
							id="incident-description"
							data-testid="create-incident-description"
							placeholder="What is happening, and what makes you think so?"
							value={description}
							onChange={(e) => setDescription(e.target.value)}
							disabled={isPending}
							rows={3}
							className="resize-none"
						/>
					</Field>

					<div className="grid grid-cols-2 gap-3">
						<Field label="Severity" htmlFor="incident-severity">
							<Select
								value={severity}
								onValueChange={(v) => setSeverity(v as Severity)}
								disabled={isPending}
							>
								<SelectTrigger id="incident-severity" className="w-full">
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
						</Field>
						<Field label="Priority" htmlFor="incident-priority">
							<Select
								value={priority}
								onValueChange={(v) => setPriority(v as Priority)}
								disabled={isPending}
							>
								<SelectTrigger id="incident-priority" className="w-full">
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
						</Field>
					</div>

					<Field
						label="Service"
						htmlFor="incident-service"
						hint="A run reads the service's code; without one it runs unmapped"
					>
						<Select
							value={serviceId}
							onValueChange={setServiceId}
							disabled={isPending}
						>
							<SelectTrigger id="incident-service" className="w-full">
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
					</Field>

					<DialogFooter className="items-center">
						<div className="mr-auto min-h-5 min-w-0 flex-1">
							{error && (
								<p
									className="text-meta text-danger"
									data-testid="create-incident-error"
									role="alert"
								>
									{error}
								</p>
							)}
						</div>
						<Button
							type="button"
							variant="text"
							onClick={() => onOpenChange(false)}
							disabled={isPending}
						>
							Cancel
						</Button>
						<Button
							type="submit"
							variant="primary"
							data-testid="create-incident-submit"
							disabled={!title.trim() || isPending}
						>
							{isPending && (
								<Loader2 className="size-3.5 motion-safe:animate-spin" />
							)}
							Create
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
