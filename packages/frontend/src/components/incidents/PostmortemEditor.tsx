// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Postmortem Editor Component
 *
 * Full CRUD editor for postmortems with section-based editing,
 * action items checklist, and auto-save on blur.
 */

import type {
	ActionItem,
	PostmortemWithRelations,
} from "@prismalens/contracts";
import {
	AlertCircle,
	CheckCircle2,
	FileText,
	Plus,
	Save,
	Send,
	Sparkles,
	Trash2,
	X,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
	useCreatePostmortem,
	useDeletePostmortem,
	usePostmortemByIncident,
	usePublishPostmortem,
	useUpdatePostmortem,
} from "@/lib/api/hooks";
import { cn } from "@/lib/utils";

export interface PostmortemEditorProps {
	incidentId: string;
	incidentTitle?: string;
	className?: string;
}

function getStatusVariant(
	status: string,
): "default" | "secondary" | "destructive" | "outline" {
	switch (status) {
		case "published":
			return "default";
		case "in_review":
			return "secondary";
		case "archived":
			return "outline";
		default:
			return "outline";
	}
}

function getStatusLabel(status: string): string {
	switch (status) {
		case "draft":
			return "Draft";
		case "in_review":
			return "In Review";
		case "published":
			return "Published";
		case "archived":
			return "Archived";
		default:
			return status;
	}
}

function parseActionItems(json: string | null): ActionItem[] {
	if (!json) return [];
	try {
		return JSON.parse(json);
	} catch {
		return [];
	}
}

export function PostmortemEditor({
	incidentId,
	incidentTitle,
	className,
}: PostmortemEditorProps) {
	const { data: postmortem, isLoading } = usePostmortemByIncident(incidentId);
	const createMutation = useCreatePostmortem();
	const updateMutation = useUpdatePostmortem();
	const publishMutation = usePublishPostmortem();
	const deleteMutation = useDeletePostmortem();

	// Local form state
	const [title, setTitle] = useState("");
	const [summary, setSummary] = useState("");
	const [whatHappened, setWhatHappened] = useState("");
	const [whyItHappened, setWhyItHappened] = useState("");
	const [whatWeLearned, setWhatWeLearned] = useState("");
	const [customerImpact, setCustomerImpact] = useState("");
	const [actionItems, setActionItems] = useState<ActionItem[]>([]);

	// Sync form state with postmortem data
	useEffect(() => {
		if (postmortem) {
			setTitle(postmortem.title ?? "");
			setSummary(postmortem.summary ?? "");
			setWhatHappened(postmortem.whatHappened ?? "");
			setWhyItHappened(postmortem.whyItHappened ?? "");
			setWhatWeLearned(postmortem.whatWeLearned ?? "");
			setCustomerImpact(postmortem.customerImpact ?? "");
			setActionItems(parseActionItems(postmortem.actionItems));
		}
	}, [postmortem]);

	// Auto-save on blur
	const handleSave = useCallback(
		(field: string, value: string) => {
			if (!postmortem) return;

			const data: Record<string, string> = { [field]: value };

			// For action items, stringify the array
			if (field === "actionItems") {
				data.actionItems = value;
			}

			updateMutation.mutate({
				id: postmortem.id,
				data,
			});
		},
		[postmortem, updateMutation],
	);

	// Handle action item toggle
	const handleActionItemToggle = (itemId: string) => {
		const updated = actionItems.map((item) =>
			item.id === itemId ? { ...item, completed: !item.completed } : item,
		);
		setActionItems(updated);

		if (postmortem) {
			updateMutation.mutate({
				id: postmortem.id,
				data: { actionItems: JSON.stringify(updated) },
			});
		}
	};

	// Add new action item
	const handleAddActionItem = () => {
		const newItem: ActionItem = {
			id: `action-${Date.now()}`,
			title: "",
			completed: false,
		};
		setActionItems([...actionItems, newItem]);
	};

	// Update action item
	const handleUpdateActionItem = (
		itemId: string,
		field: keyof ActionItem,
		value: string | boolean,
	) => {
		const updated = actionItems.map((item) =>
			item.id === itemId ? { ...item, [field]: value } : item,
		);
		setActionItems(updated);
	};

	// Save action items on blur
	const handleActionItemBlur = () => {
		if (postmortem) {
			updateMutation.mutate({
				id: postmortem.id,
				data: { actionItems: JSON.stringify(actionItems) },
			});
		}
	};

	// Remove action item
	const handleRemoveActionItem = (itemId: string) => {
		const updated = actionItems.filter((item) => item.id !== itemId);
		setActionItems(updated);

		if (postmortem) {
			updateMutation.mutate({
				id: postmortem.id,
				data: { actionItems: JSON.stringify(updated) },
			});
		}
	};

	// Create postmortem (with auto-populate)
	const handleCreate = (autoPopulate: boolean) => {
		createMutation.mutate({
			incidentId,
			title: `Postmortem: ${incidentTitle ?? "Incident"}`,
			autoPopulate,
		});
	};

	// Publish postmortem
	const handlePublish = () => {
		if (postmortem) {
			publishMutation.mutate({ id: postmortem.id });
		}
	};

	// Delete postmortem
	const handleDelete = () => {
		if (postmortem) {
			deleteMutation.mutate({ id: postmortem.id });
		}
	};

	if (isLoading) {
		return (
			<Card className={className}>
				<CardContent className="flex items-center justify-center py-12">
					<div className="animate-pulse text-muted-foreground">
						Loading postmortem...
					</div>
				</CardContent>
			</Card>
		);
	}

	// No postmortem yet - show create options
	if (!postmortem) {
		return (
			<Card className={className}>
				<CardContent className="flex flex-col items-center justify-center py-12 space-y-4">
					<FileText className="h-12 w-12 text-muted-foreground" />
					<h3 className="text-lg font-medium">No Postmortem Yet</h3>
					<p className="text-sm text-muted-foreground text-center max-w-md">
						Create a postmortem to document what happened, why, and what you
						learned from this incident.
					</p>
					<div className="flex gap-3">
						<Button
							variant="outline"
							onClick={() => handleCreate(false)}
							disabled={createMutation.isPending}
						>
							<FileText className="h-4 w-4 mr-2" />
							Start Blank
						</Button>
						<Button
							onClick={() => handleCreate(true)}
							disabled={createMutation.isPending}
						>
							<Sparkles className="h-4 w-4 mr-2" />
							Auto-populate from AI
						</Button>
					</div>
				</CardContent>
			</Card>
		);
	}

	const isPublished = postmortem.status === "published";
	const isSaving = updateMutation.isPending;

	return (
		<div className={cn("space-y-6", className)}>
			{/* Header */}
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-3">
					<FileText className="h-6 w-6 text-primary" />
					<div>
						<h2 className="text-lg font-semibold">Postmortem</h2>
						<div className="flex items-center gap-2 mt-1">
							<Badge variant={getStatusVariant(postmortem.status)}>
								{getStatusLabel(postmortem.status)}
							</Badge>
							{isSaving && (
								<span className="text-xs text-muted-foreground flex items-center gap-1">
									<Save className="h-3 w-3 animate-pulse" />
									Saving...
								</span>
							)}
						</div>
					</div>
				</div>
				<div className="flex items-center gap-2">
					{!isPublished && (
						<>
							<AlertDialog>
								<AlertDialogTrigger asChild>
									<Button variant="outline" size="sm">
										<Trash2 className="h-4 w-4 mr-2" />
										Delete
									</Button>
								</AlertDialogTrigger>
								<AlertDialogContent>
									<AlertDialogHeader>
										<AlertDialogTitle>Delete Postmortem?</AlertDialogTitle>
										<AlertDialogDescription>
											This action cannot be undone. The postmortem will be
											permanently deleted.
										</AlertDialogDescription>
									</AlertDialogHeader>
									<AlertDialogFooter>
										<AlertDialogCancel>Cancel</AlertDialogCancel>
										<AlertDialogAction
											onClick={handleDelete}
											className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
										>
											Delete
										</AlertDialogAction>
									</AlertDialogFooter>
								</AlertDialogContent>
							</AlertDialog>
							<Button
								onClick={handlePublish}
								disabled={publishMutation.isPending}
							>
								<Send className="h-4 w-4 mr-2" />
								Publish
							</Button>
						</>
					)}
				</div>
			</div>

			{/* Title */}
			<Card>
				<CardHeader className="pb-3">
					<CardTitle className="text-base">Title</CardTitle>
				</CardHeader>
				<CardContent>
					<Input
						value={title}
						onChange={(e) => setTitle(e.target.value)}
						onBlur={() => handleSave("title", title)}
						placeholder="Postmortem title..."
						disabled={isPublished}
					/>
				</CardContent>
			</Card>

			{/* Summary */}
			<Card>
				<CardHeader className="pb-3">
					<CardTitle className="text-base">Summary</CardTitle>
				</CardHeader>
				<CardContent>
					<Textarea
						value={summary}
						onChange={(e) => setSummary(e.target.value)}
						onBlur={() => handleSave("summary", summary)}
						placeholder="Brief summary of the incident..."
						rows={3}
						disabled={isPublished}
					/>
				</CardContent>
			</Card>

			{/* What Happened */}
			<Card>
				<CardHeader className="pb-3">
					<CardTitle className="text-base">What Happened</CardTitle>
				</CardHeader>
				<CardContent>
					<Textarea
						value={whatHappened}
						onChange={(e) => setWhatHappened(e.target.value)}
						onBlur={() => handleSave("whatHappened", whatHappened)}
						placeholder="Describe what happened during the incident..."
						rows={5}
						disabled={isPublished}
					/>
				</CardContent>
			</Card>

			{/* Why It Happened (Root Cause) */}
			<Card>
				<CardHeader className="pb-3">
					<CardTitle className="text-base">Why It Happened</CardTitle>
				</CardHeader>
				<CardContent>
					<Textarea
						value={whyItHappened}
						onChange={(e) => setWhyItHappened(e.target.value)}
						onBlur={() => handleSave("whyItHappened", whyItHappened)}
						placeholder="Root cause analysis - why did this incident occur?"
						rows={5}
						disabled={isPublished}
					/>
				</CardContent>
			</Card>

			{/* What We Learned */}
			<Card>
				<CardHeader className="pb-3">
					<CardTitle className="text-base">What We Learned</CardTitle>
				</CardHeader>
				<CardContent>
					<Textarea
						value={whatWeLearned}
						onChange={(e) => setWhatWeLearned(e.target.value)}
						onBlur={() => handleSave("whatWeLearned", whatWeLearned)}
						placeholder="Key takeaways and lessons learned..."
						rows={5}
						disabled={isPublished}
					/>
				</CardContent>
			</Card>

			{/* Customer Impact */}
			<Card>
				<CardHeader className="pb-3">
					<CardTitle className="text-base">Customer Impact</CardTitle>
				</CardHeader>
				<CardContent>
					<Textarea
						value={customerImpact}
						onChange={(e) => setCustomerImpact(e.target.value)}
						onBlur={() => handleSave("customerImpact", customerImpact)}
						placeholder="How did this incident impact customers?"
						rows={3}
						disabled={isPublished}
					/>
				</CardContent>
			</Card>

			{/* Action Items */}
			<Card>
				<CardHeader className="pb-3">
					<div className="flex items-center justify-between">
						<CardTitle className="text-base">Action Items</CardTitle>
						{!isPublished && (
							<Button variant="outline" size="sm" onClick={handleAddActionItem}>
								<Plus className="h-4 w-4 mr-1" />
								Add Item
							</Button>
						)}
					</div>
				</CardHeader>
				<CardContent>
					{actionItems.length === 0 ? (
						<div className="text-center py-6 text-muted-foreground">
							No action items yet
						</div>
					) : (
						<div className="space-y-3">
							{actionItems.map((item) => (
								<div
									key={item.id}
									className="flex items-start gap-3 p-3 border rounded-lg"
								>
									<Checkbox
										checked={item.completed}
										onCheckedChange={() => handleActionItemToggle(item.id)}
										disabled={isPublished}
										className="mt-1"
									/>
									<div className="flex-1 space-y-2">
										<Input
											value={item.title}
											onChange={(e) =>
												handleUpdateActionItem(item.id, "title", e.target.value)
											}
											onBlur={handleActionItemBlur}
											placeholder="Action item title..."
											disabled={isPublished}
											className={cn(
												item.completed && "line-through opacity-60",
											)}
										/>
										<div className="flex items-center gap-2">
											<Select
												value={item.priority ?? "medium"}
												onValueChange={(value) => {
													handleUpdateActionItem(item.id, "priority", value);
													handleActionItemBlur();
												}}
												disabled={isPublished}
											>
												<SelectTrigger className="w-28 h-8">
													<SelectValue />
												</SelectTrigger>
												<SelectContent>
													<SelectItem value="low">Low</SelectItem>
													<SelectItem value="medium">Medium</SelectItem>
													<SelectItem value="high">High</SelectItem>
													<SelectItem value="critical">Critical</SelectItem>
												</SelectContent>
											</Select>
											{item.completed ? (
												<CheckCircle2 className="h-4 w-4 text-green-500" />
											) : (
												<AlertCircle className="h-4 w-4 text-muted-foreground" />
											)}
										</div>
									</div>
									{!isPublished && (
										<Button
											variant="ghost"
											size="icon"
											className="h-8 w-8"
											onClick={() => handleRemoveActionItem(item.id)}
										>
											<X className="h-4 w-4" />
										</Button>
									)}
								</div>
							))}
						</div>
					)}
				</CardContent>
			</Card>

			{/* Published info */}
			{isPublished && postmortem.publishedAt && (
				<div className="text-sm text-muted-foreground text-center">
					Published on{" "}
					{new Date(postmortem.publishedAt).toLocaleDateString(undefined, {
						year: "numeric",
						month: "long",
						day: "numeric",
						hour: "2-digit",
						minute: "2-digit",
					})}
				</div>
			)}
		</div>
	);
}
