// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { useLocation } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { inSettings } from "@/hooks/use-back";
import { cn } from "@/lib/utils";
import { NewIncidentButton } from "./NewIncident";

/**
 * A list screen's top row (study-v2 §2.5 rule 2): the area's title, its
 * controls, and New incident at the right; Settings has none. In the desktop
 * window it is the title strip and keeps clear of the window controls (#811).
 */
export function PageHeader({
	title,
	children,
	primary,
	className,
}: {
	title: ReactNode;
	children?: ReactNode;
	/** The screen's one primary; `+ New incident` unless given (#673 w11). */
	primary?: ReactNode;
	className?: string;
}) {
	const { pathname } = useLocation();
	return (
		<header
			className={cn(
				"flex min-h-(--header-h) shrink-0 flex-wrap items-center gap-x-3 gap-y-2 bg-surface-1 py-1.5 pr-3 pl-4 desktop:pr-[calc(var(--controls-w)+12px)] desktop:app-drag desktop:[&_a]:app-no-drag desktop:[&_button]:app-no-drag desktop:[&_input]:app-no-drag desktop:[&_select]:app-no-drag",
				className,
			)}
			data-testid="page-header"
		>
			<h1 className="mr-1 text-title">{title}</h1>
			{children}
			<span className="flex-1" />
			{!inSettings(pathname) && (primary ?? <NewIncidentButton />)}
		</header>
	);
}
