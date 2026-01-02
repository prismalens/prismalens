'use client';

import React from 'react';

export interface ServiceDetailPageProps {
  params: {
    id: string;
  };
}

export default function ServiceDetailPage({ params }: ServiceDetailPageProps) {
  return (
    <div>
      {/* TODO: Implement ServiceDetailPage */}
      {/* Will use: PageHeader, Breadcrumb, ServiceConfigTabs,
          ServiceGeneralForm, ServiceIntegrationsTab,
          ServiceInvestigationTab, ServiceDependenciesTab */}
      <p>Service ID: {params.id}</p>
    </div>
  );
}
