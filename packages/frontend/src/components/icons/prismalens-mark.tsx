// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { SVGProps } from "react";

/** The refraction mark from prismalens.io `brand/logo.svg`: rays fade in order. */
export function PrismaLensMark({
	className,
	...props
}: SVGProps<SVGSVGElement>) {
	return (
		<svg
			aria-hidden="true"
			fill="none"
			viewBox="0 0 64 64"
			strokeLinecap="round"
			className={className}
			{...props}
		>
			<path d="M2 34H20" stroke="currentColor" opacity=".55" strokeWidth="3" />
			<path
				d="M20.6 34 40.4 29.6"
				stroke="currentColor"
				opacity=".22"
				strokeWidth="2.5"
			/>
			<g className="stroke-[#4f46e5] dark:stroke-[#818cf8]" strokeWidth="3">
				<path d="M42.8 28.3 62 17" />
				<path d="M43.2 29 62 26" opacity=".7" />
				<path d="M43.9 30.2 62 35" opacity=".5" />
				<path d="M44.4 31 62 44" opacity=".35" />
			</g>
			<path
				d="M32 14.1 51 47H13Z"
				stroke="currentColor"
				strokeWidth="3.5"
				strokeLinejoin="round"
			/>
		</svg>
	);
}
