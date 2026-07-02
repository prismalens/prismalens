import { Loader2, Rocket, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useDeployments, useLinkDeployment } from "@/lib/api/hooks";
import { cn } from "@/lib/utils";

const STATUS_COLORS: Record<string, string> = {
	live: "text-green-500",
	active: "text-green-500",
	building: "text-yellow-500",
	suspended: "text-orange-500",
	deactivated: "text-red-500",
};

interface LinkDeploymentDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	serviceId: string;
	linkedDeploymentIds: string[];
	onSuccess?: () => void;
}

export function LinkDeploymentDialog({
	open,
	onOpenChange,
	serviceId,
	linkedDeploymentIds,
	onSuccess,
}: LinkDeploymentDialogProps) {
	const [search, setSearch] = useState("");
	const [debouncedSearch, setDebouncedSearch] = useState("");
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	const linkDeployment = useLinkDeployment();

	useEffect(() => {
		const timer = setTimeout(() => setDebouncedSearch(search), 300);
		return () => clearTimeout(timer);
	}, [search]);

	// Fetch unlinked deployments (no serviceId filter means all deployments)
	const { data: deploymentResponse, isLoading } = useDeployments({
		search: debouncedSearch || undefined,
		limit: 20,
	});

	const excludedIds = useMemo(
		() => new Set(linkedDeploymentIds),
		[linkedDeploymentIds],
	);

	const filteredDeployments = useMemo(() => {
		const deployments = deploymentResponse?.data ?? [];
		// Show only unlinked deployments (serviceId is null) or not already linked to this service
		return deployments.filter((d) => !excludedIds.has(d.id) && !d.serviceId);
	}, [deploymentResponse, excludedIds]);

	const handleClose = useCallback(() => {
		setSearch("");
		setDebouncedSearch("");
		setSelectedId(null);
		setError(null);
		onOpenChange(false);
	}, [onOpenChange]);

	const handleSubmit = async () => {
		if (!selectedId) return;
		setError(null);

		try {
			await linkDeployment.mutateAsync({
				id: selectedId,
				serviceId,
			});
			handleClose();
			onSuccess?.();
		} catch (err) {
			const message =
				err instanceof Error ? err.message : "Failed to link deployment";
			setError(message);
		}
	};

	return (
		<Dialog open={open} onOpenChange={handleClose}>
			<DialogContent className="max-w-md">
				<DialogHeader>
					<DialogTitle>Link Deployment</DialogTitle>
					<DialogDescription>
						Select an unlinked deployment to associate with this service.
					</DialogDescription>
				</DialogHeader>

				<div className="space-y-4">
					<div className="relative">
						<Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
						<Input
							placeholder="Search deployments..."
							value={search}
							onChange={(e) => setSearch(e.target.value)}
							className="pl-9"
						/>
					</div>

					<div className="max-h-64 overflow-y-auto border rounded-md">
						{isLoading ? (
							<div className="flex items-center justify-center py-8">
								<Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
							</div>
						) : filteredDeployments.length === 0 ? (
							<p className="text-sm text-muted-foreground text-center py-8">
								{debouncedSearch
									? "No matching deployments found"
									: "No unlinked deployments available"}
							</p>
						) : (
							<div className="p-1 space-y-0.5">
								{filteredDeployments.map((deployment) => (
									<button
										key={deployment.id}
										type="button"
										className={cn(
											"w-full flex items-center justify-between gap-2 p-2 rounded text-left text-sm hover:bg-muted/50 transition-colors",
											selectedId === deployment.id &&
												"bg-muted border border-border",
										)}
										onClick={() => setSelectedId(deployment.id)}
									>
										<div className="min-w-0">
											<div className="flex items-center gap-1.5">
												<Rocket className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
												<p className="font-medium truncate">
													{deployment.name}
												</p>
												{deployment.status && (
													<span
														className={cn(
															"text-xs",
															STATUS_COLORS[deployment.status] ??
																"text-muted-foreground",
														)}
													>
														{deployment.status}
													</span>
												)}
											</div>
											<div className="flex items-center gap-2 ml-5 text-xs text-muted-foreground">
												{deployment.deploymentType && (
													<span>{deployment.deploymentType}</span>
												)}
												{deployment.region && <span>{deployment.region}</span>}
												{deployment.url && (
													<span className="truncate max-w-[200px]">
														{deployment.url}
													</span>
												)}
											</div>
										</div>
									</button>
								))}
							</div>
						)}
					</div>

					{error && <p className="text-sm text-destructive">{error}</p>}
				</div>

				<DialogFooter>
					<Button variant="outline" onClick={handleClose}>
						Cancel
					</Button>
					<Button
						onClick={handleSubmit}
						disabled={!selectedId || linkDeployment.isPending}
					>
						{linkDeployment.isPending && (
							<Loader2 className="mr-2 h-4 w-4 animate-spin" />
						)}
						Link Deployment
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
