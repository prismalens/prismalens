// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { TopologyEdge } from "@prismalens/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { MoreHorizontal } from "lucide-react";
import { useState } from "react";
import { MutationError } from "@/components/shared/MutationError";
import { RecordSection } from "@/components/shared/RecordSection";
import { Segmented } from "@/components/shared/Segmented";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { orpc, useAddServiceDependency, useServices } from "@/lib/api/hooks";
import { kindWord } from "./service-detail.utils";

type Direction = "upstream" | "downstream";

/**
 * Dependencies (decision 1): what this service calls (upstream) and what
 * calls it (downstream), each named by its kind, so a database or a gateway
 * reads as one.
 */
export function ServiceDependenciesSection({
	serviceId,
	topology,
	onRemove,
}: {
	serviceId: string;
	topology?: { upstream: TopologyEdge[]; downstream: TopologyEdge[] };
	onRemove: (edge: { from: string; to: string }) => void;
}) {
	const [adding, setAdding] = useState(false);
	const [other, setOther] = useState("");
	const [direction, setDirection] = useState<Direction>("upstream");
	const add = useAddServiceDependency();
	const queryClient = useQueryClient();
	const { data: services } = useServices({ limit: 100 });
	const rows = [
		...(topology?.upstream ?? []).map((e) => ({
			edge: e,
			direction: "upstream" as const,
		})),
		...(topology?.downstream ?? []).map((e) => ({
			edge: e,
			direction: "downstream" as const,
		})),
	];
	const linked = new Set(rows.map((r) => r.edge.service.id));
	const candidates = (services?.data ?? []).filter(
		(s) => s.id !== serviceId && !linked.has(s.id),
	);
	const save = () => {
		if (!other) return;
		// Upstream: this service depends on the other; downstream: the reverse.
		const [id, dependencyId] =
			direction === "upstream" ? [serviceId, other] : [other, serviceId];
		add.mutate(
			{ id, dependencyId },
			{
				onSuccess: () => {
					setAdding(false);
					setOther("");
					// A downstream edge is the other service's; this page's topology moves too.
					queryClient.invalidateQueries({ queryKey: orpc.services.key() });
				},
			},
		);
	};
	return (
		<RecordSection
			id="dependencies"
			title="Dependencies"
			count={rows.length || undefined}
			actions={
				!adding && (
					<Button
						variant="text"
						size="sm"
						onClick={() => setAdding(true)}
						data-testid="add-dependency"
					>
						Add
					</Button>
				)
			}
		>
			{rows.length === 0 && !adding && (
				<p className="text-body text-text-2">None recorded.</p>
			)}
			<ul className="divide-y divide-hairline">
				{rows.map(({ edge, direction: d }) => (
					<li
						key={`${d}-${edge.service.id}`}
						className="flex items-center gap-3 py-2.5"
						data-testid="service-dependency-row"
					>
						<p className="min-w-0 flex-1 text-body">
							<Link
								to="/services/$id"
								params={{ id: edge.service.id }}
								className="text-text-1 hover:underline"
							>
								{edge.service.name}
							</Link>{" "}
							<span
								className="text-meta text-text-3"
								data-testid="dependency-kind"
							>
								{kindWord(edge.service.type)}, {d}
							</span>
						</p>
						<Button
							variant="danger"
							size="sm"
							onClick={() =>
								onRemove(
									d === "upstream"
										? { from: serviceId, to: edge.service.id }
										: { from: edge.service.id, to: serviceId },
								)
							}
						>
							Remove
						</Button>
					</li>
				))}
			</ul>
			{adding && (
				<div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
					<Select value={other} onValueChange={setOther}>
						<SelectTrigger
							aria-label="Service"
							data-testid="dependency-service"
						>
							<SelectValue placeholder="A service" />
						</SelectTrigger>
						<SelectContent>
							{candidates.map((s) => (
								<SelectItem key={s.id} value={s.id}>
									{s.name}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
					<Segmented
						label="Direction"
						value={direction}
						onChange={setDirection}
						options={[
							{ value: "upstream", label: "Upstream" },
							{ value: "downstream", label: "Downstream" },
						]}
						testId="dependency-direction"
					/>
					<Button
						variant="secondary"
						disabled={!other || add.isPending}
						onClick={save}
						data-testid="dependency-save"
					>
						Add
					</Button>
					<Button variant="text" onClick={() => setAdding(false)}>
						Cancel
					</Button>
				</div>
			)}
			<MutationError error={add.error} className="mt-2" />
		</RecordSection>
	);
}
