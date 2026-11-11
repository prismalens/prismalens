// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { useState } from "react";
import { useHostImages } from "@/lib/api/hooks/use-app-settings-orpc";
import { cn } from "@/lib/utils";

const SIZE = {
	sm: "size-5 rounded-[5px] text-[11px]",
	md: "size-6 rounded-[6px] text-meta",
	lg: "size-8 rounded-control text-body",
} as const;

/** The letter a project's monogram shows: the first of its last path part. */
export function monogramOf(name: string): string {
	const last = name.split(/[\\/]/).filter(Boolean).pop() ?? name;
	// The first character that is not punctuation, so `.github` reads G.
	const letter =
		Array.from(last).find(
			(c) => c.toLowerCase() !== c.toUpperCase() || /\d/.test(c),
		) ?? "?";
	return letter.toUpperCase();
}

/**
 * A project's face: its logo, else a monogram on a surface step. With
 * "Images from the git host" off it is always the monogram, so no image is requested.
 */
export function ProjectMark({
	name,
	iconUrl,
	size = "md",
	className,
	images,
}: {
	name: string;
	iconUrl?: string | null;
	size?: keyof typeof SIZE;
	className?: string;
	/** Overrides the setting, for callers that already read it. */
	images?: boolean;
}) {
	const setting = useHostImages();
	const [failed, setFailed] = useState<string | null>(null);
	const show = (images ?? setting) && !!iconUrl && failed !== iconUrl;
	const box = cn(
		"flex shrink-0 items-center justify-center overflow-hidden",
		SIZE[size],
		className,
	);
	if (show)
		return (
			<img
				src={iconUrl}
				alt=""
				aria-hidden
				loading="lazy"
				referrerPolicy="no-referrer"
				className={cn(box, "bg-surface-3 object-cover")}
				onError={() => setFailed(iconUrl)}
				data-testid="project-mark"
				data-mark="image"
			/>
		);
	return (
		<span
			aria-hidden
			className={cn(box, "bg-surface-3 font-medium text-text-2")}
			data-testid="project-mark"
			data-mark="monogram"
		>
			{monogramOf(name)}
		</span>
	);
}
