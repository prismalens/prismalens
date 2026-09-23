// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../../lib/utils";
import { TableCell, TableRow } from "./table";

interface EmptyStateProps {
	icon?: LucideIcon;
	iconClassName?: string;
	title: string;
	description?: string;
	actions?: ReactNode;
	variant?: "standalone" | "table-cell";
	colSpan?: number;
}

function EmptyStateContent({
	icon: Icon,
	iconClassName,
	title,
	description,
	actions,
}: Omit<EmptyStateProps, "variant" | "colSpan">) {
	return (
		<div className="flex flex-wrap items-center justify-center gap-3 rounded-md border border-dashed p-4 text-muted-foreground">
			<div className="flex items-center gap-3">
				{Icon && <Icon className={cn("h-8 w-8 opacity-50", iconClassName)} />}
				<p className="text-record">
					{title}
					{description ? ` ${description}` : ""}
				</p>
			</div>
			{actions}
		</div>
	);
}

export function EmptyState({
	variant = "standalone",
	colSpan,
	...props
}: EmptyStateProps) {
	if (variant === "table-cell") {
		return (
			<TableRow>
				<TableCell colSpan={colSpan} className="p-4">
					<EmptyStateContent {...props} />
				</TableCell>
			</TableRow>
		);
	}

	return <EmptyStateContent {...props} />;
}
