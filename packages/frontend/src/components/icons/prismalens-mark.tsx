// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { SVGProps } from "react";
import { cn } from "@/lib/utils";

/**
 * The p-lens glint mark. Every caller draws it at 24 px or more, so it always
 * keeps the glint; the brand drops the glint only below 24 px (#745).
 */
export function PrismaLensMark({
	className,
	...props
}: SVGProps<SVGSVGElement>) {
	return (
		<svg
			aria-hidden="true"
			fill="none"
			viewBox="0 0 256 256"
			stroke="currentColor"
			strokeLinecap="round"
			className={cn("text-[#4f46e5] dark:text-[#818cf8]", className)}
			{...props}
		>
			<circle cx="142" cy="104" r="54" strokeWidth="36" />
			<path d="M88 64V224" strokeWidth="36" />
			<path d="M120 108A24 24 0 0 1 144 82" strokeWidth="11" />
		</svg>
	);
}
