// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

const MODELS_DEV_LOGO_URL = "https://models.dev/logos";

export interface ProviderLogoProps {
	provider: string;
	className?: string;
	size?: "sm" | "md" | "lg";
}

const sizeClasses = {
	sm: "h-4 w-4",
	md: "h-5 w-5",
	lg: "h-6 w-6",
};

const textSizeClasses = {
	sm: "text-[10px]",
	md: "text-xs",
	lg: "text-sm",
};

/**
 * Display a provider logo from models.dev
 * Falls back to first letter of provider name if the logo fails to load.
 */
export function ProviderLogo({
	provider,
	className,
	size = "sm",
}: ProviderLogoProps) {
	const [failed, setFailed] = useState(false);

	useEffect(() => {
		setFailed(false);
	}, []);

	if (failed) {
		return (
			<span
				className={cn(
					sizeClasses[size],
					textSizeClasses[size],
					"flex-shrink-0 inline-flex items-center justify-center rounded bg-muted font-medium uppercase text-muted-foreground",
					className,
				)}
			>
				{provider.charAt(0)}
			</span>
		);
	}

	return (
		<img
			src={`${MODELS_DEV_LOGO_URL}/${provider}.svg`}
			alt={`${provider} logo`}
			crossOrigin="anonymous"
			className={cn(sizeClasses[size], "flex-shrink-0 dark:invert", className)}
			onError={() => setFailed(true)}
		/>
	);
}
