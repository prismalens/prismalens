import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { UpdateLlmDto } from './dto/update-llm.dto.js';

@Injectable()
export class SettingsService {
    constructor(private prisma: PrismaService) { }

    private getProviderKey(provider: string) {
        return `LLM_CONFIG_${provider.toUpperCase()}`;
    }

    async getAllLlmConfigs() {
        // Fetch all settings that start with LLM_CONFIG_
        const allSettings = await this.prisma.setting.findMany({
            where: {
                key: { startsWith: 'LLM_CONFIG_' },
            },
        });

        const activeSetting = await this.prisma.setting.findUnique({
            where: { key: 'LLM_ACTIVE_PROVIDER' },
        });

        return {
            activeProvider: activeSetting ? JSON.parse(activeSetting.value).provider : null,
            providers: allSettings.map((s) => {
                const providerName = s.key.replace('LLM_CONFIG_', '').toLowerCase();
                const val = JSON.parse(s.value);
                return {
                    provider: providerName,
                    model: val.model,
                    hasApiKey: !!val.apiKey, // Do not return raw API key
                    baseUrl: val.baseUrl
                };
            }),
        };
    }

    async getLlmConfig(provider: string) {
        const key = this.getProviderKey(provider);
        const setting = await this.prisma.setting.findUnique({
            where: { key },
        });

        if (!setting) {
            throw new NotFoundException(`No configuration found for provider: ${provider}`);
        }

        const val = JSON.parse(setting.value);
        // Mask API key for UI
        return {
            ...val,
            apiKey: '********'
        };
    }

    async updateLlmConfig(provider: string, dto: UpdateLlmDto) {
        const key = this.getProviderKey(provider);
        const value = JSON.stringify({
            apiKey: dto.apiKey,
            model: dto.model,
            baseUrl: dto.baseUrl
        });

        // Determine type based on provider potentially, but 'json' is safe default
        return this.prisma.setting.upsert({
            where: { key },
            update: { value, type: 'json', category: 'ai' },
            create: { key, value, type: 'json', category: 'ai' },
        });
    }

    async deleteLlmConfig(provider: string) {
        const key = this.getProviderKey(provider);

        // Check if active
        const activeSetting = await this.prisma.setting.findUnique({
            where: { key: 'LLM_ACTIVE_PROVIDER' },
        });

        if (activeSetting && JSON.parse(activeSetting.value).provider === provider) {
            // Unset active if we are deleting it
            await this.prisma.setting.delete({ where: { key: 'LLM_ACTIVE_PROVIDER' } });
        }

        return this.prisma.setting.delete({
            where: { key }
        });
    }

    async setActiveProvider(provider: string) {
        // Verify config exists using count instead of findUnique to avoid fetching data
        const key = this.getProviderKey(provider);
        const count = await this.prisma.setting.count({ where: { key } });

        if (count === 0) {
            throw new NotFoundException(`Provider ${provider} not configured`);
        }

        return this.prisma.setting.upsert({
            where: { key: 'LLM_ACTIVE_PROVIDER' },
            update: { value: JSON.stringify({ provider }), type: 'json', category: 'ai' },
            create: { key: 'LLM_ACTIVE_PROVIDER', value: JSON.stringify({ provider }), type: 'json', category: 'ai' },
        });
    }

    // INTERNAL method for Worker
    async getActiveLlmConfigInternal() {
        const activeSetting = await this.prisma.setting.findUnique({
            where: { key: 'LLM_ACTIVE_PROVIDER' },
        });

        if (!activeSetting) {
            return null;
        }

        const provider = JSON.parse(activeSetting.value).provider;
        const key = this.getProviderKey(provider);

        const configSetting = await this.prisma.setting.findUnique({ where: { key } });

        if (!configSetting) {
            return null;
        }

        const config = JSON.parse(configSetting.value);
        return {
            provider,
            ...config
        };
    }
}
