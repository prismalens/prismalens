"use client";

/**
 * Canvas Export Menu
 *
 * Dropdown menu for exporting the investigation canvas to PNG or JSON.
 */

import type { AgentExecutionWithTools } from "@prismalens/contracts";
import { chartColors } from "@prismalens/design-tokens/colors";
import { Download, FileJson, Image } from "lucide-react";
import { useCallback, useState } from "react";
import { useReactFlow, getRectOfNodes, getTransformForBounds } from "reactflow";
import { toPng } from "html-to-image";

import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export interface CanvasExportMenuProps {
	agentExecutions?: AgentExecutionWithTools[];
	investigationId?: string;
}

export function CanvasExportMenu({
	agentExecutions = [],
	investigationId,
}: CanvasExportMenuProps) {
	const { getNodes } = useReactFlow();
	const [exportError, setExportError] = useState<string | null>(null);

	const downloadImage = useCallback(async () => {
		setExportError(null);

		// Find the react flow viewport element
		const nodesBounds = getRectOfNodes(getNodes());
		const transform = getTransformForBounds(
			nodesBounds,
			nodesBounds.width,
			nodesBounds.height,
			0.5,
			2,
		);

		const viewport = document.querySelector(
			".react-flow__viewport",
		) as HTMLElement;

		if (!viewport) {
			setExportError("Could not find canvas viewport");
			return;
		}

		try {
			const dataUrl = await toPng(viewport, {
				backgroundColor: chartColors.cardLight,
				width: nodesBounds.width,
				height: nodesBounds.height,
				style: {
					width: `${nodesBounds.width}px`,
					height: `${nodesBounds.height}px`,
					transform: `translate(${transform[0]}px, ${transform[1]}px) scale(${transform[2]})`,
				},
			});

			const link = document.createElement("a");
			link.download = `investigation-${investigationId || "canvas"}.png`;
			link.href = dataUrl;
			link.click();
		} catch {
			setExportError("Failed to export canvas as PNG");
		}
	}, [getNodes, investigationId]);

	const downloadJson = useCallback(() => {
		setExportError(null);

		const exportData = {
			exportedAt: new Date().toISOString(),
			investigationId,
			agentExecutions: agentExecutions.map((exec) => ({
				id: exec.id,
				agentName: exec.agentName,
				agentType: exec.agentType,
				status: exec.status,
				startedAt: exec.startedAt,
				completedAt: exec.completedAt,
				executionTimeMs: exec.executionTimeMs,
				confidence: exec.confidence,
				inputTokens: exec.inputTokens,
				outputTokens: exec.outputTokens,
				error: exec.error,
				toolExecutions: exec.toolExecutions?.map((tool) => ({
					id: tool.id,
					toolName: tool.toolName,
					toolCategory: tool.toolCategory,
					status: tool.status,
					executionTimeMs: tool.executionTimeMs,
					error: tool.error,
				})),
			})),
		};

		const blob = new Blob([JSON.stringify(exportData, null, 2)], {
			type: "application/json",
		});
		const url = URL.createObjectURL(blob);

		const link = document.createElement("a");
		link.download = `investigation-${investigationId || "data"}.json`;
		link.href = url;
		link.click();

		URL.revokeObjectURL(url);
	}, [agentExecutions, investigationId]);

	return (
		<div>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button variant="outline" size="sm">
						<Download className="h-4 w-4 mr-2" />
						Export
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end">
					<DropdownMenuLabel>Export Canvas</DropdownMenuLabel>
					<DropdownMenuSeparator />
					<DropdownMenuItem onClick={downloadImage}>
						<Image className="h-4 w-4 mr-2" />
						PNG Image
					</DropdownMenuItem>
					<DropdownMenuItem onClick={downloadJson}>
						<FileJson className="h-4 w-4 mr-2" />
						JSON Data
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
			{exportError && (
				<p className="text-sm text-destructive mt-1">{exportError}</p>
			)}
		</div>
	);
}
