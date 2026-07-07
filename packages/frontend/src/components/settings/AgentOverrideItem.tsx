// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

"use client";

import type { AgentId, ModelMetadata } from "@prismalens/contracts/schemas";
import { ChevronDown, RotateCcw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";
import {
	type ProviderInfo,
	ProviderModelSelector,
} from "./ProviderModelSelector";

export interface AgentMeta {
	id: AgentId;
	name: string;
	description: string;
	defaultTemp: number;
}

interface AgentOverride {
	model?: string;
	temperature?: number;
}

export interface AgentOverrideItemProps {
	agent: AgentMeta;
	override: AgentOverride | undefined;
	isExpanded: boolean;
	onToggle: (open: boolean) => void;
	agentProvider: string;
	onProviderChange: (provider: string) => void;
	onModelChange: (model: string) => void;
	onTemperatureChange: (temp: number) => void;
	onReset: () => void;
	providers: ProviderInfo[];
	models: ModelMetadata[];
	envStatus: Record<string, { isReady: boolean; envVarName?: string }>;
}

export function AgentOverrideItem({
	agent,
	override,
	isExpanded,
	onToggle,
	agentProvider,
	onProviderChange,
	onModelChange,
	onTemperatureChange,
	onReset,
	providers,
	models,
	envStatus,
}: AgentOverrideItemProps) {
	const hasOverride = override?.model || override?.temperature !== undefined;

	return (
		<Collapsible
			open={isExpanded}
			onOpenChange={onToggle}
			className="border rounded-lg"
		>
			<CollapsibleTrigger className="w-full p-4 flex items-center justify-between text-left hover:bg-muted/30 transition-colors rounded-lg">
				<div className="flex-1 min-w-0">
					<div className="flex items-center gap-2">
						<h4 className="font-medium">{agent.name}</h4>
						{hasOverride && (
							<Badge variant="secondary" className="text-xs">
								Custom
							</Badge>
						)}
					</div>
					<p className="text-xs text-muted-foreground mt-0.5">
						{override?.model || "Use default"} · Temp:{" "}
						{override?.temperature ?? agent.defaultTemp}
					</p>
				</div>
				<ChevronDown
					className={cn(
						"h-4 w-4 text-muted-foreground transition-transform flex-shrink-0",
						isExpanded && "rotate-180",
					)}
				/>
			</CollapsibleTrigger>

			<CollapsibleContent className="px-4 pb-4 space-y-4">
				<ProviderModelSelector
					providers={providers}
					models={models}
					envStatus={envStatus}
					selectedProvider={agentProvider}
					selectedModel={override?.model || ""}
					onProviderChange={onProviderChange}
					onModelChange={onModelChange}
					compact
				/>

				<div className="flex items-center justify-between gap-4">
					<div className="flex items-center gap-3 flex-1">
						<Label className="text-sm whitespace-nowrap">Temperature</Label>
						<Slider
							value={[override?.temperature ?? agent.defaultTemp]}
							onValueChange={([temp]) => onTemperatureChange(temp)}
							min={0}
							max={2}
							step={0.05}
							className="flex-1 max-w-[200px]"
						/>
						<span className="text-sm text-muted-foreground w-10 text-right">
							{(override?.temperature ?? agent.defaultTemp).toFixed(2)}
						</span>
					</div>

					{hasOverride && (
						<Button
							variant="ghost"
							size="sm"
							onClick={onReset}
							className="text-muted-foreground hover:text-foreground"
						>
							<RotateCcw className="h-3.5 w-3.5 mr-1.5" />
							Reset
						</Button>
					)}
				</div>
			</CollapsibleContent>
		</Collapsible>
	);
}
