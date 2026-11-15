// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { AcpMark } from "@prismalens/config/acp-marks";
import {
	type AgentMarkFact,
	type ModelMaker,
	makerLetters,
} from "@prismalens/config/harness";
import { Star } from "lucide-react";
import type { CSSProperties } from "react";
import { agentFacts } from "@/lib/agent-facts";
import { cn } from "@/lib/utils";

/**
 * Every agent's mark comes from its registry entry's `mark` fact (#1101): its owner's
 * logo in the owner's own inks at no less than its stated minimum, or a lettered tile
 * where the owner's terms rule the logo out. No agent is drawn any other way.
 */
export function AgentMark({
	id,
	className,
}: {
	id: string;
	className?: string;
}) {
	const fact = agentFacts(id)?.mark;
	if (fact && "logo" in fact)
		return <Logo logo={fact.logo} className={className} />;
	return (
		<Tile
			letters={fact?.letters ?? makerLetters(id)}
			className={className}
			testId="agent-lettermark"
		/>
	);
}

/** A model's maker: the agent's logo when one agent's owner makes it, else its tile. */
export function MakerMark({
	maker,
	className,
}: {
	maker: ModelMaker | null;
	className?: string;
}) {
	const fact = maker ? agentFacts(maker.id)?.mark : undefined;
	if (fact && "logo" in fact)
		return <Logo logo={fact.logo} className={className} />;
	return (
		<Tile
			letters={maker?.letters ?? "?"}
			className={className}
			testId="maker-lettermark"
		/>
	);
}

/**
 * An ACP registry agent's mark: its registry icon as a CSS mask in the theme's text
 * colour (the SVG never runs), or its letters where its owner's terms rule it out.
 */
export function RegistryMark({
	mark,
	className,
}: {
	mark: AcpMark | undefined;
	className?: string;
}) {
	if (mark && "icon" in mark)
		return (
			<span
				aria-hidden
				data-testid="registry-logo"
				style={{ maskImage: `url("${mark.icon}")` }}
				className={cn(
					"inline-block size-4 shrink-0 bg-current text-text-1 [mask-position:center] [mask-repeat:no-repeat] [mask-size:contain]",
					className,
				)}
			/>
		);
	return (
		<Tile
			letters={mark?.letters ?? "?"}
			className={className}
			testId="registry-lettermark"
		/>
	);
}

type LogoFact = Extract<AgentMarkFact, { logo: unknown }>["logo"];

function Logo({ logo, className }: { logo: LogoFact; className?: string }) {
	// The owner's light and dark inks, never the theme's: its terms forbid recolouring.
	const style = {
		"--ink-light": logo.ink.light,
		"--ink-dark": logo.ink.dark,
		"--shade-light": logo.shade.light,
		"--shade-dark": logo.shade.dark,
		width: logo.min.width,
		height: logo.min.height,
	} as CSSProperties;
	return (
		<svg
			aria-hidden
			data-testid="agent-logo"
			viewBox={logo.viewBox}
			style={style}
			className={cn(
				className,
				"shrink-0 text-(--ink-light) dark:text-(--ink-dark) [--shade:var(--shade-light)] dark:[--shade:var(--shade-dark)]",
			)}
			fill="currentColor"
		>
			{logo.paths.shade && (
				<path d={logo.paths.shade} style={{ fillOpacity: "var(--shade)" }} />
			)}
			<path d={logo.paths.ink} />
		</svg>
	);
}

function Tile({
	letters,
	className,
	testId,
}: {
	letters: string;
	className?: string;
	testId: string;
}) {
	return (
		<span
			aria-hidden
			data-testid={testId}
			data-letters={letters}
			className={cn(
				"after:content-[attr(data-letters)] inline-flex size-4 shrink-0 items-center justify-center rounded-[4px] bg-surface-4 text-[9px] leading-none font-semibold text-text-1 [&.size-5]:rounded-[5px] [&.size-5]:text-[10px]",
				className,
			)}
		/>
	);
}

/** The Starred tile's mark: the one star in the rail. */
export function StarredMark({ className }: { className?: string }) {
	return (
		<Star
			aria-hidden
			className={cn("size-4 shrink-0 fill-warn text-warn", className)}
		/>
	);
}
