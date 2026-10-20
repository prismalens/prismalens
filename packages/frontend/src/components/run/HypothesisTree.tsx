// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { Evidence, Hypothesis } from "@prismalens/contracts";
import { Ban, Check, CheckCheck, CircleHelp } from "lucide-react";
import { useState } from "react";
import {
	type HypothesisNode,
	NODE_WORD,
	type HypothesisTree as Tree,
} from "@/lib/hypothesis-tree";
import { cn } from "@/lib/utils";
import { Row } from "./RunDetailsPanel";
import type { DetailRow } from "./run-details";

const LOOK: Record<Hypothesis["status"], { icon: typeof Check; tone: string }> =
	{
		confirmed: { icon: CheckCheck, tone: "text-ok" },
		supported: { icon: Check, tone: "text-accent" },
		speculative: { icon: CircleHelp, tone: "text-warn" },
		refuted: { icon: Ban, tone: "text-text-3" },
	};

interface Shared {
	incidentId: string;
	/** The same citation row the Evidence tab draws, so a file link it gains shows here too. */
	rowOf: (e: Evidence) => DetailRow;
	onJump: (n: number) => void;
}

/**
 * The finished run's hypotheses as a tree (proposal item 5): the chain to
 * the named cause stands out, ruled-out ideas are struck, and the tree ends
 * in the cause or in "No cause found". Reports without parent links list flat.
 */
export function HypothesisTree({ tree, ...shared }: { tree: Tree } & Shared) {
	return (
		<section
			className="flex min-w-0 flex-col gap-2"
			aria-label="Hypotheses"
			data-testid="hypothesis-tree"
			data-linked={tree.linked ? "" : undefined}
		>
			<h3 className="text-meta font-semibold text-text-2">
				{tree.linked ? "How it got there" : "Hypotheses"}
			</h3>
			{tree.roots.length > 0 && (
				<Level nodes={tree.roots} depth={0} linked={tree.linked} {...shared} />
			)}
			{tree.end.kind === "cause" ? (
				<div
					className="flex flex-col gap-0.5 rounded-control bg-ok/12 px-3 py-2"
					data-testid="hypothesis-end"
					data-end="cause"
				>
					<span className="text-meta font-semibold text-ok">Conclusion</span>
					<span dir="auto" className="[overflow-wrap:anywhere]">
						{tree.end.text}
					</span>
				</div>
			) : (
				<div
					className="flex flex-col gap-0.5 rounded-control bg-surface-3 px-3 py-2"
					data-testid="hypothesis-end"
					data-end="none"
				>
					<span className="text-meta font-semibold text-text-2">
						No cause found
					</span>
					<span dir="auto" className="text-text-2 [overflow-wrap:anywhere]">
						{tree.end.text}
					</span>
				</div>
			)}
		</section>
	);
}

function Level({
	nodes,
	depth,
	linked,
	...shared
}: { nodes: HypothesisNode[]; depth: number; linked: boolean } & Shared) {
	return (
		<ol
			className={cn(
				"m-0 flex min-w-0 list-none flex-col gap-1.5 p-0",
				depth > 0 &&
					"relative pl-3 before:absolute before:top-0 before:bottom-1 before:left-1 before:w-px before:bg-hairline sm:pl-5 sm:before:left-2",
			)}
		>
			{nodes.map((n) => (
				<li key={n.key} className="flex min-w-0 flex-col gap-1.5">
					<Node node={n} {...shared} />
					{linked && n.children.length > 0 && (
						<Level
							nodes={n.children}
							depth={depth + 1}
							linked={linked}
							{...shared}
						/>
					)}
				</li>
			))}
		</ol>
	);
}

function Node({ node, ...shared }: { node: HypothesisNode } & Shared) {
	const h = node.hypothesis;
	const refuted = h.status === "refuted";
	const [open, setOpen] = useState(node.winning);
	const { icon: Icon, tone } = LOOK[h.status];
	const n = h.evidence.length;
	return (
		<div
			className={cn(
				"flex min-w-0 flex-col gap-1 rounded-control px-2.5 py-2",
				node.winning ? "bg-ok/12" : "bg-surface-1",
			)}
			data-testid="hypothesis-node"
			data-status={h.status}
			data-winning={node.winning ? "" : undefined}
		>
			<div className="flex min-w-0 items-start gap-2">
				<Icon aria-hidden className={cn("mt-0.5 size-3.5 shrink-0", tone)} />
				<span className="flex min-w-0 flex-1 flex-col">
					<span
						dir="auto"
						className={cn(
							"[overflow-wrap:anywhere]",
							refuted ? "text-text-3 line-through" : "text-text-1",
							node.winning && "font-semibold",
						)}
						data-testid="hypothesis-statement"
					>
						{h.statement}
					</span>
					<span className={cn("text-meta", tone)}>{NODE_WORD[h.status]}</span>
				</span>
				{n > 0 && (
					<button
						type="button"
						aria-expanded={open}
						onClick={() => setOpen(!open)}
						className="shrink-0 text-meta text-accent hover:underline"
						data-testid="hypothesis-evidence-toggle"
					>
						{n === 1 ? "1 piece of evidence" : `${n} pieces of evidence`}
					</button>
				)}
			</div>
			{open && n > 0 && (
				<div
					className="flex min-w-0 flex-col gap-1.5 pl-5.5"
					data-testid="hypothesis-evidence"
				>
					{h.evidence.map((e, i) => {
						const row = shared.rowOf(e);
						return (
							<Row
								// biome-ignore lint/suspicious/noArrayIndexKey: evidence has no id; its order is the report's.
								key={i}
								row={
									e.direction === "contradicts"
										? { ...row, text: `Against: ${row.text}` }
										: row
								}
								incidentId={shared.incidentId}
								onJump={shared.onJump}
							/>
						);
					})}
				</div>
			)}
		</div>
	);
}
