import { useState, useMemo } from "react";
import { Loader2, GitBranch, Rocket } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";

interface ConnectionInfo {
	id: string;
	label?: string | null;
	status: string;
	template?: {
		category?: string;
	} | null;
	integration?: {
		templateId?: string;
		label?: string | null;
	} | null;
}

interface RunDiscoveryDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	connections: ConnectionInfo[];
	onRun: (connectionIds: string[]) => void;
	isPending: boolean;
}

function getCategory(conn: ConnectionInfo): string {
	return conn.template?.category ?? "other";
}

function getCategoryLabel(category: string): string {
	switch (category) {
		case "vcs": return "VCS Providers";
		case "deployment": return "Deployment Platforms";
		default: return "Other";
	}
}

function getCategoryIcon(category: string) {
	switch (category) {
		case "vcs": return GitBranch;
		case "deployment": return Rocket;
		default: return GitBranch;
	}
}

export function RunDiscoveryDialog({
	open,
	onOpenChange,
	connections,
	onRun,
	isPending,
}: RunDiscoveryDialogProps) {
	const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

	const grouped = useMemo(() => {
		const groups = new Map<string, ConnectionInfo[]>();
		for (const conn of connections) {
			const cat = getCategory(conn);
			const list = groups.get(cat) ?? [];
			list.push(conn);
			groups.set(cat, list);
		}
		return groups;
	}, [connections]);

	// Auto-select all on open
	const handleOpenChange = (next: boolean) => {
		if (next) {
			setSelectedIds(new Set(connections.map((c) => c.id)));
		} else {
			setSelectedIds(new Set());
		}
		onOpenChange(next);
	};

	const toggleConnection = (id: string) => {
		setSelectedIds((prev) => {
			const next = new Set(prev);
			if (next.has(id)) {
				next.delete(id);
			} else {
				next.add(id);
			}
			return next;
		});
	};

	const toggleGroup = (category: string) => {
		const groupConns = grouped.get(category) ?? [];
		const allSelected = groupConns.every((c) => selectedIds.has(c.id));
		setSelectedIds((prev) => {
			const next = new Set(prev);
			for (const conn of groupConns) {
				if (allSelected) {
					next.delete(conn.id);
				} else {
					next.add(conn.id);
				}
			}
			return next;
		});
	};

	const handleRun = () => {
		onRun(Array.from(selectedIds));
	};

	const getConnectionLabel = (conn: ConnectionInfo): string => {
		return conn.label || conn.integration?.label || conn.integration?.templateId || "Unknown";
	};

	return (
		<Dialog open={open} onOpenChange={handleOpenChange}>
			<DialogContent className="max-w-md">
				<DialogHeader>
					<DialogTitle>Run Discovery</DialogTitle>
					<DialogDescription>
						Select which integrations to scan for services.
					</DialogDescription>
				</DialogHeader>

				<div className="space-y-4">
					{Array.from(grouped.entries()).map(([category, conns]) => {
						const Icon = getCategoryIcon(category);
						const allSelected = conns.every((c) => selectedIds.has(c.id));
						const someSelected = conns.some((c) => selectedIds.has(c.id));

						return (
							<div key={category} className="space-y-2">
								<div className="flex items-center gap-2">
									<Checkbox
										id={`group-${category}`}
										checked={allSelected ? true : someSelected ? "indeterminate" : false}
										onCheckedChange={() => toggleGroup(category)}
									/>
									<Label
										htmlFor={`group-${category}`}
										className="flex items-center gap-1.5 text-sm font-medium cursor-pointer"
									>
										<Icon className="h-4 w-4 text-muted-foreground" />
										{getCategoryLabel(category)}
									</Label>
								</div>

								<div className="ml-6 space-y-1.5">
									{conns.map((conn) => {
										const isActive = conn.status === "ACTIVE";
										return (
											<div key={conn.id} className="flex items-center gap-2">
												<Checkbox
													id={`conn-${conn.id}`}
													checked={selectedIds.has(conn.id)}
													onCheckedChange={() => toggleConnection(conn.id)}
													disabled={!isActive}
												/>
												<Label
													htmlFor={`conn-${conn.id}`}
													className="flex items-center gap-2 text-sm font-normal cursor-pointer"
												>
													{getConnectionLabel(conn)}
													<Badge
														variant={isActive ? "default" : "secondary"}
														className="text-xs"
													>
														{isActive ? "Connected" : conn.status}
													</Badge>
												</Label>
											</div>
										);
									})}
								</div>
							</div>
						);
					})}

					{connections.length === 0 && (
						<p className="text-sm text-muted-foreground text-center py-4">
							No discovery-capable integrations configured.
						</p>
					)}
				</div>

				<DialogFooter>
					<Button variant="outline" onClick={() => handleOpenChange(false)}>
						Cancel
					</Button>
					<Button
						onClick={handleRun}
						disabled={selectedIds.size === 0 || isPending}
					>
						{isPending && (
							<Loader2 className="mr-2 h-4 w-4 animate-spin" />
						)}
						Scan Selected ({selectedIds.size})
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
