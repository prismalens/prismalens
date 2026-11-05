// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	siBitbucket,
	siGithub,
	siGitlab,
	siPrometheus,
	siRender,
} from "simple-icons";
import { cn } from "@/lib/utils";

/**
 * Integration marks from simple-icons (CC0 paths; trademarks of their owners,
 * shown only to name the integration, #1020). A null color paints in the theme
 * text color, because the brand color is black.
 */
const MARKS: Record<string, { path: string; color: string | null }> = {
	prometheus: { path: siPrometheus.path, color: `#${siPrometheus.hex}` },
	github: { path: siGithub.path, color: null },
	gitlab: { path: siGitlab.path, color: `#${siGitlab.hex}` },
	bitbucket: { path: siBitbucket.path, color: `#${siBitbucket.hex}` },
	render: { path: siRender.path, color: null },
};

/** The mark id a source kind, template id or git host stands for, if it has one. */
export function brandMarkId(id: string): string | undefined {
	const key = id.replace(/-token$/, "");
	return key in MARKS ? key : undefined;
}

/** The integration's mark, or null when it has none so the caller keeps its own icon. */
export function BrandMark({
	id,
	className,
}: {
	id: string;
	className?: string;
}) {
	const key = brandMarkId(id);
	const mark = key && MARKS[key];
	if (!mark) return null;
	return (
		<svg
			aria-hidden
			viewBox="0 0 24 24"
			className={cn("size-4 shrink-0", !mark.color && "text-text-1", className)}
			fill={mark.color ?? "currentColor"}
			data-brand-mark={key}
		>
			<path d={mark.path} />
		</svg>
	);
}
