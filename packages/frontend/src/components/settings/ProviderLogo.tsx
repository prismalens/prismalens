"use client";

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

/**
 * Display a provider logo from models.dev
 * Falls back to a default logo if the provider logo doesn't exist.
 */
export function ProviderLogo({
	provider,
	className,
	size = "sm",
}: ProviderLogoProps) {
	return (
		<img
			src={`${MODELS_DEV_LOGO_URL}/${provider}.svg`}
			alt={`${provider} logo`}
			className={cn(sizeClasses[size], "flex-shrink-0", className)}
			// Hide broken images gracefully
			onError={(e) => {
				e.currentTarget.style.display = "none";
			}}
		/>
	);
}
