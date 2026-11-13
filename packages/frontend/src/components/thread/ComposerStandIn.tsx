// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { useState } from "react";
import {
	PromptInput,
	PromptInputBody,
	PromptInputFooter,
	PromptInputSubmit,
	PromptInputTools,
} from "@/components/ai/prompt-input";

/** The editor's own field classes: the stand-ins and the editor line up to the pixel. */
export const STAND_IN_FIELD =
	"composer-editor block max-h-40 min-h-11 w-full resize-none overflow-y-auto bg-transparent py-0.5 text-body leading-5 text-text-1 outline-none [field-sizing:content] placeholder:text-text-3";

let typed = "";
let focused = false;

/** What was typed into the stand-in, once: the composer that replaces it starts from it. */
export function takeStandInText(): string {
	const text = typed;
	typed = "";
	return text;
}

/** The stand-in had focus when the composer replaced it, so the composer takes it. */
export const standInHadFocus = () => focused;

/**
 * The message box on a page's first frame (#1101 category 12): the composer's frame and
 * heights with a plain field, so the composer's code loads after the page's first content
 * and nothing moves when it arrives. `chipRow` keeps the room of the chips above the box.
 */
export function ComposerStandIn({
	placeholder,
	chipRow,
}: {
	placeholder: string;
	chipRow?: boolean;
}) {
	const [text, setText] = useState(typed);
	return (
		<div className="flex flex-col gap-1" data-testid="composer-stand-in-frame">
			{chipRow && <div className="h-7" aria-hidden />}
			<div className="overflow-hidden rounded-[10px] bg-surface-2 focus-within:ring-1 focus-within:ring-accent/50">
				<PromptInput
					className="[&>[data-slot=input-group]]:bg-transparent"
					onSubmit={() => {}}
				>
					<PromptInputBody>
						<div className="w-full min-w-0 px-3 pt-2.5">
							<textarea
								aria-label={placeholder}
								placeholder={placeholder}
								rows={1}
								value={text}
								onChange={(e) => {
									typed = e.target.value;
									setText(typed);
								}}
								onFocus={() => {
									focused = true;
								}}
								onBlur={() => {
									focused = false;
								}}
								className={STAND_IN_FIELD}
								data-testid="composer-stand-in-field"
							/>
						</div>
					</PromptInputBody>
					<PromptInputFooter className="-ml-1.5">
						<PromptInputTools className="min-w-0 flex-1" />
						<div className="ml-auto flex shrink-0 items-center gap-0.5">
							<PromptInputSubmit disabled />
						</div>
					</PromptInputFooter>
				</PromptInput>
			</div>
		</div>
	);
}
