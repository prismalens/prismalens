import { PrismaClient, prisma } from '@prismalens/database';

/**
 * Seed integration definitions (catalog of available integrations).
 * OAuth credentials are NOT seeded here - they're configured by admin via API.
 */
export async function seedIntegrationDefinitions(prisma: PrismaClient): Promise<void> {
  const definitions = [
    {
      name: 'github',
      displayName: 'GitHub',
      description:
        'Connect to GitHub repositories for code analysis, commit history, and pull request information during incident investigation.',
      category: 'code_source',
      authType: 'both',
      maxConnectionsCE: null,  // Unlimited code sources in CE
      configSchema: JSON.stringify({
        type: 'object',
        properties: {
          organization: {
            type: 'string',
            description: 'GitHub organization name',
          },
          repositories: {
            type: 'array',
            items: { type: 'string' },
            description: 'List of repositories to analyze (org/repo format)',
          },
          defaultBranch: {
            type: 'string',
            default: 'main',
            description: 'Default branch for code analysis',
          },
        },
      }),
      iconUrl: 'https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png',
      docsUrl: 'https://docs.github.com/en/rest',
      isEnabled: true,
    },
    {
      name: 'prometheus',
      displayName: 'Prometheus',
      description:
        'Connect to Prometheus for querying metrics, checking alert status, and gathering performance data during investigation.',
      category: 'monitoring',
      authType: 'api_key',
      maxConnectionsCE: 1,  // Only 1 monitoring integration in CE
      configSchema: JSON.stringify({
        type: 'object',
        required: ['baseUrl'],
        properties: {
          baseUrl: {
            type: 'string',
            description: 'Prometheus server URL (e.g., http://prometheus:9090)',
          },
          username: {
            type: 'string',
            description: 'Basic auth username (optional)',
          },
          defaultStep: {
            type: 'string',
            default: '1m',
            description: 'Default step for range queries',
          },
          maxPoints: {
            type: 'number',
            default: 1000,
            description: 'Maximum data points to return',
          },
        },
      }),
      iconUrl: 'https://prometheus.io/assets/prometheus_logo_grey.svg',
      docsUrl: 'https://prometheus.io/docs/prometheus/latest/querying/api/',
      isEnabled: true,
    },
    {
      name: 'slack',
      displayName: 'Slack',
      description:
        'Send notifications to Slack channels when investigations complete or high-priority recommendations are generated.',
      category: 'knowledge_base',
      authType: 'both',
      maxConnectionsCE: null,  // Unlimited knowledge bases in CE
      configSchema: JSON.stringify({
        type: 'object',
        properties: {
          defaultChannel: {
            type: 'string',
            description: 'Default Slack channel for notifications (e.g., #incidents)',
          },
          webhookUrl: {
            type: 'string',
            description: 'Slack webhook URL for simple notifications',
          },
          mentionUsers: {
            type: 'array',
            items: { type: 'string' },
            description: 'Slack user IDs to mention on critical alerts',
          },
          includeSummary: {
            type: 'boolean',
            default: true,
            description: 'Include investigation summary in notifications',
          },
        },
      }),
      iconUrl: 'https://a.slack-edge.com/80588/marketing/img/icons/icon_slack_hash_colored.png',
      docsUrl: 'https://api.slack.com/messaging/webhooks',
      isEnabled: true,
    },
  ];

  console.log('Seeding integration definitions...');

  for (const def of definitions) {
    await prisma.integrationDefinition.upsert({
      where: { name: def.name },
      update: {
        displayName: def.displayName,
        description: def.description,
        category: def.category,
        authType: def.authType,
        maxConnectionsCE: def.maxConnectionsCE,
        configSchema: def.configSchema,
        iconUrl: def.iconUrl,
        docsUrl: def.docsUrl,
        isEnabled: def.isEnabled,
      },
      create: def,
    });
    console.log(`  - ${def.displayName} (${def.name})`);
  }

  console.log('Integration definitions seeded successfully.');
}

// Allow running directly
if (import.meta.url === `file://${process.argv[1]}`) {
  seedIntegrationDefinitions(prisma)
    .then(() => prisma.$disconnect())
    .catch((e) => {
      console.error(e);
      prisma.$disconnect();
      process.exit(1);
    });
}
