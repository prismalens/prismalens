// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Link2 } from "lucide-react";
import { type FormEvent, useState } from "react";
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
import { cn } from "@/lib/utils";

/** The service an unmapped alert's project gets: one of that name, or a new one. */
export function linkPlan(
	name: string,
	services: readonly { id: string; name: string }[],
): { serviceId: string } | { create: string } {
	const found = services.find((s) => s.name === name);
	return found ? { serviceId: found.id } : { create: name };
}

/**
 * Link to a project, on an unmapped alert's row (#1020): picks a project and gives it a
 * service by name; alerts reach it by the existing `service=<name>` rule, shown read-only.
 */
export function LinkToProject({
	labels,
	className,
}: {
	labels: Record<string, string> | null;
	className?: string;
}) {
	const [open, setOpen] = useState(false);
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
			{open && (
				<LinkDialog suggested={labels?.service ?? ""} onOpenChange={setOpen} />
			)}
		</>
	);
}

function LinkDialog({
	suggested,
	onOpenChange,
}: {
	suggested: string;
	onOpenChange: (open: boolean) => void;
}) {
	const repos = useRepositories({ limit: 100 });
	const create = useCreateService();
	const link = useLinkRepository();
	const queryClient = useQueryClient();
	const [repositoryId, setRepositoryId] = useState<string>();
	const [name, setName] = useState(suggested);
	const [error, setError] = useState<string | null>(null);
	const projects = repos.data?.data ?? [];
	const picked = projects.find((p) => p.id === repositoryId);
	const shown = name.trim() || picked?.fullName || "";
	const busy = create.isPending || link.isPending;
	const onLink = async (e: FormEvent) => {
		e.preventDefault();
		if (!repositoryId || !shown) return;
		setError(null);
		try {
			// Ask the server by name: a page of the catalog may not hold it.
			const found = await client.services.list({ search: shown, limit: 100 });
			const plan = linkPlan(shown, found.data);
			const serviceId =
				"serviceId" in plan
					? plan.serviceId
					: (await create.mutateAsync({ name: plan.create })).id;
			await link.mutateAsync({ id: repositoryId, serviceId });
			// A new service claims the waiting alerts its label names; the lists read that.
			void queryClient.invalidateQueries({ queryKey: orpc.alerts.key() });
			void queryClient.invalidateQueries({ queryKey: orpc.incidents.key() });
			onOpenChange(false);
		} catch (err) {
			setError(getErrorMessage(err));
		}
	};
	return (
		<Dialog open onOpenChange={onOpenChange}>
			<DialogContent
				className={cn(DIALOG_WIDTH.sm, "grid gap-3")}
				data-testid="link-project-dialog"
			>
				<DialogTitle>Link to a project</DialogTitle>
				{repos.data && projects.length === 0 ? (
					<p className="text-body text-text-2">
						No projects yet.{" "}
						<Link to="/projects" className="text-text-1 underline">
							Add project
						</Link>
					</p>
				) : (
					<form onSubmit={(e) => void onLink(e)} className="grid gap-3">
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
							onChange={(e) => setName(e.target.value)}
							placeholder={picked?.fullName ?? "Service name"}
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
