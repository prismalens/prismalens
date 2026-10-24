// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type {
	Evidence,
	Hypothesis,
	InvestigationReport,
} from "@prismalens/contracts";
import { Ban, Check, CheckCheck, CircleHelp, Maximize2 } from "lucide-react";
import {
	Component,
	type ReactNode,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { Hint } from "@/components/shared/Hint";
import { Problem } from "@/components/shared/State";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { citationText, type FileAt } from "@/lib/evidence-files";
import { formatClock } from "@/lib/format-time";
import {
	type HypothesisNode,
	hypothesisTree,
	STATUS_WORD,
} from "@/lib/hypothesis-tree";
import { commandText } from "@/lib/report-view";
import { cn } from "@/lib/utils";
import { hypothesesWord } from "./run-details";

/** The card shows the top of the drawing; Open larger shows all of it. */
const CLIP_PX = 360;

const LOOK: Record<Hypothesis["status"], { icon: typeof Check; tone: string }> =
	{
		confirmed: { icon: CheckCheck, tone: "text-ok" },
		supported: { icon: Check, tone: "text-accent" },
		speculative: { icon: CircleHelp, tone: "text-warn" },
		refuted: { icon: Ban, tone: "text-text-3" },
	};

/** A citation with somewhere to go: a file in the clone, or the step that saw it. */
export type CiteTarget = { file: FileAt } | { step: number };

interface Cite {
	n: number;
	label: string;
	target: CiteTarget;
}

export interface HypothesesProps {
	report: Pick<InvestigationReport, "hypotheses" | "rootCause">;
	/** When the report arrived. */
	at: string | null;
	targetOf: (e: Evidence) => CiteTarget | null;
	onOpenFile: (f: FileAt, origin: string) => void;
	onJump: (n: number) => void;
	/** Opened from Evidence's "Open the drawing"; the page owns it so both doors share one preview. */
	preview: boolean;
	onPreview: (open: boolean) => void;
}

export const HYPOTHESES_OPEN_ID = "hypotheses-open-larger";

/**
 * The hypotheses card under the report (ruling 15): PrismaLens's template
 * draws `report.hypotheses` as an indented list. If the drawing fails, the
 * Problem line replaces it and every hypothesis stays as text.
 */
export function HypothesesCard(props: HypothesesProps) {
	const { report, at } = props;
	const sub = `${at ? `From the report at ${formatClock(at)}. ` : ""}${
		report.hypotheses.length
			? `${hypothesesWord(report.hypotheses.length)}.`
			: "No hypotheses."
	}`;
	const clip = useRef<HTMLDivElement>(null);
	const inner = useRef<HTMLDivElement>(null);
	const [clipped, setClipped] = useState(false);
	useLayoutEffect(() => {
		const el = clip.current;
		const content = inner.current;
		if (!el || !content) return;
		const measure = () => setClipped(el.scrollHeight > CLIP_PX + 1);
		measure();
		const ro = new ResizeObserver(measure);
		ro.observe(content);
		return () => ro.disconnect();
	}, []);
	const act = (inPreview: boolean) => (cite: Cite, origin: string) => {
		// One modal at a time: the preview closes first and focus returns to Open larger.
		if (inPreview) props.onPreview(false);
		const from = inPreview ? HYPOTHESES_OPEN_ID : origin;
		if ("file" in cite.target) props.onOpenFile(cite.target.file, from);
		else props.onJump(cite.target.step);
	};
	return (
		<li
			className="flex flex-col gap-1.5 rounded-[10px] bg-surface-2 px-3 pt-2.5 pb-3"
			data-testid="hypotheses-card"
		>
			<div className="flex min-w-0 items-center gap-2">
				<span className="flex min-w-0 flex-1 flex-col">
					<span className="truncate font-semibold">Hypotheses</span>
					<span className="text-meta text-text-3">{sub}</span>
				</span>
				<Hint label="Open larger">
					<button
						type="button"
						id={HYPOTHESES_OPEN_ID}
						aria-label="Open Hypotheses larger"
						onClick={() => props.onPreview(true)}
						className="flex size-7 shrink-0 items-center justify-center rounded-control text-text-2 transition-colors duration-(--dur-instant) hover:bg-surface-3 hover:text-text-1"
						data-testid="hypotheses-open"
					>
						<Maximize2 className="size-4" aria-hidden />
					</button>
				</Hint>
			</div>
			<div
				ref={clip}
				className={cn(
					"relative overflow-hidden rounded-control",
					clipped &&
						"after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:h-14 after:bg-[linear-gradient(transparent,var(--surface-2))]",
				)}
				style={{ maxHeight: CLIP_PX }}
				data-clipped={clipped ? "" : undefined}
			>
				<div ref={inner}>
					<Drawn {...props} onCite={act(false)} scope="card" />
				</div>
			</div>
			<Dialog open={props.preview} onOpenChange={props.onPreview}>
				<DialogContent
					size="xl"
					className="max-h-[88dvh] max-md:top-0 max-md:left-0 max-md:h-dvh max-md:max-h-none max-md:w-full max-md:translate-x-0 max-md:translate-y-0 max-md:rounded-none"
					data-testid="hypotheses-preview"
				>
					<DialogHeader>
						<DialogTitle>Hypotheses</DialogTitle>
						<DialogDescription>{sub}</DialogDescription>
					</DialogHeader>
					<Drawn {...props} onCite={act(true)} scope="preview" />
				</DialogContent>
			</Dialog>
		</li>
	);
}

/** The drawing, or, when it fails, the Problem line over the same hypotheses as text. */
function Drawn({
	report,
	targetOf,
	onCite,
	scope,
}: HypothesesProps & {
	onCite: (c: Cite, origin: string) => void;
	scope: "card" | "preview";
}) {
	const [failed, setFailed] = useState(false);
	if (report.hypotheses.length === 0)
		return <p className="m-0 text-text-2">The report lists no hypotheses.</p>;
	const cites = numberCites(report.hypotheses, targetOf);
	const shared = { report, cites, onCite, scope };
	if (failed) return <Fallback {...shared} />;
	return (
		<DrawingBoundary onError={() => setFailed(true)}>
			<Drawing {...shared} />
		</DrawingBoundary>
	);
}

interface Shared {
	report: HypothesesProps["report"];
	cites: Map<number, Cite[]>;
	onCite: (c: Cite, origin: string) => void;
	scope: "card" | "preview";
}

/** Citations numbered across the report in its order, each with where it goes. */
function numberCites(
	hs: readonly Hypothesis[],
	targetOf: (e: Evidence) => CiteTarget | null,
): Map<number, Cite[]> {
	const out = new Map<number, Cite[]>();
	let n = 0;
	hs.forEach((h, i) => {
		for (const e of h.evidence) {
			const target = targetOf(e);
			if (!target) continue;
			n += 1;
			const label =
				"file" in target
					? citationText(target.file)
					: `${commandText(e.source)}, step ${target.step}`;
			out.set(i, [...(out.get(i) ?? []), { n, label, target }]);
		}
	});
	return out;
}

const citeId = (scope: string, c: Cite) => `hyp-${scope}-cite-${c.n}`;

function Drawing({ report, cites, onCite, scope }: Shared) {
	const roots = hypothesisTree(report.hypotheses);
	const all = Array.from(cites.values()).flat();
	return (
		<section
			className="flex flex-col gap-2.5 text-meta"
			aria-label="Hypotheses from the report"
			data-testid="hypotheses-drawing"
		>
			<Conclusion text={report.rootCause} />
			<Level
				nodes={roots}
				depth={0}
				cites={cites}
				onCite={onCite}
				scope={scope}
			/>
			{all.length > 0 && (
				<>
					<span className="text-text-3">Citations</span>
					<ol className="m-0 flex list-none flex-col gap-0.5 p-0">
						{all.map((c) => (
							<li key={c.n} className="flex min-w-0 gap-1.5">
								<span className="text-text-3 tabular-nums">{c.n}</span>
								<button
									type="button"
									id={`${citeId(scope, c)}-list`}
									onClick={() => onCite(c, `${citeId(scope, c)}-list`)}
									className="min-w-0 rounded-control text-left font-mono text-mono text-accent underline underline-offset-[3px] [overflow-wrap:anywhere]"
									data-testid="hypotheses-cite"
								>
									{c.label}
								</button>
							</li>
						))}
					</ol>
				</>
			)}
		</section>
	);
}

function Conclusion({ text }: { text: string | null | undefined }) {
	if (!text) return null;
	return (
		<div className="flex flex-col rounded-control bg-[oklch(from_var(--ok)_l_c_h/0.12)] px-2.5 py-2">
			<span className="font-semibold text-ok">Conclusion</span>
			<span dir="auto" className="text-body text-text-1">
				{text}
			</span>
		</div>
	);
}

function Level({
	nodes,
	depth,
	cites,
	onCite,
	scope,
}: {
	nodes: HypothesisNode[];
	depth: number;
	cites: Map<number, Cite[]>;
	onCite: Shared["onCite"];
	scope: string;
}) {
	return (
		<ul
			className={cn(
				"m-0 flex min-w-0 list-none flex-col gap-0.5 p-0",
				depth > 0 &&
					"relative mt-0.5 pl-5 before:absolute before:top-0 before:bottom-1.5 before:left-2 before:w-px before:bg-hairline",
			)}
		>
			{nodes.map((node) => {
				const h = node.hypothesis;
				const { icon: Icon, tone } = LOOK[h.status];
				return (
					<li key={node.key} className="flex min-w-0 flex-col">
						<div
							className="flex min-w-0 items-start gap-2 rounded-control px-2 py-1"
							data-testid="hypothesis-row"
							data-status={h.status}
						>
							<Icon
								aria-hidden
								className={cn("mt-0.5 size-3.5 shrink-0", tone)}
							/>
							<span className="min-w-0 flex-1 text-body">
								<span
									dir="auto"
									className={cn(
										"[overflow-wrap:anywhere]",
										h.status === "refuted"
											? "text-text-3 line-through"
											: "text-text-1",
									)}
								>
									{h.statement}
								</span>
								{(cites.get(node.index) ?? []).map((c) => (
									<button
										key={c.n}
										type="button"
										id={citeId(scope, c)}
										aria-label={`Citation ${c.n}: ${c.label}`}
										onClick={() => onCite(c, citeId(scope, c))}
										className="ml-1 rounded-control px-0.5 text-meta text-accent underline"
									>
										{c.n}
									</button>
								))}
							</span>
							<span className={cn("shrink-0", tone)}>
								{STATUS_WORD[h.status]}
							</span>
						</div>
						{node.children.length > 0 && (
							<Level
								nodes={node.children}
								depth={depth + 1}
								cites={cites}
								onCite={onCite}
								scope={scope}
							/>
						)}
					</li>
				);
			})}
		</ul>
	);
}

/** Every hypothesis as page text when the drawing failed: statement, status word, nesting and working citations. */
function Fallback({ report, cites, onCite, scope }: Shared) {
	const roots = hypothesisTree(report.hypotheses);
	const items = (nodes: HypothesisNode[]): ReactNode => (
		<ul className="m-0 flex list-disc flex-col gap-1 pl-5">
			{nodes.map((node) => {
				const h = node.hypothesis;
				return (
					<li key={node.key}>
						<span
							className={h.status === "refuted" ? "text-text-3" : "text-text-1"}
						>
							{h.statement}
						</span>{" "}
						<span className="text-meta text-text-2">
							{STATUS_WORD[h.status]}
						</span>
						{(cites.get(node.index) ?? []).map((c) => (
							<button
								key={c.n}
								type="button"
								id={`${citeId(scope, c)}-text`}
								onClick={() => onCite(c, `${citeId(scope, c)}-text`)}
								className="ml-2 rounded-control text-meta text-accent underline"
							>
								{c.label}
							</button>
						))}
						{node.children.length > 0 && items(node.children)}
					</li>
				);
			})}
		</ul>
	);
	return (
		<div className="flex flex-col gap-2" data-testid="hypotheses-fallback">
			<Problem
				className="py-0"
				text="Unable to show the hypotheses drawing: it stopped with an error."
			/>
			<span className="text-text-2">
				The same {hypothesesWord(report.hypotheses.length)}, as text:
			</span>
			{report.rootCause && (
				<span className="text-text-2">
					<span className="font-semibold text-ok">Conclusion</span>{" "}
					{report.rootCause}
				</span>
			)}
			{items(roots)}
		</div>
	);
}

/** React's error boundary is a class; it only reports, the parent swaps in the text list. */
class DrawingBoundary extends Component<
	{ children: ReactNode; onError: () => void },
	{ failed: boolean }
> {
	state = { failed: false };
	static getDerivedStateFromError() {
		return { failed: true };
	}
	componentDidCatch() {
		this.props.onError();
	}
	render() {
		return this.state.failed ? null : this.props.children;
	}
}

/** Re-focus a control by id once the page has re-rendered it. */
export function useFocusLater() {
	const t = useRef<number | undefined>(undefined);
	useEffect(() => () => window.clearTimeout(t.current), []);
	return (id: string) => {
		window.clearTimeout(t.current);
		t.current = window.setTimeout(() => {
			const el = document.getElementById(id);
			el?.scrollIntoView({ block: "center" });
			el?.focus();
		}, 0);
	};
}
