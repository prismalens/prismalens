// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { Redactions } from "@prismalens/contracts";
import { Mono } from "@/components/shared/Mono";
import { Loading, Problem } from "@/components/shared/State";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
} from "@/components/ui/sheet";
import { useCaseArtifact } from "@/lib/api/hooks/use-case-files-orpc";

/** "2 aws-access-key, 1 pattern" or the error that withheld the redacted copy. */
export function redactionWords(redactions: Redactions): string {
	if ("error" in redactions && typeof redactions.error === "string")
		return `Redaction failed, so the text is withheld: ${redactions.error}`;
	const counts = Object.entries(redactions as Record<string, number>).filter(
		([, n]) => n > 0,
	);
	return counts.length === 0
		? "Nothing redacted"
		: `Redacted: ${counts.map(([rule, n]) => `${n} ${rule}`).join(", ")}`;
}

/** One captured artifact's redacted text; the raw copy is never served. */
export function ArtifactDrawer({
	artifactId,
	onClose,
}: {
	artifactId: string | null;
	onClose: () => void;
}) {
	const { data, error, isLoading, refetch } = useCaseArtifact(artifactId);
	const status = (error as { status?: number } | null)?.status;
	return (
		<Sheet open={!!artifactId} onOpenChange={(open) => !open && onClose()}>
			<SheetContent
				className="flex w-full flex-col sm:max-w-2xl"
				data-testid="artifact-drawer"
			>
				<SheetHeader>
					<SheetTitle>
						{data
							? `${data.artifact.purpose}${data.artifact.subject ? `, ${data.artifact.subject}` : ""}`
							: "Artifact"}
					</SheetTitle>
					<SheetDescription>
						{data ? (
							<Mono className="break-all">
								{data.artifact.command.join(" ")}
							</Mono>
						) : (
							"The redacted copy PrismaLens stored."
						)}
					</SheetDescription>
				</SheetHeader>
				{isLoading && <Loading />}
				{error && (
					<Problem
						text={
							status === 409
								? "This artifact is withheld or has expired, so there is no text to show."
								: "The artifact did not load."
						}
						onRetry={status === 409 ? undefined : () => void refetch()}
					/>
				)}
				{data && (
					<>
						<p className="text-meta text-text-2">
							{data.artifact.retrieval}
							{data.artifact.retrievalReason
								? ` (${data.artifact.retrievalReason})`
								: ""}{" "}
							· {redactionWords(data.artifact.redactions)}
							{data.truncated && " · Showing the first 1 MiB"}
						</p>
						<pre
							className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-all rounded-control bg-well-in-pool p-3 font-mono text-meta text-text-2"
							data-testid="artifact-text"
						>
							{data.text}
						</pre>
					</>
				)}
			</SheetContent>
		</Sheet>
	);
}
