// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { Artifact } from "@prismalens/contracts";
import { ARTIFACT_HTML_CHARS } from "@prismalens/contracts/schemas";
import { Maximize2 } from "lucide-react";
import { useState, useSyncExternalStore } from "react";
import { Hint } from "@/components/shared/Hint";
import { Problem } from "@/components/shared/State";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { formatClock } from "@/lib/format-time";

const root = () => document.documentElement;

function watchTheme(notify: () => void) {
	const mo = new MutationObserver(notify);
	mo.observe(root(), { attributes: true, attributeFilter: ["class"] });
	return () => mo.disconnect();
}

/** The app's theme as the page's colours; the frame cannot see the app's variables. */
function themeStyle(): string {
	const css = getComputedStyle(root());
	const pick = (name: string, fallback: string) =>
		css.getPropertyValue(name).trim() || fallback;
	const dark = root().classList.contains("dark");
	return `<style>:root{color-scheme:${dark ? "dark" : "light"}}body{background:${pick("--surface-2", dark ? "#1e1e22" : "#fff")};color:${pick("--text-1", dark ? "#f2f2f4" : "#1a1a1d")}}</style>`;
}

/** "" while the page cannot be drawn, else the srcdoc. */
function drawable(html: string): string | null {
	if (!html.trim() || html.length > ARTIFACT_HTML_CHARS) return null;
	return html;
}

const TOO_BIG = "This page is empty or too large to draw.";

/** `sandbox=""` is the whole contract: no scripts, no same-origin, no navigation. */
/** The frame's own policy: nothing is fetched, only inline style and data images (#871). */
export const NO_FETCH = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:">`;

function Frame({
	artifact,
	className,
	testId,
}: {
	artifact: Artifact;
	className: string;
	testId: string;
}) {
	const theme = useSyncExternalStore(watchTheme, themeStyle, () => "");
	const html = drawable(artifact.html);
	if (html === null) return <Problem text={TOO_BIG} />;
	return (
		<iframe
			sandbox=""
			srcDoc={NO_FETCH + theme + html}
			title={artifact.title}
			className={`w-full rounded-control border-0 bg-surface-2 ${className}`}
			data-testid={testId}
		/>
	);
}

/**
 * A page the agent published, in the run where it was published (#871). The
 * app's CSP allows only a srcdoc frame; scripts never run in it.
 */
export function ArtifactCard({ artifact }: { artifact: Artifact }) {
	const [larger, setLarger] = useState(false);
	const ok = drawable(artifact.html) !== null;
	return (
		<li
			className="flex flex-col gap-1.5 rounded-[10px] bg-surface-2 px-3 pt-2.5 pb-3"
			data-testid="artifact-card"
		>
			<div className="flex min-w-0 items-center gap-2">
				<span className="flex min-w-0 flex-1 flex-col">
					<span className="truncate font-semibold">{artifact.title}</span>
					<span className="text-meta text-text-3">
						Published at {formatClock(artifact.at)}.
					</span>
				</span>
				{ok && (
					<Hint label="Open larger">
						<button
							type="button"
							aria-label={`Open ${artifact.title} larger`}
							onClick={() => setLarger(true)}
							className="flex size-7 shrink-0 items-center justify-center rounded-control text-text-2 transition-colors duration-(--dur-instant) hover:bg-surface-3 hover:text-text-1"
							data-testid="artifact-open"
						>
							<Maximize2 className="size-4" aria-hidden />
						</button>
					</Hint>
				)}
			</div>
			<Frame artifact={artifact} className="h-80" testId="artifact-frame" />
			<Dialog open={larger} onOpenChange={setLarger}>
				<DialogContent
					size="xl"
					aria-describedby={undefined}
					data-testid="artifact-preview"
				>
					<DialogHeader>
						<DialogTitle>{artifact.title}</DialogTitle>
					</DialogHeader>
					<Frame
						artifact={artifact}
						className="h-[70vh]"
						testId="artifact-frame-larger"
					/>
				</DialogContent>
			</Dialog>
		</li>
	);
}
