// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

"use client";

import { SERVICE_TIER_METADATA } from "@prismalens/contracts/schemas";
import { Clock, Loader2, Settings2, Zap } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	useInvestigationLimits,
	useInvestigationPolicies,
	useUpdateInvestigationLimits,
	useUpdateInvestigationPolicy,
} from "@/lib/api/hooks";

export function InvestigationSettings() {
	const { data: policies, isLoading: policiesLoading } =
		useInvestigationPolicies();
	const { data: limits, isLoading: limitsLoading } = useInvestigationLimits();
	const updatePolicy = useUpdateInvestigationPolicy();
	const updateLimits = useUpdateInvestigationLimits();

	const [editingLimits, setEditingLimits] = useState(false);
	const [localLimits, setLocalLimits] = useState({
		maxConcurrent: 5,
		timeoutMinutes: 30,
		maxToolCalls: 100,
	});

	// Sync local limits with server data
	useEffect(() => {
		if (limits) {
			setLocalLimits({
				maxConcurrent: limits.maxConcurrent,
				timeoutMinutes: limits.timeoutMinutes,
				maxToolCalls: limits.maxToolCalls,
			});
		}
	}, [limits]);

	const autoInvestigateOptions = [
		{ value: "always", label: "Always" },
		{ value: "critical_high", label: "Critical & High only" },
		{ value: "manual", label: "Manual trigger" },
		{ value: "never", label: "Never" },
	];

	const handlePolicyChange = async (
		tier: string,
		field: string,
		value: boolean | string,
	) => {
		const currentPolicy = policies?.policies.find((p) => p.tier === tier);
		if (!currentPolicy) return;

		const { tier: _tier, ...policyWithoutTier } = currentPolicy;
		await updatePolicy.mutateAsync({
			tier: tier as "tier_1" | "tier_2" | "tier_3" | "tier_4",
			...policyWithoutTier,
			[field]: value,
		});
	};

	const handleSaveLimits = async () => {
		await updateLimits.mutateAsync(localLimits);
		setEditingLimits(false);
	};

	if (policiesLoading || limitsLoading) {
		return (
			<Card>
				<CardContent className="flex items-center justify-center py-12">
					<Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
				</CardContent>
			</Card>
		);
	}

	return (
		<div className="space-y-6">
			{/* Tier Policies */}
			<Card>
				<CardHeader>
					<div className="flex items-center gap-2">
						<Settings2 className="h-5 w-5 text-muted-foreground" />
						<CardTitle>Investigation Policies</CardTitle>
					</div>
				</CardHeader>
				<CardContent className="space-y-4">
					{(policies?.policies ?? []).map((policy) => {
						const tierMeta = SERVICE_TIER_METADATA[policy.tier];

						return (
							<div
								key={policy.tier}
								className="p-4 border rounded-lg space-y-4"
							>
								<div className="flex items-center justify-between">
									<div>
										<h3 className="font-medium">{tierMeta.name}</h3>
										<p className="text-sm text-muted-foreground">
											{tierMeta.description}
										</p>
									</div>
									<div className="flex items-center gap-2">
										<Zap className="h-4 w-4 text-muted-foreground" />
										<Select
											value={policy.autoInvestigate}
											onValueChange={(value) =>
												handlePolicyChange(
													policy.tier,
													"autoInvestigate",
													value,
												)
											}
										>
											<SelectTrigger className="w-[180px]">
												<SelectValue />
											</SelectTrigger>
											<SelectContent>
												{autoInvestigateOptions.map((opt) => (
													<SelectItem key={opt.value} value={opt.value}>
														{opt.label}
													</SelectItem>
												))}
											</SelectContent>
										</Select>
									</div>
								</div>

								<div className="grid grid-cols-3 gap-4 pt-2 border-t">
									<div className="flex items-center gap-2">
										<Checkbox
											id={`${policy.tier}-requiresApproval`}
											checked={policy.requiresApproval}
											onCheckedChange={(checked) =>
												handlePolicyChange(
													policy.tier,
													"requiresApproval",
													!!checked,
												)
											}
										/>
										<Label
											htmlFor={`${policy.tier}-requiresApproval`}
											className="text-sm font-normal"
										>
											Requires approval
										</Label>
									</div>
									<div className="flex items-center gap-2">
										<Checkbox
											id={`${policy.tier}-pageOnCall`}
											checked={policy.pageOnCall}
											onCheckedChange={(checked) =>
												handlePolicyChange(policy.tier, "pageOnCall", !!checked)
											}
										/>
										<Label
											htmlFor={`${policy.tier}-pageOnCall`}
											className="text-sm font-normal"
										>
											Page on-call
										</Label>
									</div>
									<div className="flex items-center gap-2">
										<Checkbox
											id={`${policy.tier}-postToSlack`}
											checked={policy.postToSlack}
											onCheckedChange={(checked) =>
												handlePolicyChange(
													policy.tier,
													"postToSlack",
													!!checked,
												)
											}
										/>
										<Label
											htmlFor={`${policy.tier}-postToSlack`}
											className="text-sm font-normal"
										>
											Post to Slack
										</Label>
									</div>
								</div>
							</div>
						);
					})}
				</CardContent>
			</Card>

			{/* Investigation Limits */}
			<Card>
				<CardHeader>
					<div className="flex items-center justify-between">
						<div className="flex items-center gap-2">
							<Clock className="h-5 w-5 text-muted-foreground" />
							<CardTitle>Investigation Limits</CardTitle>
						</div>
						{!editingLimits && (
							<Button variant="outline" onClick={() => setEditingLimits(true)}>
								Edit Limits
							</Button>
						)}
					</div>
				</CardHeader>
				<CardContent>
					{editingLimits ? (
						<div className="space-y-4">
							<div className="grid grid-cols-3 gap-4">
								<div className="space-y-2">
									<Label htmlFor="maxConcurrent">Max Concurrent</Label>
									<Input
										id="maxConcurrent"
										type="number"
										min={1}
										max={100}
										value={localLimits.maxConcurrent}
										onChange={(e) =>
											setLocalLimits({
												...localLimits,
												maxConcurrent: parseInt(e.target.value, 10) || 1,
											})
										}
									/>
									<p className="text-xs text-muted-foreground">
										Max investigations running at once
									</p>
								</div>
								<div className="space-y-2">
									<Label htmlFor="timeoutMinutes">Timeout (minutes)</Label>
									<Input
										id="timeoutMinutes"
										type="number"
										min={1}
										max={120}
										value={localLimits.timeoutMinutes}
										onChange={(e) =>
											setLocalLimits({
												...localLimits,
												timeoutMinutes: parseInt(e.target.value, 10) || 1,
											})
										}
									/>
									<p className="text-xs text-muted-foreground">
										Max time per investigation
									</p>
								</div>
								<div className="space-y-2">
									<Label htmlFor="maxToolCalls">Max Tool Calls</Label>
									<Input
										id="maxToolCalls"
										type="number"
										min={1}
										max={500}
										value={localLimits.maxToolCalls}
										onChange={(e) =>
											setLocalLimits({
												...localLimits,
												maxToolCalls: parseInt(e.target.value, 10) || 1,
											})
										}
									/>
									<p className="text-xs text-muted-foreground">
										Max AI tool calls per investigation
									</p>
								</div>
							</div>
							<div className="flex gap-2 pt-2">
								<Button
									onClick={handleSaveLimits}
									disabled={updateLimits.isPending}
								>
									{updateLimits.isPending && (
										<Loader2 className="mr-2 h-4 w-4 animate-spin" />
									)}
									Save Limits
								</Button>
								<Button
									variant="outline"
									onClick={() => {
										setEditingLimits(false);
										if (limits) {
											setLocalLimits({
												maxConcurrent: limits.maxConcurrent,
												timeoutMinutes: limits.timeoutMinutes,
												maxToolCalls: limits.maxToolCalls,
											});
										}
									}}
								>
									Cancel
								</Button>
							</div>
						</div>
					) : (
						<div className="flex items-center gap-8 text-sm">
							<div>
								<span className="text-muted-foreground">Max Concurrent:</span>{" "}
								<span className="font-medium">
									{limits?.maxConcurrent || 5}
								</span>
							</div>
							<div>
								<span className="text-muted-foreground">Timeout:</span>{" "}
								<span className="font-medium">
									{limits?.timeoutMinutes || 30}m
								</span>
							</div>
							<div>
								<span className="text-muted-foreground">Max Tool Calls:</span>{" "}
								<span className="font-medium">
									{limits?.maxToolCalls || 100}
								</span>
							</div>
						</div>
					)}
				</CardContent>
			</Card>
		</div>
	);
}
