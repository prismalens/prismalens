// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/** Actions a service card hands to the service's page, which holds their dialogs: `?act=` names one (#1127). */
export const SERVICE_PAGE_ACTS = ["edit", "delete"] as const;
export type ServicePageAct = (typeof SERVICE_PAGE_ACTS)[number];
