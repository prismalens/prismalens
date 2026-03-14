import { useState } from "react";
import { FolderGit2, Link2, Loader2 } from "lucide-react";
import type { RepositoryWithServices, ServiceWithRelations } from "@prismalens/contracts";

import { useLinkRepository } from "@/lib/api/hooks";
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
import { MutationError } from "@/components/shared/MutationError";

interface UnlinkedReposDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	unlinkedRepos: RepositoryWithServices[];
	services: ServiceWithRelations[];
}

export function UnlinkedReposDialog({
	open,
	onOpenChange,
	unlinkedRepos,
	services,
}: UnlinkedReposDialogProps) {
	const [linkingRepoId, setLinkingRepoId] = useState<string | null>(null);
	const linkRepo = useLinkRepository();

	const handleLink = (repositoryId: string, serviceId: string) => {
		linkRepo.mutate(
			{ id: repositoryId, serviceId, isPrimary: true },
			{
				onSuccess: () => setLinkingRepoId(null),
			},
		);
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-lg max-h-[70vh] overflow-y-auto">
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2">
						<FolderGit2 className="h-5 w-5" />
						Unlinked Repositories ({unlinkedRepos.length})
					</DialogTitle>
					<DialogDescription>
						These repositories are not linked to any service. Link them to
						enable code context during AI investigations.
					</DialogDescription>
				</DialogHeader>

				<MutationError error={linkRepo.error} className="mb-2" />

				<div className="space-y-3">
					{unlinkedRepos.map((repo) => (
						<div
							key={repo.id}
							className="flex items-center justify-between p-3 border rounded-lg"
						>
							<div className="min-w-0 flex-1">
								<p className="font-medium text-sm truncate">
									{repo.fullName}
								</p>
								<div className="flex items-center gap-2 mt-0.5">
									{repo.language && (
										<Badge variant="outline" className="text-xs">
											{repo.language}
										</Badge>
									)}
									{repo.isPrivate && (
										<Badge variant="secondary" className="text-xs">
											Private
										</Badge>
									)}
								</div>
							</div>

							{linkingRepoId === repo.id ? (
								<div className="flex items-center gap-2 flex-shrink-0">
									<Select
										onValueChange={(serviceId) =>
											handleLink(repo.id, serviceId)
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
									{linkRepo.isPending && (
										<Loader2 className="h-4 w-4 animate-spin" />
									)}
									<Button
										variant="ghost"
										size="sm"
										onClick={() => setLinkingRepoId(null)}
									>
										Cancel
									</Button>
								</div>
							) : (
								<Button
									variant="outline"
									size="sm"
									onClick={() => setLinkingRepoId(repo.id)}
								>
									<Link2 className="h-3 w-3 mr-1" />
									Link
								</Button>
							)}
						</div>
					))}

					{unlinkedRepos.length === 0 && (
						<p className="text-sm text-muted-foreground text-center py-4">
							All repositories are linked to services.
						</p>
					)}
				</div>
			</DialogContent>
		</Dialog>
	);
}
