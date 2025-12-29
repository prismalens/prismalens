import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule);

  // Get config service
  const configService = app.get(ConfigService);

  // Swagger documentation
  const swaggerConfig = new DocumentBuilder()
    .setTitle('PrismaLens API')
    .setDescription('AI-powered incident analysis and recommendation system')
    .setVersion('1.0')
    .addTag('alerts', 'Alert management endpoints')
    .addTag('analysis', 'Analysis run endpoints')
    .addTag('webhooks', 'Webhook ingestion endpoints')
    .addTag('recommendations', 'Recommendation endpoints')
    .addTag('health', 'Health check endpoints')
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document);

  // Enable CORS
  app.enableCors({
    origin: configService.get('CORS_ORIGIN', '*'),
    credentials: true,
  });

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  // API prefix
  app.setGlobalPrefix('api', {
    exclude: ['health', '/'],
  });

  const port = configService.get('PORT', 3000);
  const host = configService.get('HOST', '0.0.0.0');

  await app.listen(port, host);

  logger.log(`PrismaLens API running on http://${host}:${port}`);
  logger.log(`Health check: http://${host}:${port}/health`);
  logger.log(`API endpoints: http://${host}:${port}/api`);
  logger.log(`API documentation: http://${host}:${port}/api/docs`);
}

bootstrap();
