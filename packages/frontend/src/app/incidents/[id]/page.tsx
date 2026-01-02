'use client';

import React from 'react';

export interface IncidentDetailPageProps {
  params: {
    id: string;
  };
}

export default function IncidentDetailPage({ params }: IncidentDetailPageProps) {
  return (
    <div>
      {/* TODO: Implement IncidentDetailPage */}
      {/* Will use: IncidentDetailHeader, IncidentOverview, CorrelatedAlerts,
          InvestigationProgress, RootCauseAnalysis, RecommendationsList,
          InvestigationCanvas */}
      <p>Incident ID: {params.id}</p>
    </div>
  );
}
