export class UpdateRecommendationDto {
  status?: 'pending' | 'in_progress' | 'completed' | 'dismissed';
  priority?: 'low' | 'medium' | 'high' | 'critical';
}
