import { IsBoolean, IsOptional, IsString, IsUUID } from 'class-validator';

export class LinkRepositoryDto {
  @IsUUID()
  serviceId!: string;

  @IsOptional()
  @IsString()
  subPath?: string;

  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;
}
