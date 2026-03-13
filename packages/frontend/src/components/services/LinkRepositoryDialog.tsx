import { useState, useMemo, useEffect, useCallback } from "react";
import { Loader2, Search, GitBranch } from "lucide-react";

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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

import { useRepositories, useLinkRepository } from "@/lib/api/hooks";

interface LinkRepositoryDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	serviceId: string;
	linkedRepositoryIds: string[];
	onSuccess?: () => void;
}

export function LinkRepositoryDialog({
	open,
	onOpenChange,
	serviceId,
	linkedRepositoryIds,
	onSuccess,
}: LinkRepositoryDialogProps) {
	const [search, setSearch] = useState("");
	const [debouncedSearch, setDebouncedSearch] = useState("");
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [subPath, setSubPath] = useState("");
	const [isPrimary, setIsPrimary] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const linkRepository = useLinkRepository();

	useEffect(() => {
		const timer = setTimeout(() => setDebouncedSearch(search), 300);
		return () => clearTimeout(timer);
	}, [search]);

	const { data: repoResponse, isLoading } = useRepositories({
		search: debouncedSearch || undefined,
		limit: 20,
	});

	const excludedIds = useMemo(
		() => new Set(linkedRepositoryIds),
		[linkedRepositoryIds],
	);

	const filteredRepos = useMemo(() => {
		const repos = repoResponse?.data ?? [];
		return repos.filter((r) => !excludedIds.has(r.id));
	}, [repoResponse, excludedIds]);

	const handleClose = useCallback(() => {
		setSearch("");
		setDebouncedSearch("");
		setSelectedId(null);
		setSubPath("");
		setIsPrimary(false);
		setError(null);
		onOpenChange(false);
	}, [onOpenChange]);

	const handleSubmit = async () => {
		if (!selectedId) return;
		setError(null);

		try {
			await linkRepository.mutateAsync({
				id: selectedId,
				serviceId,
				subPath: subPath || undefined,
				isPrimary,
			});
			handleClose();
			onSuccess?.();
		} catch (err) {
			const message =
				err instanceof Error ? err.message : "Failed to link repository";
			setError(message);
		}
	};

	return (
		<Dialog open={open} onOpenChange={handleClose}>
			<DialogContent className="max-w-md">
				<DialogHeader>
					<DialogTitle>Link Repository</DialogTitle>
					<DialogDescription>
						Select a repository to link to this service.
					</DialogDescription>
				</DialogHeader>

				<div className="space-y-4">
					<div className="relative">
						<Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
						<Input
							placeholder="Search repositories..."
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
						) : filteredRepos.length === 0 ? (
							<p className="text-sm text-muted-foreground text-center py-8">
								{debouncedSearch
									? "No matching repositories found"
									: "No available repositories"}
							</p>
						) : (
							<div className="p-1 space-y-0.5">
								{filteredRepos.map((repo) => (
									<button
										key={repo.id}
										type="button"
										className={cn(
											"w-full flex items-center justify-between gap-2 p-2 rounded text-left text-sm hover:bg-muted/50 transition-colors",
											selectedId === repo.id &&
												"bg-muted border border-border",
										)}
										onClick={() => setSelectedId(repo.id)}
									>
										<div className="min-w-0">
											<div className="flex items-center gap-1.5">
												<GitBranch className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
												<p className="font-medium truncate">
													{repo.fullName}
												</p>
											</div>
											{repo.description && (
												<p className="text-xs text-muted-foreground truncate ml-5">
													{repo.description}
												</p>
											)}
										</div>
										{repo.language && (
											<Badge variant="outline" className="shrink-0 text-xs">
												{repo.language}
											</Badge>
										)}
									</button>
								))}
							</div>
						)}
					</div>

					<div className="space-y-2">
						<Label htmlFor="link-repo-subpath">Sub-path (optional)</Label>
						<Input
							id="link-repo-subpath"
							placeholder="e.g. packages/api"
							value={subPath}
							onChange={(e) => setSubPath(e.target.value)}
						/>
						<p className="text-xs text-muted-foreground">
							For monorepos, specify the path to this service within the repository.
						</p>
					</div>

					<div className="flex items-center gap-2">
						<Checkbox
							id="link-repo-primary"
							checked={isPrimary}
							onCheckedChange={(checked) => setIsPrimary(checked === true)}
						/>
						<Label htmlFor="link-repo-primary" className="text-sm font-normal">
							Set as primary repository
						</Label>
					</div>

					{error && (
						<p className="text-sm text-destructive">{error}</p>
					)}
				</div>

				<DialogFooter>
					<Button variant="outline" onClick={handleClose}>
						Cancel
					</Button>
					<Button
						onClick={handleSubmit}
						disabled={!selectedId || linkRepository.isPending}
					>
						{linkRepository.isPending && (
							<Loader2 className="mr-2 h-4 w-4 animate-spin" />
						)}
						Link Repository
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
