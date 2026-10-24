import * as dotenv from 'dotenv';
dotenv.config();
dotenv.config({ path: '../.env' });
dotenv.config({ path: 'backend-nest/.env' });

import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { Transport, MicroserviceOptions } from '@nestjs/microservices';
import { GenericExceptionFilter } from './common/filters/generic-exception.filter';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { join } from 'path';
import * as fs from 'fs';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ trustProxy: true, bodyLimit: 52428800 }),
    { rawBody: true }
  );

  // Register Fastify Multipart support
  await app.register(multipart, {
    limits: {
      fileSize: 52428800, // 50MB file size limit
    }
  });

  // Register uploads static serving
  const uploadsDir = join(process.cwd(), 'uploads');
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }
  await app.register(fastifyStatic, {
    root: uploadsDir,
    prefix: '/uploads/',
    decorateReply: false
  });

  // Register Frontend static files (client/dist) with proper MIME types & SPA fallback
  const candidateClientPaths = [
    join(process.cwd(), '..', 'client', 'dist'),
    join(process.cwd(), 'client', 'dist'),
    join(__dirname, '..', '..', 'client', 'dist'),
    join(__dirname, '..', 'client', 'dist'),
  ];
  const clientDist = candidateClientPaths.find(p => fs.existsSync(p));

  if (clientDist) {
    await app.register(fastifyStatic, {
      root: clientDist,
      prefix: '/',
      wildcard: true,
      decorateReply: false
    });
    console.log(`✅ Frontend SPA static files served from: ${clientDist}`);

    // SPA Fallback Handler: redirect non-API frontend routes to index.html
    const fastifyInstance = app.getHttpAdapter().getInstance();
    fastifyInstance.setNotFoundHandler((req: any, reply: any) => {
      const url = req.raw?.url || req.url || '';
      // Retornar 404 apenas para endpoints de API e uploads
      if (url.startsWith('/api') || url.startsWith('/uploads')) {
        reply.status(404).send({
          statusCode: 404,
          message: `Cannot ${req.raw?.method || req.method} ${url}`,
          error: 'Not Found'
        });
        return;
      }

      // Arquivos estáticos com extensão ausentes (.js, .css, .png, etc.)
      if (/\.[a-zA-Z0-9]+$/.test(url.split('?')[0])) {
        reply.status(404).send({
          statusCode: 404,
          message: `Static file not found: ${url}`,
          error: 'Not Found'
        });
        return;
      }

      // Rotas do React SPA (ex: /add-trades, /dashboard, /login)
      const indexPath = join(clientDist, 'index.html');
      if (fs.existsSync(indexPath)) {
        reply.type('text/html').send(fs.createReadStream(indexPath));
      } else {
        reply.status(404).send({
          statusCode: 404,
          message: `Cannot ${req.raw?.method || req.method} ${url}`,
          error: 'Not Found'
        });
      }
    });
  } else {
    console.warn('⚠️ Frontend client/dist not found. Run "cd client && npm run build" to serve the frontend.');
  }

  // Enable CORS
  app.enableCors({
    origin: '*', // Allow all for dev, restrict in prod
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    allowedHeaders: 'Content-Type, Accept, Authorization, App-Token',
  });

  // Connect RabbitMQ Microservice (Optional)
  if (process.env.RABBITMQ_ENABLED === 'true') {
    app.connectMicroservice<MicroserviceOptions>({
      transport: Transport.RMQ,
      options: {
        urls: [process.env.RABBITMQ_URL || 'amqp://rabbitmq:5672'],
        queue: 'whatsapp_notifications',
        queueOptions: {
          durable: false,
        },
      },
    });
    console.log('✅ RabbitMQ Microservice connected');
  } else {
    console.warn('⚠️ RabbitMQ is disabled. Microservices will not be started.');
  }

  // Use Socket.IO Adapter (supports namespaces)
  app.useWebSocketAdapter(new (IoAdapter as any)(app) as any);

  // Global Validation Pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );

  // Global Generic Exception Filter
  app.useGlobalFilters(new GenericExceptionFilter());

  // Global Prefix
  app.setGlobalPrefix('api');

  // Start microservices if enabled
  if (process.env.RABBITMQ_ENABLED === 'true') {
    await app.startAllMicroservices();
  }

  // Use ConfigService to get the Port (Ensures .env is loaded correctly)
  const configService = app.get(ConfigService);
  const port = configService.get<number>('PORT');
  const baseUrl = configService.get<string>('BASE_URL');
  
  if (!baseUrl && process.env.NODE_ENV === 'production') {
    console.error('❌ BASE_URL is NOT defined in production! This will cause issues with links and callbacks.');
  }

  await app.listen(port);
  const actualBaseUrl = baseUrl || `http://localhost:${port}`;
  console.log(`🚀 NestJS Backend running on port ${port}`);
  console.log(`🌍 Base URL: ${actualBaseUrl}`);
  console.log(`📡 API Base: ${actualBaseUrl}/api`);
}
bootstrap();
