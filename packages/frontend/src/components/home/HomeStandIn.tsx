// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { ComposerStandIn } from "@/components/thread/ComposerStandIn";
import { HomePurpose } from "./HomePurpose";

/**
 * Home's first frame (#1101 category 12): the question, the purpose line and the box, in
 * `HomeComposer`'s own layout, while its pickers and the composer's code load.
 */
export function HomeStandIn() {
	return (
		<div
			className="mx-auto flex w-full max-w-[680px] flex-col gap-3 px-4 pt-[12vh] pb-12 max-sm:pt-6"
			data-testid="home-stand-in"
		>
			<h2 className="text-center text-display text-text-1">
				What should we work on?
			</h2>
			<HomePurpose />
			<ComposerStandIn placeholder="Ask anything" chipRow />
		</div>
	);
}
