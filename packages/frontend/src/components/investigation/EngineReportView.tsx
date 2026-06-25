import {
	CheckCircle2,
	CircleHelp,
	Lightbulb,
	MinusCircle,
	PlusCircle,
	Target,
} from "lucide-react";

import type {
	EngineEvidence,
	EngineReport,
} from "@/lib/api/hooks/use-engine-investigation-stream";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

function EvidenceRow({ evidence }: { evidence: EngineEvidence }) {
	const verified = evidence.status === "verified";
	const supports = evidence.direction === "supports";
	return (
		<li className="flex items-start gap-2 text-sm">
			{supports ? (
				<PlusCircle className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
			) : (
				<MinusCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
			)}
			<div className="space-y-0.5">
				<p className="leading-relaxed">{evidence.observation}</p>
				<div className="flex flex-wrap items-center gap-1.5">
					<Badge
						variant={verified ? "secondary" : "outline"}
						className="gap-1 text-[10px]"
					>
						{verified ? (
							<CheckCircle2 className="h-3 w-3" />
						) : (
							<CircleHelp className="h-3 w-3" />
						)}
						{verified ? "verified" : "inferred"}
					</Badge>
					<code className="font-mono text-xs text-muted-foreground">
						{evidence.source}
					</code>
				</div>
			</div>
		</li>
	);
}

export function EngineReportView({ report }: { report: EngineReport }) {
	return (
		<div className="space-y-4">
			{/* Summary + root cause */}
			<Card>
				<CardHeader>
					<CardTitle className="text-base">Summary</CardTitle>
				</CardHeader>
				<CardContent className="space-y-3">
					<p className="text-sm leading-relaxed">{report.summary}</p>
					{report.rootCause && (
						<div className="flex items-start gap-2 rounded-md border border-primary/30 bg-primary/5 p-3">
							<Target className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
							<div>
								<p className="text-xs font-semibold uppercase tracking-wide text-primary">
									Root cause
								</p>
								<p className="text-sm leading-relaxed">{report.rootCause}</p>
							</div>
						</div>
					)}
				</CardContent>
			</Card>

			{/* Ordered hypotheses */}
			<Card>
				<CardHeader>
					<CardTitle className="text-base">
						Hypotheses{" "}
						<span className="text-sm font-normal text-muted-foreground">
							(ranked — most likely first)
						</span>
					</CardTitle>
				</CardHeader>
				<CardContent className="space-y-4">
					{report.hypotheses.length === 0 && (
						<p className="text-sm text-muted-foreground">
							No hypotheses were recorded.
						</p>
					)}
					{report.hypotheses.map((h) => (
						<div key={h.rank} className="space-y-2">
							<div className="flex items-start gap-2">
								<Badge className="mt-0.5 shrink-0">#{h.rank}</Badge>
								<p className="text-sm font-medium leading-relaxed">
									{h.statement}
								</p>
							</div>
							{h.evidence.length > 0 && (
								<ul className="ml-2 space-y-1.5 border-l pl-4">
									{h.evidence.map((e, i) => (
										// biome-ignore lint/suspicious/noArrayIndexKey: evidence has no id; order is stable within a hypothesis
										<EvidenceRow key={i} evidence={e} />
									))}
								</ul>
							)}
						</div>
					))}
				</CardContent>
			</Card>

			{/* Recommendations */}
			{report.recommendations.length > 0 && (
				<Card>
					<CardHeader>
						<CardTitle className="flex items-center gap-2 text-base">
							<Lightbulb className="h-4 w-4" />
							Recommendations
						</CardTitle>
					</CardHeader>
					<CardContent>
						<ul className="space-y-3">
							{report.recommendations.map((r, i) => (
								// biome-ignore lint/suspicious/noArrayIndexKey: recommendations have no id; order is stable
								<li key={i} className="space-y-0.5">
									<p className="text-sm font-medium">{r.title}</p>
									<p className="text-sm text-muted-foreground leading-relaxed">
										{r.detail}
									</p>
								</li>
							))}
						</ul>
					</CardContent>
				</Card>
			)}
		</div>
	);
}
