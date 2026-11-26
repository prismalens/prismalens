// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { ComponentProps, ComponentType } from "react";
import { Loading, Problem } from "@/components/shared/State";
import { Button } from "@/components/ui/button";
import { lazyPart } from "@/lib/lazy";
import type { QuoteIn } from "./QuoteIn";

/** The picker's code loads when "Quote in another thread" opens: it says so meanwhile, and offers Retry or Dismiss when the load fails. */
export function lazyQuoteIn(
	load: () => Promise<ComponentType<ComponentProps<typeof QuoteIn>>>,
) {
	return lazyPart(load, () => <Loading rows={1} />, {
		now: true,
		failed: (retry, props) => (
			<Problem
				text="Quote picker did not load."
				onRetry={retry}
				back={
					<Button variant="text" size="sm" onClick={props.onClose}>
						Dismiss
					</Button>
				}
			/>
		),
	});
}
