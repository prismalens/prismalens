// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { useLocation } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { inSettings } from "@/hooks/use-back";
import { cn } from "@/lib/utils";
import { NewIncidentButton } from "./NewIncident";

/**
 * A list screen's top row (study-v2 §2.5 rule 2): the area's title, its
 * controls, and the one primary New at the right; Settings has none (look
 * ruling §2). Records use a band instead.
 */
export function PageHeader({
	title,
	children,
	className,
}: {
	title: ReactNode;
	children?: ReactNode;
	className?: string;
}) {
	const { pathname } = useLocation();
	return (
		<header
			className={cn(
				"flex min-h-(--header-h) shrink-0 flex-wrap items-center gap-x-3 gap-y-2 bg-canvas px-4 py-1.5 md:px-6 desktop:app-drag desktop:[&_a]:app-no-drag desktop:[&_button]:app-no-drag desktop:[&_input]:app-no-drag desktop:[&_select]:app-no-drag",
				className,
			)}
			data-testid="page-header"
		>
			<h1 className="mr-1 text-title">{title}</h1>
			{children}
			<span className="flex-1" />
			{!inSettings(pathname) && <NewIncidentButton className="max-md:hidden" />}
		</header>
	);
}
