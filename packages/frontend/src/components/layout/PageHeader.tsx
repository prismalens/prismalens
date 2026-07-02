import { Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";

interface PageHeaderProps {
	title: string;
	subtitle?: ReactNode;
	actions?: ReactNode;
	backLink?: { label: string; to: string };
}

export function PageHeader({
	title,
	subtitle,
	actions,
	backLink,
}: PageHeaderProps) {
	return (
		<div>
			{backLink && (
				<Link
					to={backLink.to}
					className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-4"
				>
					<ArrowLeft className="h-4 w-4" />
					{backLink.label}
				</Link>
			)}
			<div className="flex justify-between items-center">
				<div>
					<h1 className="text-2xl font-bold text-foreground">{title}</h1>
					{subtitle && (
						<p className="text-sm text-muted-foreground mt-1">{subtitle}</p>
					)}
				</div>
				{actions && <div className="flex items-center gap-2">{actions}</div>}
			</div>
		</div>
	);
}
