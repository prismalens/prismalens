// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { RotateCw } from "lucide-react";
import { Hint } from "@/components/shared/Hint";
import { Ring } from "@/components/shared/Ring";
import { Button } from "@/components/ui/button";
import { lazyPart } from "@/lib/lazy";

/** A turn's Undo, whose code loads after first content (#1181): held in place while it loads. */
export const LazyTurnUndo = lazyPart(
	() => import("./TurnUndo").then((m) => m.TurnUndo),
	<Button
		variant="text"
		size="sm"
		disabled
		aria-busy
		data-testid="turn-undo-loading"
	>
		<Ring className="size-3.5" />
		Undo
	</Button>,
	{
		afterFirstContent: true,
		failed: (retry) => (
			<Hint label="Undo didn't load. Try again.">
				<span>
					<Button
						variant="text"
						size="sm"
						onClick={retry}
						data-testid="turn-undo-retry"
					>
						<RotateCw className="size-3.5" />
						Retry Undo
					</Button>
				</span>
			</Hint>
		),
	},
);
