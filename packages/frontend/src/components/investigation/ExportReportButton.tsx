// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { useMutation } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { orpc } from "@/lib/api/orpc-client";
import { download } from "@/lib/download";
import { getErrorMessage } from "@/lib/get-error-message";

/** Downloads the server-rendered Markdown of a completed report (#606). */
export function ExportReportButton({
	investigationId,
}: {
	investigationId: string;
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
			className="h-7 px-2 text-meta"
			onClick={() => exportMutation.mutate({ id: investigationId })}
			disabled={exportMutation.isPending}
			data-testid="export-report-markdown"
		>
			<Download className="mr-1.5 h-3.5 w-3.5" />
			Export Markdown
		</Button>
	);
}
