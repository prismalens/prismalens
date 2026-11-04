// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useDeferredValue, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useServices } from "@/lib/api/hooks";
import { orpc } from "@/lib/api/orpc-client";
import { getErrorMessage } from "@/lib/get-error-message";
import { needsFind } from "@/lib/needs-find";

/**
 * A blank incident's service, picked from the ones PrismaLens knows. Past one page of
 * the catalog it searches the server; a failed link says so and clears the pick (#1020).
 */
export function LinkService({ incidentId }: { incidentId: string }) {
	const [find, setFind] = useState("");
	const search = useDeferredValue(find.trim());
	const services = useServices(search ? { search } : undefined);
	const [picked, setPicked] = useState("");
	const { toast } = useToast();
	const queryClient = useQueryClient();
	const link = useMutation({
		...orpc.incidents.update.mutationOptions(),
		onSuccess: () =>
			queryClient.invalidateQueries({ queryKey: orpc.incidents.key() }),
		onError: (error) => {
			setPicked("");
			toast({
				title: "Service not linked",
				description: getErrorMessage(error),
				variant: "destructive",
			});
		},
	});
	const list = services.data?.data ?? [];
	const finding = needsFind(services.data, find);
	if (services.isError)
		return (
			<p
				className="flex items-center gap-2 text-body text-danger"
				role="alert"
				data-testid="incident-link-service-error"
			>
				{getErrorMessage(services.error)}
				<Button
					variant="text"
					size="sm"
					onClick={() => void services.refetch()}
					data-testid="incident-link-service-retry"
				>
					Retry
				</Button>
			</p>
		);
	if (list.length === 0 && !finding) return null;
	return (
		<div className="flex flex-wrap items-center gap-1.5">
			{finding && (
				<Input
					value={find}
					onChange={(e) => setFind(e.target.value)}
					placeholder="Find a service"
					aria-label="Find a service"
					className="w-44"
					data-testid="incident-link-service-find"
				/>
			)}
			<Select
				value={picked}
				disabled={link.isPending}
				onValueChange={(serviceId) => {
					setPicked(serviceId);
					link.mutate({ id: incidentId, serviceId });
				}}
			>
				<SelectTrigger
					aria-label="Link service"
					className="w-56"
					data-testid="incident-link-service"
				>
					<SelectValue placeholder="Link service" />
				</SelectTrigger>
				<SelectContent>
					{list.map((s) => (
						<SelectItem
							key={s.id}
							value={s.id}
							data-testid={`incident-link-service-${s.id}`}
						>
							{s.displayName || s.name}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
		</div>
	);
}
