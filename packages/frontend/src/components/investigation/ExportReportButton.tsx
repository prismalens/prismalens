// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { orpc } from "@/lib/api/orpc-client";
import { download } from "@/lib/download";
import { getErrorMessage } from "@/lib/get-error-message";
import { cn } from "@/lib/utils";

/** Downloads the server-rendered Markdown of a completed report (#606). */
export function ExportReportButton({
	investigationId,
	label = "Export Markdown",
	className,
}: {
	investigationId: string;
	label?: string;
	className?: string;
}) {
	const { toast } = useToast();
	const exportMutation = useMutation({
		...orpc.investigations.exportMarkdown.mutationOptions(),
		onSuccess: ({ filename, markdown }) => download(filename, markdown),
		onError: (error) =>
			toast({
				title: "Export failed",
				description: getErrorMessage(error),
				variant: "destructive",
			}),
	});

	return (
		<Button
			variant="ghost"
			size="sm"
			className={cn("h-7 px-2 text-body text-text-2", className)}
			onClick={() => exportMutation.mutate({ id: investigationId })}
			disabled={exportMutation.isPending}
			data-testid="export-report-markdown"
		>
			{label}
		</Button>
	);
}
