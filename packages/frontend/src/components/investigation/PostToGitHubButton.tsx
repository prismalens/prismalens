// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

"use client";

import { GITHUB_ISSUE_OR_PR_URL } from "@prismalens/contracts";
import { useMutation } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Share2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { orpc } from "@/lib/api/orpc-client";
import { getErrorMessage } from "@/lib/get-error-message";

interface PostToGitHubButtonProps {
	investigationId: string;
}

/**
 * Posts the server-rendered Markdown of a completed report to a GitHub issue or PR (#606).
 */
export function PostToGitHubButton({
	investigationId,
}: PostToGitHubButtonProps) {
	const [open, setOpen] = useState(false);
	const [url, setUrl] = useState("");
	const [notConfigured, setNotConfigured] = useState(false);
	const [validationError, setValidationError] = useState<string | null>(null);
	const { toast } = useToast();

	const postMutation = useMutation({
		...orpc.investigations.postToGitHub.mutationOptions(),
		onSuccess: ({ commentUrl }) => {
			toast({
				title: "Posted",
				description: (
					<a
						href={commentUrl}
						target="_blank"
						rel="noreferrer"
						className="underline hover:opacity-80 break-all"
					>
						{commentUrl}
					</a>
				),
			});
			setOpen(false);
			setUrl("");
			setNotConfigured(false);
			setValidationError(null);
		},
		onError: (error) => {
			const message = getErrorMessage(error);
			const isPrecondition =
				(error as { code?: string })?.code === "PRECONDITION_FAILED" ||
				(error as { status?: number })?.status === 412 ||
				(error as { data?: { code?: string } })?.data?.code ===
					"PRECONDITION_FAILED" ||
				message.includes("No GitHub connection is configured");

			if (isPrecondition) {
				setNotConfigured(true);
			} else {
				toast({
					title: "Post failed",
					description: message,
					variant: "destructive",
				});
			}
		},
	});

	const handleOpenChange = (nextOpen: boolean) => {
		setOpen(nextOpen);
		if (!nextOpen) {
			setNotConfigured(false);
			setValidationError(null);
		}
	};

	const handleSubmit = (e?: React.FormEvent) => {
		if (e) e.preventDefault();
		const trimmed = url.trim();
		if (!trimmed) return;
		if (!GITHUB_ISSUE_OR_PR_URL.test(trimmed)) {
			setValidationError(
				"Must be a https://github.com/<owner>/<repo>/issues/<n> or /pull/<n> URL",
			);
			return;
		}
		setValidationError(null);
		setNotConfigured(false);
		postMutation.mutate({ id: investigationId, target: trimmed });
	};

	return (
		<Dialog open={open} onOpenChange={handleOpenChange}>
			<DialogTrigger asChild>
				<Button
					variant="ghost"
					size="sm"
					className="h-7 px-2 text-meta"
					data-testid="post-report-github"
				>
					<Share2 className="mr-1.5 h-3.5 w-3.5" />
					Post to GitHub
				</Button>
			</DialogTrigger>
			<DialogContent>
				<form onSubmit={handleSubmit}>
					<DialogHeader>
						<DialogTitle>Post to GitHub</DialogTitle>
						<DialogDescription>
							Post the completed report as a comment on a GitHub issue or pull
							request.
						</DialogDescription>
					</DialogHeader>

					<div className="space-y-4 py-4">
						{notConfigured && (
							<div
								className="rounded-md bg-destructive/10 p-3 text-sm text-destructive"
								data-testid="post-report-github-not-configured"
							>
								No GitHub connection is configured (
								<Link
									to="/settings"
									search={{ tab: "integrations" }}
									className="underline font-medium hover:text-destructive/80"
								>
									Settings → Integrations
								</Link>
								)
							</div>
						)}

						<div className="space-y-2">
							<Label htmlFor="post-report-github-url">Issue or PR URL</Label>
							<Input
								id="post-report-github-url"
								data-testid="post-report-github-url"
								placeholder="https://github.com/owner/repo/issues/123"
								value={url}
								onChange={(e) => {
									setUrl(e.target.value);
									if (validationError) setValidationError(null);
									if (notConfigured) setNotConfigured(false);
								}}
								disabled={postMutation.isPending}
							/>
							{validationError && (
								<p className="text-xs text-destructive">{validationError}</p>
							)}
						</div>
					</div>

					<DialogFooter>
						<Button
							type="submit"
							disabled={postMutation.isPending || !url.trim()}
							data-testid="post-report-github-submit"
						>
							{postMutation.isPending ? "Posting..." : "Post"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
