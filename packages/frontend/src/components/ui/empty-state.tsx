import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { TableCell, TableRow } from "./table";
import { cn } from "../../lib/utils";

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
		<div className="flex flex-col items-center gap-2 text-muted-foreground py-8">
			{Icon && <Icon className={cn("h-10 w-10", iconClassName)} />}
			<p className="font-medium">{title}</p>
			{description && <p className="text-sm">{description}</p>}
			{actions && <div className="mt-2">{actions}</div>}
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
				<TableCell colSpan={colSpan} className="h-24 text-center">
					<EmptyStateContent {...props} />
				</TableCell>
			</TableRow>
		);
	}

	return <EmptyStateContent {...props} />;
}
