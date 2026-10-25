// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { SourcesPreRun } from "@prismalens/contracts";
import { useQueries } from "@tanstack/react-query";
import { TriangleAlert } from "lucide-react";
import { KindIcon, kindLabel } from "@/components/settings/source-words";
import { orpc } from "@/lib/api/orpc-client";
import { cn } from "@/lib/utils";

const KINDS = ["prometheus", "alertmanager", "loki"] as const;

export interface MatrixCell {
	/** The connection read, or the state when none is. */
	text: string;
	sub?: string;
	warn?: boolean;
}

/**
 * One cell, exactly as the run's resolver answered for that deployment
 * (`GET /sources/pre-run`, C16a); the client never works a selection out.
 */
export function matrixCell(
	answer: SourcesPreRun | undefined,
	kind: string,
): MatrixCell | null {
	if (!answer) return null;
	const k = answer.kinds.find((x) => x.kind === kind);
	if (!k || k.notConfigured) return { text: "Not set up" };
	if (k.skipped) return { text: "Choose one", warn: true };
	const unit = k.units[0];
	if (!unit) return { text: "Not set up" };
	const rule = unit.selection?.rule;
	if (unit.from === "env" || rule === "env")
		return { text: "From environment" };
	if (rule === "other-tag" && unit.deployment)
		return { text: unit.label, sub: `${unit.deployment} data`, warn: true };
	if (rule === "tag-match") return { text: unit.label };
	return { text: unit.label, sub: "Any deployment" };
}

/** Kinds against deployments; the last column is a run whose incident names none. */
export function ServiceConnectionsMatrix({
	serviceId,
	deployments,
}: {
	serviceId: string;
	deployments: string[];
}) {
	const columns: (string | null)[] = [...deployments, null];
	const answers = useQueries({
		queries: columns.map((d) =>
			orpc.sources.preRun.queryOptions({
				input: { serviceId, ...(d ? { deployment: d } : {}) },
				staleTime: 30_000,
			}),
		),
	});
	return (
		<div data-testid="service-matrix">
			<h3 className="mb-2 text-heading">By deployment</h3>
			<div className="overflow-x-auto">
				<table
					aria-label="Connections by deployment"
					className="grid min-w-[560px] gap-1.5"
					style={{
						gridTemplateColumns: `9rem repeat(${columns.length}, minmax(7rem, 1fr))`,
					}}
				>
					<thead className="contents">
						<tr className="contents text-meta text-text-2">
							<th>
								<span className="sr-only">Kind</span>
							</th>
							{columns.map((d) => (
								<th key={d ?? "-"} className="px-1 text-left font-medium">
									{d ?? "Not named"}
								</th>
							))}
						</tr>
					</thead>
					<tbody className="contents">
						{KINDS.map((kind) => (
							<tr key={kind} className="contents">
								<th className="flex items-center gap-2 pr-2 text-left font-semibold">
									<KindIcon kind={kind} small />
									{kindLabel(kind)}
								</th>
								{columns.map((d, i) => {
									const q = answers[i];
									const cell = matrixCell(q?.data, kind);
									return (
										<td
											key={d ?? "-"}
											className={cn(
												"raised flex min-h-14 flex-col justify-center rounded-pool px-3 py-2",
												cell?.warn && "bg-warn/10",
											)}
											data-testid="matrix-cell"
										>
											{q?.isError ? (
												<span className="text-meta text-text-2">
													Did not load
												</span>
											) : !cell ? (
												<span className="text-meta text-text-3">…</span>
											) : (
												<>
													<span className="block truncate font-semibold">
														{cell.text}
													</span>
													{cell.sub && (
														<span
															className={cn(
																"flex items-center gap-1 text-meta",
																cell.warn ? "text-warn" : "text-text-2",
															)}
														>
															{cell.warn && (
																<TriangleAlert className="size-3" aria-hidden />
															)}
															{cell.sub}
														</span>
													)}
												</>
											)}
										</td>
									);
								})}
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</div>
	);
}
