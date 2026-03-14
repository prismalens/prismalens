import { useState } from "react";
import { FolderGit2, GitBranch, Plus, Unlink } from "lucide-react";
import type { ServiceWithRelations } from "@prismalens/contracts";

import { useUnlinkRepository } from "@/lib/api/hooks";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MutationError } from "@/components/shared/MutationError";
import { LinkRepositoryDialog } from "./LinkRepositoryDialog";

interface ServiceRepositoriesTabProps {
	serviceId: string;
	service: ServiceWithRelations;
}

export function ServiceRepositoriesTab({ serviceId, service }: ServiceRepositoriesTabProps) {
	const [showLinkDialog, setShowLinkDialog] = useState(false);
	const repos = service.repositories ?? [];
	const unlinkRepo = useUnlinkRepository();
	const linkedRepoIds = repos.map((sr) => sr.repositoryId);

	return (
		<div className="space-y-4">
			<div className="flex items-center justify-between">
				<h3 className="text-sm font-medium">
					Linked Repositories ({repos.length})
				</h3>
				<Button size="sm" variant="outline" onClick={() => setShowLinkDialog(true)}>
					<Plus className="h-4 w-4 mr-1" />
					Link Repository
				</Button>
			</div>

			<MutationError error={unlinkRepo.error} className="mb-4" />

			<div className="rounded-md border">
				{repos.length > 0 ? (
					<div className="divide-y">
						{repos.map((sr) => (
							<div
								key={sr.id}
								className="flex items-center justify-between p-4 hover:bg-muted/50"
							>
								<div className="min-w-0 flex-1">
									<div className="flex items-center gap-2">
										<FolderGit2 className="h-4 w-4 text-muted-foreground flex-shrink-0" />
										<span className="font-medium text-sm truncate">
											{sr.repository.fullName}
										</span>
										{sr.isPrimary && (
											<Badge variant="default" className="text-xs">PRIMARY</Badge>
										)}
									</div>
									<div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
										{sr.repository.language && (
											<span>{sr.repository.language}</span>
										)}
										{sr.repository.defaultBranch && (
											<span className="flex items-center gap-1">
												<GitBranch className="h-3 w-3" />
												{sr.repository.defaultBranch}
											</span>
										)}
										{sr.subPath && (
											<span className="font-mono">/{sr.subPath}</span>
										)}
									</div>
								</div>
								<Button
									variant="ghost"
									size="sm"
									className="text-destructive hover:text-destructive"
									disabled={unlinkRepo.isPending}
									onClick={() =>
										unlinkRepo.mutate({
											id: sr.repositoryId,
											serviceId,
										})
									}
								>
									<Unlink className="h-4 w-4 mr-1" />
									Unlink
								</Button>
							</div>
						))}
					</div>
				) : (
					<p className="p-4 text-sm text-muted-foreground text-center">
						No repositories linked to this service
					</p>
				)}
			</div>

			<LinkRepositoryDialog
				open={showLinkDialog}
				onOpenChange={setShowLinkDialog}
				serviceId={serviceId}
				linkedRepositoryIds={linkedRepoIds}
			/>
		</div>
	);
}
