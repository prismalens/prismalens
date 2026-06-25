import {
	Brain,
	CheckCircle2,
	ChevronRight,
	Loader2,
	Terminal,
	XCircle,
} from "lucide-react";

import type {
	EngineStep,
	EngineStreamStatus,
	EngineToolCall,
	EngineToolResult,
} from "@/lib/api/hooks/use-engine-investigation-stream";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@/components/ui/collapsible";

interface EngineStreamPanelProps {
	steps: EngineStep[];
	status: EngineStreamStatus;
	error: string | null;
}

/** Render a tool call's arguments as a readable one-liner (shell commands inlined). */
function formatArgs(args: Record<string, unknown>): string {
	const command = args.command;
	if (typeof command === "string") {
		const rest = args.args;
		const tail = Array.isArray(rest) ? ` ${rest.map(String).join(" ")}` : "";
		return `${command}${tail}`;
	}
	try {
		return JSON.stringify(args);
	} catch {
		return String(args);
	}
}

function ToolInteraction({
	call,
	result,
}: {
	call?: EngineToolCall;
	result?: EngineToolResult;
}) {
	const name = call?.name ?? result?.name ?? "tool";
	const ok = result?.ok ?? true;
	const pending = !result;

	return (
		<Collapsible className="rounded-md border bg-muted/40">
			<CollapsibleTrigger className="group flex w-full items-center gap-2 px-3 py-2 text-left text-sm">
				<ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-90" />
				<Terminal className="h-4 w-4 shrink-0 text-muted-foreground" />
				<code className="flex-1 truncate font-mono text-xs">
					{call ? formatArgs(call.args) : name}
				</code>
				{pending ? (
					<Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
				) : ok ? (
					<Badge variant="secondary" className="shrink-0 gap-1">
						<CheckCircle2 className="h-3 w-3" /> ok
					</Badge>
				) : (
					<Badge variant="destructive" className="shrink-0 gap-1">
						<XCircle className="h-3 w-3" /> error
					</Badge>
				)}
			</CollapsibleTrigger>
			<CollapsibleContent>
				<div className="border-t px-3 py-2">
					{call && (
						<p className="mb-1 font-mono text-xs text-muted-foreground">
							{name}({formatArgs(call.args)})
						</p>
					)}
					<pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-background p-2 font-mono text-xs">
						{result?.preview ?? "Running…"}
					</pre>
				</div>
			</CollapsibleContent>
		</Collapsible>
	);
}

export function EngineStreamPanel({
	steps,
	status,
	error,
}: EngineStreamPanelProps) {
	const streaming = status === "connecting" || status === "streaming";

	return (
		<Card>
			<CardHeader>
				<CardTitle className="flex items-center gap-2 text-base">
					<Brain className="h-4 w-4" />
					Live investigation
					{streaming && (
						<Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
					)}
				</CardTitle>
			</CardHeader>
			<CardContent className="space-y-4">
				{status === "connecting" && steps.length === 0 && (
					<p className="text-sm text-muted-foreground">Connecting to engine…</p>
				)}

				{steps.map((step) => {
					const count = Math.max(step.toolCalls.length, step.results.length);
					return (
						<div key={step.step} className="space-y-2">
							<div className="flex items-start gap-2">
								<Badge variant="outline" className="mt-0.5 shrink-0">
									Step {step.step}
								</Badge>
								{step.text && (
									<p className="whitespace-pre-wrap text-sm leading-relaxed">
										{step.text}
									</p>
								)}
							</div>
							{count > 0 && (
								<div className="ml-2 space-y-1.5 border-l pl-3">
									{Array.from({ length: count }).map((_, i) => (
										<ToolInteraction
											// biome-ignore lint/suspicious/noArrayIndexKey: paired call/result share a stable position within a step
											key={i}
											call={step.toolCalls[i]}
											result={step.results[i]}
										/>
									))}
								</div>
							)}
						</div>
					);
				})}

				{status === "error" && (
					<div className="flex items-center gap-2 text-sm text-destructive">
						<XCircle className="h-4 w-4" />
						{error ?? "Investigation failed"}
					</div>
				)}
			</CardContent>
		</Card>
	);
}
