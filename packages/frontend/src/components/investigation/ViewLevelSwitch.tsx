// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { useEffect } from "react";
import { markLook } from "@/components/kit/marks";
import { Hint } from "@/components/shared/Hint";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
	nextTranscriptView,
	onTranscriptViewSwitch,
	transcriptViewLabel,
	useTranscriptView,
} from "@/lib/transcript-view";

/**
 * The thread's saved view level in its header, its word always on screen; a click or
 * Alt+V moves to the next level and a short notice says which (#1101 cat 12.6).
 */
export function ViewLevelSwitch() {
	const view = useTranscriptView();
	const { toast } = useToast();
	useEffect(
		() =>
			onTranscriptViewSwitch((v) => {
				toast({
					title: `${transcriptViewLabel(v)} view`,
					description: markLook("viewLevel", v).word,
					duration: 2500,
				});
			}),
		[toast],
	);
	const look = markLook("viewLevel", view);
	const label = transcriptViewLabel(view);
	return (
		<Hint
			label={`${look.label}: ${label}`}
			meta={look.word}
			keys={["Alt", "V"]}
		>
			<Button
				variant="ghost"
				size="sm"
				className="shrink-0 gap-1 px-1.5 text-meta text-text-3 hover:text-text-1 max-sm:hidden"
				aria-label={`${look.label}: ${label}. Switch to the next level`}
				onClick={() => nextTranscriptView()}
				data-testid="view-level"
				data-level={view}
			>
				<look.icon aria-hidden className="size-3.5" />
				{label}
			</Button>
		</Hint>
	);
}
