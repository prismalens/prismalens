// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { ReactNode } from "react";
import { Block } from "@/components/kit/Block";
import { faultDetailBlock } from "./fault.blocks";

/** A fault's detail with the registry's copy button; loads with the notice, not the shell. */
export function FaultDetail({
	detail,
	children,
}: {
	detail: string;
	children: ReactNode;
}) {
	return (
		<Block
			spec={faultDetailBlock}
			data={{ detail }}
			reveal="always"
			className="relative mt-1 text-left"
			testId="fault-detail"
		>
			{children}
		</Block>
	);
}
