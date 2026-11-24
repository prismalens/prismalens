// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { AcpMark } from "@prismalens/config/acp-marks";
import { type ModelMaker, makerLetters } from "@prismalens/config/harness";
import { Star } from "lucide-react";
import type { CSSProperties } from "react";
import { type Brand, brandOf, brandUrl } from "@/assets/brands";
import { type FactId, fact as factAttr } from "@/components/kit/fact";
import { agentFacts } from "@/lib/agent-facts";
import { cn } from "@/lib/utils";

/**
 * An agent's mark is its owner's published logo, in the owner's own colours (`assets/brands.ts`);
 * only an agent with no published logo takes letters. No agent is drawn any other way.
 */
export function AgentMark({
	id,
	className,
}: {
	id: string;
	className?: string;
}) {
	const brand = brandOf(id);
	if (brand) return <Logo brand={brand} className={className} fact="agent" />;
	return (
		<Tile
			letters={agentFacts(id)?.mark?.letters ?? makerLetters(id)}
			className={className}
			testId="agent-lettermark"
			fact="agent"
		/>
	);
}

/** A model's maker: its published logo, else its letters. */
export function MakerMark({
	maker,
	className,
}: {
	maker: ModelMaker | null;
	className?: string;
}) {
	const brand = brandOf(maker?.id);
	if (brand) return <Logo brand={brand} className={className} />;
	return (
		<Tile
			letters={maker?.letters ?? "?"}
			className={className}
			testId="maker-lettermark"
		/>
	);
}

/** An ACP registry agent's tile: its registry icon is a single-colour glyph, so it takes letters (#1101). */
export function RegistryMark({
	mark,
	className,
}: {
	mark: AcpMark | undefined;
	className?: string;
}) {
	return (
		<Tile
			letters={mark?.letters ?? "?"}
			className={className}
			testId="registry-lettermark"
		/>
	);
}

function Logo({
	brand,
	className,
	fact,
}: {
	brand: Brand;
	className?: string;
	/** The fact it shows on the screen (`registry/closed/fact.ts`), for an agent's own mark. */
	fact?: FactId;
}) {
	// The shipped file is the background as it is; the theme only picks which of the owner's files.
	const style = {
		"--logo-light": `url("${brandUrl(brand, "light")}")`,
		"--logo-dark": `url("${brandUrl(brand, "dark")}")`,
		minWidth: brand.min?.width,
		minHeight: brand.min?.height,
	} as CSSProperties;
	return (
		<span
			aria-hidden
			data-testid="agent-logo"
			data-brand={brand.id}
			{...factAttr(fact)}
			style={style}
			className={cn(
				"inline-block size-4 shrink-0 bg-contain bg-center bg-no-repeat bg-(image:--logo-light) dark:bg-(image:--logo-dark)",
				className,
			)}
		/>
	);
}

function Tile({
	letters,
	className,
	testId,
	fact,
}: {
	letters: string;
	className?: string;
	testId: string;
	fact?: FactId;
}) {
	return (
		<span
			aria-hidden
			data-testid={testId}
			{...factAttr(fact)}
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
