"use client";

import type { ModelMetadata } from "@prismalens/contracts";
import type { LLMProviderId } from "@prismalens/config/browser";
import {
	AlertCircle,
	Check,
	ChevronDown,
	Search,
	X,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { ModelCard } from "./ModelCard";
import { ProviderLogo } from "./ProviderLogo";

export interface ProviderInfo {
	id: LLMProviderId;
	name: string;
	free?: boolean;
}

export interface ProviderEnvStatus {
	isReady: boolean;
	envVarName?: string;
}

export interface ProviderModelSelectorProps {
	providers: ProviderInfo[];
	models: ModelMetadata[];
	envStatus: Record<string, ProviderEnvStatus | undefined>;
	selectedProvider: string;
	selectedModel: string;
	customModel?: string;
	onProviderChange: (provider: string) => void;
	onModelChange: (model: string) => void;
	onCustomModelChange?: (model: string) => void;
	compact?: boolean; // Smaller height for per-agent use
}

export function ProviderModelSelector({
	providers,
	models,
	envStatus,
	selectedProvider,
	selectedModel,
	customModel = "",
	onProviderChange,
	onModelChange,
	onCustomModelChange,
	compact = false,
}: ProviderModelSelectorProps) {
	const [search, setSearch] = useState("");
	const [customModelOpen, setCustomModelOpen] = useState(false);
	const [localCustomModel, setLocalCustomModel] = useState(customModel);

	// Filter and sort models for selected provider
	const sortedModels = useMemo(() => {
		const filtered = models.filter((m) => m.provider === selectedProvider);

		// Apply search filter
		const searched = search.trim()
			? filtered.filter(
					(m) =>
						m.name.toLowerCase().includes(search.toLowerCase()) ||
						m.id.toLowerCase().includes(search.toLowerCase())
				)
			: filtered;

		// Sort by release date (newest first)
		return [...searched].sort((a, b) => {
			if (!a.releaseDate && !b.releaseDate) return 0;
			if (!a.releaseDate) return 1;
			if (!b.releaseDate) return -1;
			return (
				new Date(b.releaseDate).getTime() - new Date(a.releaseDate).getTime()
			);
		});
	}, [models, selectedProvider, search]);

	const isProviderReady = envStatus[selectedProvider]?.isReady ?? false;
	const providerEnvVar = envStatus[selectedProvider]?.envVarName;

	const handleUseCustomModel = () => {
		if (localCustomModel.trim() && onCustomModelChange) {
			onCustomModelChange(localCustomModel.trim());
			setCustomModelOpen(false);
		}
	};

	return (
		<div className="flex border rounded-lg overflow-hidden bg-background">
			{/* Left: Provider Tabs */}
			<div className="w-36 border-r bg-muted/30 flex-shrink-0">
				{providers.map((p) => {
					const ready = envStatus[p.id]?.isReady ?? false;
					const isSelected = selectedProvider === p.id;

					return (
						<button
							key={p.id}
							type="button"
							onClick={() => onProviderChange(p.id)}
							className={cn(
								"w-full px-3 py-2.5 text-left flex items-center gap-2 transition-colors",
								isSelected
									? "bg-background border-r-2 border-primary"
									: "hover:bg-muted/50"
							)}
						>
							{ready ? (
								<Check className="h-3.5 w-3.5 text-green-500 flex-shrink-0" />
							) : (
								<X className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
							)}
							<ProviderLogo
								provider={p.id}
								size="sm"
								className={cn(!ready && "opacity-50")}
							/>
							<span
								className={cn(
									"text-sm truncate",
									!ready && "text-muted-foreground"
								)}
							>
								{p.name}
							</span>
							{p.free && ready && (
								<Badge
									variant="secondary"
									className="text-[9px] px-1 py-0 h-3.5 ml-auto"
								>
									Free
								</Badge>
							)}
						</button>
					);
				})}
			</div>

			{/* Right: Model List */}
			<div className="flex-1 flex flex-col min-w-0">
				{/* API Key Warning Banner */}
				{!isProviderReady && (
					<div className="p-3 bg-amber-50 dark:bg-amber-950/30 border-b flex items-center gap-2">
						<AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-400 flex-shrink-0" />
						<span className="text-sm text-amber-700 dark:text-amber-400">
							{selectedProvider === "ollama" ? (
								<>
									Set{" "}
									<code className="font-mono bg-amber-100 dark:bg-amber-900/50 px-1 rounded text-xs">
										OLLAMA_API_KEY
									</code>{" "}
									for cloud, or run{" "}
									<code className="font-mono bg-amber-100 dark:bg-amber-900/50 px-1 rounded text-xs">
										ollama serve
									</code>{" "}
									locally
								</>
							) : (
								<>
									Set{" "}
									<code className="font-mono bg-amber-100 dark:bg-amber-900/50 px-1 rounded text-xs">
										{providerEnvVar}
									</code>{" "}
									to enable
								</>
							)}
						</span>
					</div>
				)}

				{/* Search */}
				<div className="p-2 border-b">
					<div className="relative">
						<Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
						<Input
							placeholder="Search models..."
							value={search}
							onChange={(e) => setSearch(e.target.value)}
							className="pl-8 h-8"
						/>
					</div>
				</div>

				{/* Model Cards */}
				<ScrollArea className={compact ? "h-[200px]" : "h-[300px]"}>
					<div className="p-1 space-y-0.5">
						{sortedModels.length === 0 ? (
							<div className="text-center py-8 text-muted-foreground text-sm">
								{search
									? "No models match your search"
									: "No models available"}
							</div>
						) : (
							sortedModels.map((model) => (
								<ModelCard
									key={model.id}
									model={model}
									selected={selectedModel === model.id && !customModel}
									disabled={!isProviderReady}
									onClick={() => {
										if (isProviderReady) {
											onModelChange(model.id);
											if (onCustomModelChange) {
												onCustomModelChange("");
											}
										}
									}}
								/>
							))
						)}
					</div>
				</ScrollArea>

				{/* Custom Model (collapsible) */}
				{onCustomModelChange && (
					<Collapsible
						open={customModelOpen}
						onOpenChange={setCustomModelOpen}
						className="border-t"
					>
						<CollapsibleTrigger asChild>
							<Button
								variant="ghost"
								size="sm"
								className="w-full justify-between text-muted-foreground hover:text-foreground rounded-none h-9"
								disabled={!isProviderReady}
							>
								<span className="text-xs">Enter custom model name</span>
								<ChevronDown
									className={cn(
										"h-3.5 w-3.5 transition-transform",
										customModelOpen && "rotate-180"
									)}
								/>
							</Button>
						</CollapsibleTrigger>
						<CollapsibleContent className="p-2 pt-0">
							<div className="flex gap-2">
								<Input
									placeholder="e.g., custom-model-name"
									value={localCustomModel}
									onChange={(e) => setLocalCustomModel(e.target.value)}
									onKeyDown={(e) => {
										if (e.key === "Enter") {
											handleUseCustomModel();
										}
									}}
									className="flex-1 h-8 text-sm"
									disabled={!isProviderReady}
								/>
								<Button
									variant="secondary"
									size="sm"
									onClick={handleUseCustomModel}
									disabled={!localCustomModel.trim() || !isProviderReady}
									className="h-8"
								>
									Use
								</Button>
							</div>
						</CollapsibleContent>
					</Collapsible>
				)}
			</div>
		</div>
	);
}
