// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Link2 } from "lucide-react";
import { type FormEvent, useDeferredValue, useRef, useState } from "react";
import { Hint } from "@/components/shared/Hint";
import { Button } from "@/components/ui/button";
import {
	DIALOG_WIDTH,
	Dialog,
	DialogContent,
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
import { useRepositories } from "@/lib/api/hooks";
import { useLinkRepository } from "@/lib/api/hooks/use-repositories-orpc";
import { useCreateService } from "@/lib/api/hooks/use-services-orpc";
import { client, orpc } from "@/lib/api/orpc-client";
import { getErrorMessage } from "@/lib/get-error-message";
import { needsFind } from "@/lib/needs-find";
import { cn } from "@/lib/utils";

/** The service an unmapped alert's project gets: one of that name, or a new one. */
export function linkPlan(
	name: string,
	services: readonly { id: string; name: string }[],
): { serviceId: string } | { create: string } {
	const found = services.find((s) => s.name === name);
	return found ? { serviceId: found.id } : { create: name };
}

/** The service an alert reaches by the `service=<name>` rule; without that label, linking maps nothing. */
export function linkName(
	labels: Record<string, string> | null | undefined,
): string | null {
	return labels?.service?.trim() || null;
}

/**
 * Link to a project, on an unmapped alert's row (#1020): picks a project and gives it a
 * service named by the alert's `service` label, which is how the alert reaches it.
 */
export function LinkToProject({
	labels,
	className,
}: {
	labels: Record<string, string> | null;
	className?: string;
}) {
	const [open, setOpen] = useState(false);
	const name = linkName(labels);
	if (!name) return null;
	return (
		<>
			<Hint label="Link to a project" side="left">
				<button
					type="button"
					aria-label="Link to a project"
					onClick={() => setOpen(true)}
					className={cn(
						"flex size-6 items-center justify-center rounded-control bg-surface-3 text-text-2 hover:bg-surface-4 hover:text-text-1",
						className,
					)}
					data-testid="alert-link-project"
				>
					<Link2 className="size-3.5" />
				</button>
			</Hint>
			{open && <LinkDialog name={name} onOpenChange={setOpen} />}
		</>
	);
}

function LinkDialog({
	name,
	onOpenChange,
}: {
	name: string;
	onOpenChange: (open: boolean) => void;
}) {
	const [find, setFind] = useState("");
	const search = useDeferredValue(find.trim());
	const repos = useRepositories({
		limit: 100,
		...(search ? { search } : {}),
	});
	const create = useCreateService();
	const link = useLinkRepository();
	const queryClient = useQueryClient();
	const [repositoryId, setRepositoryId] = useState<string>();
	const [error, setError] = useState<string | null>(null);
	// The service a failed link left behind: a retry links it again, never makes a second.
	const [made, setMade] = useState<string>();
	const projects = repos.data?.data ?? [];
	const shown = name;
	// A ref, not state: a second submit lands before a state update would show.
	const inFlight = useRef(false);
	const [submitting, setSubmitting] = useState(false);
	const busy = submitting || create.isPending || link.isPending;
	const onLink = async (e: FormEvent) => {
		e.preventDefault();
		if (!repositoryId || !shown || inFlight.current) return;
		inFlight.current = true;
		setSubmitting(true);
		setError(null);
		try {
			let serviceId = made;
			if (!serviceId) {
				// Ask the server by name: a page of the catalog may not hold it.
				const found = await client.services.list({
					search: shown,
					limit: 100,
				});
				const plan = linkPlan(shown, found.data);
				if ("serviceId" in plan) serviceId = plan.serviceId;
				else {
					serviceId = (await create.mutateAsync({ name: plan.create })).id;
					setMade(serviceId);
				}
			}
			await link.mutateAsync({ id: repositoryId, serviceId });
			// A new service claims the waiting alerts its label names; the lists read that.
			void queryClient.invalidateQueries({ queryKey: orpc.alerts.key() });
			void queryClient.invalidateQueries({ queryKey: orpc.incidents.key() });
			onOpenChange(false);
		} catch (err) {
			setError(getErrorMessage(err));
		} finally {
			inFlight.current = false;
			setSubmitting(false);
		}
	};
	return (
		<Dialog open onOpenChange={onOpenChange}>
			<DialogContent
				className={cn(DIALOG_WIDTH.sm, "grid gap-3")}
				data-testid="link-project-dialog"
			>
				<DialogTitle>Link to a project</DialogTitle>
				{repos.isError ? (
					<p
						className="flex items-center gap-2 text-body text-danger"
						role="alert"
						data-testid="link-project-error"
					>
						{getErrorMessage(repos.error)}
						<Button
							variant="text"
							size="sm"
							onClick={() => void repos.refetch()}
							data-testid="link-project-retry"
						>
							Retry
						</Button>
					</p>
				) : repos.data && projects.length === 0 && !search ? (
					<p className="text-body text-text-2">
						No projects yet.{" "}
						<Link to="/projects" className="text-text-1 underline">
							Add project
						</Link>
					</p>
				) : (
					<form onSubmit={(e) => void onLink(e)} className="grid gap-3">
						{needsFind(repos.data, find) && (
							<Input
								value={find}
								onChange={(e) => setFind(e.target.value)}
								placeholder="Find a project"
								aria-label="Find a project"
								data-testid="link-project-find"
							/>
						)}
						<Select value={repositoryId} onValueChange={setRepositoryId}>
							<SelectTrigger
								aria-label="Project"
								data-testid="link-project-pick"
							>
								<SelectValue placeholder="Project" />
							</SelectTrigger>
							<SelectContent>
								{projects.map((p) => (
									<SelectItem
										key={p.id}
										value={p.id}
										data-testid={`link-project-${p.id}`}
									>
										{p.fullName}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
						<Input
							value={name}
							readOnly
							aria-label="Service name"
							data-testid="link-project-name"
						/>
						<p
							className="ml-1 font-mono text-meta text-text-3"
							data-testid="link-project-rule"
						>
							service={shown || "<name>"}
						</p>
						{error && (
							<p className="ml-1 text-meta text-danger" role="alert">
								{error}
							</p>
						)}
						<Button
							type="submit"
							disabled={!repositoryId || !shown || busy}
							data-testid="link-project-submit"
						>
							Link
						</Button>
					</form>
				)}
			</DialogContent>
		</Dialog>
	);
}
