// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

"use client";

import { DestructiveConfirm } from "@/components/shared/DestructiveConfirm";
import { Button } from "@/components/ui/button";
import { useDeleteService } from "@/lib/api/hooks";

export interface DeleteServiceDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	serviceId: string;
	serviceName: string;
	/** Services this one calls. */
	upstream?: string[];
	/** Services that call this one. */
	downstream?: string[];
	/** Where the dependency links stand; a delete waits until they have loaded (#805). */
	links?: "pending" | "error" | "success";
	onRetryLinks?: () => void;
	onSuccess?: () => void;
}

function names(list: string[]): string {
	const shown = list.length > 3 ? list.slice(0, 2) : list;
	const rest = list.length - shown.length;
	const words = rest > 0 ? [...shown, `${rest} more`] : shown;
	return words.length > 1
		? `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`
		: (words[0] ?? "");
}

/**
 * The dependency links a delete removes with the service (#673 walk 4, QA-11):
 * `book-metadata depends on it. It depends on postgres.`, or null with none.
 */
export function dependencyImpact(
	upstream: string[],
	downstream: string[],
): string | null {
	const parts: string[] = [];
	if (downstream.length)
		parts.push(
			`${names(downstream)} ${downstream.length === 1 ? "depends" : "depend"} on it.`,
		);
	if (upstream.length) parts.push(`It depends on ${names(upstream)}.`);
	if (parts.length === 0) return null;
	const links = upstream.length + downstream.length;
	return `Its ${links === 1 ? "dependency link goes" : `${links} dependency links go`} too: ${parts.join(" ")}`;
}

export function DeleteServiceDialog({
	open,
	onOpenChange,
	serviceId,
	serviceName,
	upstream = [],
	downstream = [],
	links = "success",
	onRetryLinks,
	onSuccess,
}: DeleteServiceDialogProps) {
	const deleteService = useDeleteService();
	const impact = dependencyImpact(upstream, downstream);

	const handleDelete = async () => {
		await deleteService.mutateAsync({ id: serviceId });
		onSuccess?.();
	};

	return (
		<DestructiveConfirm
			open={open}
			onOpenChange={onOpenChange}
			title="Delete service?"
			description={
				<>
					<p>
						This removes <strong>{serviceName}</strong> from the catalog.
						Incidents that named it keep their record.
					</p>
					{links === "error" ? (
						<p data-testid="delete-service-links-error">
							Couldn't load this service's dependency links. Any it has go with
							it.{" "}
							{onRetryLinks && (
								<Button variant="text" size="sm" onClick={onRetryLinks}>
									Retry
								</Button>
							)}
						</p>
					) : (
						links === "success" &&
						impact && <p data-testid="delete-service-links">{impact}</p>
					)}
				</>
			}
			confirmLabel="Delete"
			onConfirm={handleDelete}
			isPending={deleteService.isPending}
			isLoading={links === "pending"}
		/>
	);
}
