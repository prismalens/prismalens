import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class UpdateLlmDto {
    @IsNotEmpty()
    @IsString()
    apiKey: string;

    @IsOptional()
    @IsString()
    model?: string;

    @IsOptional()
    @IsString()
    baseUrl?: string;
}

export class SetActiveProviderDto {
    @IsNotEmpty()
    @IsString()
    provider: string;
}
