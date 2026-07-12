// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

"use client";

import type { LLMProviderId } from "@prismalens/config/llm";
import type { ModelMetadata } from "@prismalens/contracts";
import { AlertCircle, Check, Search, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { ModelCard } from "./ModelCard";
import { ProviderLogo } from "./ProviderLogo";

export interface ProviderInfo {
	id: LLMProviderId;
	name: string;
	free?: boolean;
	baseUrlRequired?: boolean;
	defaultBaseUrl?: string;
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
	baseUrl?: string;
	onProviderChange: (provider: string) => void;
	onModelChange: (model: string) => void;
	onCustomModelChange?: (model: string) => void;
	onBaseUrlChange?: (url: string) => void;
	compact?: boolean; // Smaller height for per-agent use
	hideStatusIcons?: boolean; // Hide check/X icons on provider tabs
}

const DEFAULT_VISIBLE_COUNT = 3;

export function ProviderModelSelector({
	providers,
	models,
	envStatus,
	selectedProvider,
	selectedModel,
	customModel = "",
	baseUrl,
	onProviderChange,
	onModelChange,
	onCustomModelChange,
	onBaseUrlChange,
	compact = false,
	hideStatusIcons = false,
}: ProviderModelSelectorProps) {
	const [search, setSearch] = useState("");
	const [showAll, setShowAll] = useState(false);

	// Reset "show all" when provider changes
	// biome-ignore lint/correctness/useExhaustiveDependencies: We want this to run when provider changes
	useEffect(() => {
		setShowAll(false);
	}, [selectedProvider]);

	// Filter models for selected provider (server already sorts by release date)
	const filteredModels = useMemo(() => {
		const filtered = models.filter((m) => m.provider === selectedProvider);

		// Apply search filter
		return search.trim()
			? filtered.filter(
					(m) =>
						m.name.toLowerCase().includes(search.toLowerCase()) ||
						m.id.toLowerCase().includes(search.toLowerCase()),
				)
			: filtered;
	}, [models, selectedProvider, search]);

	// Show latest 3 by default, all when searching or expanded
	const isSearching = search.trim().length > 0;
	const hiddenCount = filteredModels.length - DEFAULT_VISIBLE_COUNT;
	const visibleModels =
		showAll || isSearching || filteredModels.length <= DEFAULT_VISIBLE_COUNT
			? filteredModels
			: filteredModels.slice(0, DEFAULT_VISIBLE_COUNT);

	const isProviderReady = envStatus[selectedProvider]?.isReady ?? false;
	const providerEnvVar = envStatus[selectedProvider]?.envVarName;
	const selectedProviderInfo = providers.find((p) => p.id === selectedProvider);
	const showBaseUrl =
		selectedProviderInfo?.baseUrlRequired ||
		selectedProviderInfo?.defaultBaseUrl;

	return (
		<div className="flex border rounded-lg overflow-hidden bg-background">
			{/* Left: Provider Tabs */}
			<div className="w-48 border-r bg-muted/30 flex-shrink-0">
				{providers.map((p) => {
					const ready = envStatus[p.id]?.isReady ?? false;
					const isSelected = selectedProvider === p.id;

					return (
						<Button
							key={p.id}
							variant="ghost"
							onClick={() => onProviderChange(p.id)}
							className={cn(
								"w-full justify-start px-3 py-2.5 h-auto rounded-none flex items-center gap-2",
								isSelected
									? "bg-background border-r-2 border-primary"
									: "hover:bg-muted/50",
							)}
						>
							{!hideStatusIcons &&
								(ready ? (
									<Check className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
								) : (
									<X className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
								))}
							<ProviderLogo
								provider={p.id}
								size="sm"
								className={cn(!hideStatusIcons && !ready && "opacity-50")}
							/>
							<span
								className={cn(
									"text-sm truncate",
									!hideStatusIcons && !ready && "text-muted-foreground",
								)}
							>
								{p.name}
							</span>
							{p.free && (hideStatusIcons || ready) && (
								<Badge
									variant="secondary"
									className="text-[9px] px-1 py-0 h-3.5 ml-auto"
								>
									Free
								</Badge>
							)}
						</Button>
					);
				})}
			</div>

			{/* Right: Model List */}
			<div className="flex-1 flex flex-col min-w-0">
				{/* API Key Warning Banner */}
				{!isProviderReady && (
					<div className="p-3 bg-muted border-b flex items-center gap-2">
						<AlertCircle className="h-4 w-4 text-muted-foreground flex-shrink-0" />
						<span className="text-sm text-muted-foreground">
							{selectedProvider === "ollama" ? (
								<>
									Set{" "}
									<code className="font-mono bg-muted px-1 rounded text-xs">
										OLLAMA_API_KEY
									</code>{" "}
									for cloud, or run{" "}
									<code className="font-mono bg-muted px-1 rounded text-xs">
										ollama serve
									</code>{" "}
									locally
								</>
							) : (
								<>
									Set{" "}
									<code className="font-mono bg-muted px-1 rounded text-xs">
										{providerEnvVar}
									</code>{" "}
									to enable
								</>
							)}
						</span>
					</div>
				)}

				{/* Base URL (for Ollama, Custom, etc.) */}
				{showBaseUrl && onBaseUrlChange && (
					<div className="p-2 border-b space-y-1">
						<Label
							htmlFor="provider-base-url"
							className="text-xs font-medium text-muted-foreground"
						>
							Base URL
						</Label>
						<Input
							id="provider-base-url"
							placeholder={
								selectedProviderInfo?.defaultBaseUrl ||
								"http://localhost:8000/v1"
							}
							value={baseUrl ?? ""}
							onChange={(e) => onBaseUrlChange(e.target.value)}
							className="h-8 text-sm font-mono"
						/>
					</div>
				)}

				{/* Model area — fixed min-height to prevent layout shift between providers */}
				<div
					className={cn(
						"flex flex-col",
						compact ? "min-h-[200px]" : "min-h-[300px]",
					)}
				>
					{filteredModels.length > 0 ? (
						<>
							{/* Search */}
							<div className="p-2 border-b">
								<div className="relative">
									<Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
									<Input
										aria-label="Search models"
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
									{visibleModels.length === 0 ? (
										<div className="text-center py-8 text-muted-foreground text-sm">
											No models match your search
										</div>
									) : (
										<>
											{visibleModels.map((model) => (
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
											))}
											{!isSearching && hiddenCount > 0 && (
												<Button
													variant="ghost"
													onClick={() => setShowAll(!showAll)}
													className="w-full py-2 h-auto text-xs text-muted-foreground hover:text-foreground"
												>
													{showAll
														? "Show fewer models"
														: `Show ${hiddenCount} more model${hiddenCount === 1 ? "" : "s"}`}
												</Button>
											)}
										</>
									)}
								</div>
							</ScrollArea>
							{/* Custom Model Override */}
							{onCustomModelChange && (
								<div className="border-t p-2">
									<Input
										placeholder="Or enter a custom model name..."
										value={customModel}
										onChange={(e) => onCustomModelChange(e.target.value)}
										className="h-8 text-sm"
										disabled={!isProviderReady}
									/>
								</div>
							)}
						</>
					) : (
						/* No model catalog — show model name input */
						onCustomModelChange && (
							<div className="p-3 space-y-1.5">
								<Label
									htmlFor="custom-model-name"
									className="text-xs font-medium text-muted-foreground"
								>
									Model name
								</Label>
								<Input
									id="custom-model-name"
									placeholder={
										selectedProvider === "ollama"
											? "e.g., llama3.3"
											: "e.g., gpt-4o"
									}
									value={customModel}
									onChange={(e) => onCustomModelChange(e.target.value)}
									className="h-8 text-sm"
									disabled={!isProviderReady}
								/>
								<p className="text-xs text-muted-foreground">
									Enter the model identifier to use with this provider
								</p>
							</div>
						)
					)}
				</div>
			</div>
		</div>
	);
}
