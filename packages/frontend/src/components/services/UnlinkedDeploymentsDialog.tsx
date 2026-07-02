import type { Deployment, ServiceWithRelations } from "@prismalens/contracts";
import { Link2, Loader2, Rocket, Trash2 } from "lucide-react";
import { useState } from "react";
import { MutationError } from "@/components/shared/MutationError";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { useDeleteDeployment, useLinkDeployment } from "@/lib/api/hooks";

interface UnlinkedDeploymentsDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	unlinkedDeployments: Deployment[];
	services: ServiceWithRelations[];
}

const statusColors: Record<string, string> = {
	live: "text-green-600",
	active: "text-green-600",
	running: "text-green-600",
	building: "text-yellow-600",
	suspended: "text-orange-600",
	deactivated: "text-muted-foreground",
};

export function UnlinkedDeploymentsDialog({
	open,
	onOpenChange,
	unlinkedDeployments,
	services,
}: UnlinkedDeploymentsDialogProps) {
	const [linkingDeployId, setLinkingDeployId] = useState<string | null>(null);
	const [deletingDeployId, setDeletingDeployId] = useState<string | null>(null);
	const linkDeploy = useLinkDeployment();
	const deleteDeploy = useDeleteDeployment();

	const handleLink = (deploymentId: string, serviceId: string) => {
		linkDeploy.mutate(
			{ id: deploymentId, serviceId },
			{
				onSuccess: () => setLinkingDeployId(null),
			},
		);
	};

	const handleDelete = (id: string) => {
		deleteDeploy.mutate(
			{ id },
			{
				onSuccess: () => setDeletingDeployId(null),
			},
		);
	};

	const deployToDelete = unlinkedDeployments.find(
		(d) => d.id === deletingDeployId,
	);

	return (
		<>
			<Dialog open={open} onOpenChange={onOpenChange}>
				<DialogContent className="max-w-lg max-h-[70vh] overflow-y-auto">
					<DialogHeader>
						<DialogTitle className="flex items-center gap-2">
							<Rocket className="h-5 w-5" />
							Unlinked Deployments ({unlinkedDeployments.length})
						</DialogTitle>
						<DialogDescription>
							These deployments are not linked to any service. Link them to
							enable log and metric access during AI investigations.
						</DialogDescription>
					</DialogHeader>

					<MutationError error={linkDeploy.error} className="mb-2" />
					<MutationError error={deleteDeploy.error} className="mb-2" />

					<div className="space-y-3">
						{unlinkedDeployments.map((deploy) => (
							<div
								key={deploy.id}
								className="flex items-center justify-between p-3 border rounded-lg"
							>
								<div className="min-w-0 flex-1">
									<p className="font-medium text-sm truncate">{deploy.name}</p>
									<div className="flex items-center gap-2 mt-0.5">
										{deploy.status && (
											<Badge variant="outline" className="text-xs">
												<span
													className={
														statusColors[deploy.status.toLowerCase()] ?? ""
													}
												>
													{deploy.status}
												</span>
											</Badge>
										)}
										{deploy.environment && (
											<Badge variant="secondary" className="text-xs">
												{deploy.environment}
											</Badge>
										)}
									</div>
								</div>

								{linkingDeployId === deploy.id ? (
									<div className="flex items-center gap-2 flex-shrink-0">
										<Select
											onValueChange={(serviceId) =>
												handleLink(deploy.id, serviceId)
											}
										>
											<SelectTrigger className="w-[180px] h-8">
												<SelectValue placeholder="Select service..." />
											</SelectTrigger>
											<SelectContent>
												{services.map((svc) => (
													<SelectItem key={svc.id} value={svc.id}>
														{svc.displayName || svc.name}
													</SelectItem>
												))}
											</SelectContent>
										</Select>
										{linkDeploy.isPending && (
											<Loader2 className="h-4 w-4 animate-spin" />
										)}
										<Button
											variant="ghost"
											size="sm"
											onClick={() => setLinkingDeployId(null)}
										>
											Cancel
										</Button>
									</div>
								) : (
									<div className="flex items-center gap-1 flex-shrink-0">
										<Button
											variant="outline"
											size="sm"
											onClick={() => setLinkingDeployId(deploy.id)}
										>
											<Link2 className="h-3 w-3 mr-1" />
											Link
										</Button>
										<Button
											variant="ghost"
											size="sm"
											className="text-destructive hover:text-destructive"
											onClick={() => setDeletingDeployId(deploy.id)}
										>
											<Trash2 className="h-3 w-3" />
										</Button>
									</div>
								)}
							</div>
						))}

						{unlinkedDeployments.length === 0 && (
							<p className="text-sm text-muted-foreground text-center py-4">
								All deployments are linked to services.
							</p>
						)}
					</div>
				</DialogContent>
			</Dialog>

			<AlertDialog
				open={!!deletingDeployId}
				onOpenChange={(open) => {
					if (!open) setDeletingDeployId(null);
				}}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete deployment</AlertDialogTitle>
						<AlertDialogDescription>
							Delete <strong>{deployToDelete?.name}</strong>? This removes it
							from PrismaLens. It does not affect the actual deployment on the
							provider.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
							onClick={() => {
								if (deletingDeployId) handleDelete(deletingDeployId);
							}}
							disabled={deleteDeploy.isPending}
						>
							{deleteDeploy.isPending ? (
								<Loader2 className="h-4 w-4 animate-spin mr-1" />
							) : null}
							Delete
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}
