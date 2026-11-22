import * as dotenv from 'dotenv';
dotenv.config();
dotenv.config({ path: '../.env' });
dotenv.config({ path: 'backend-nest/.env' });

import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisIoAdapter } from './common/adapters/redis-io.adapter';
import { Transport, MicroserviceOptions } from '@nestjs/microservices';
import { GenericExceptionFilter } from './common/filters/generic-exception.filter';
import { PinoLoggerService } from './common/observability/pino-logger.service';
import { TelemetryService } from './common/observability/telemetry.service';
import { correlationStorage } from './common/observability/correlation.context';
import {
  getTrustProxySetting,
  isCorsOriginAllowed,
  isHttpsEnforced,
  isLoopbackRequest,
  isRequestHttps,
  validateDomainSecretsOnBoot,
} from './common/security/security.config';
import { encryptJsonEnvelopeForClient } from './common/security/payload-envelope.util';
import { randomUUID } from 'crypto';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { join } from 'path';
import * as fs from 'fs';

function resolveHttpsOptions(): { key: Buffer; cert: Buffer; ca?: Buffer } | undefined {
  const keyPath = process.env.SSL_KEY_PATH?.trim();
  const certPath = process.env.SSL_CERT_PATH?.trim();
  if (!keyPath || !certPath) return undefined;

  if (!fs.existsSync(keyPath) || !fs.existsSync(certPath)) {
    throw new Error(`SSL_KEY_PATH ou SSL_CERT_PATH configurado mas não encontrado em disco.`);
  }

  const caPath = process.env.SSL_CA_PATH?.trim();
  return {
    key: fs.readFileSync(keyPath),
    cert: fs.readFileSync(certPath),
    ...(caPath && fs.existsSync(caPath) ? { ca: fs.readFileSync(caPath) } : {}),
  };
}

async function bootstrap() {
  const httpsOptions = resolveHttpsOptions();
  const fastifyOptions: any = {
    trustProxy: getTrustProxySetting(),
    bodyLimit: 52428800,
    ...(httpsOptions ? { https: httpsOptions } : {}),
  };

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(fastifyOptions),
    { rawBody: true, bufferLogs: true },
  );

  const configService = app.get(ConfigService);
  // Fail fast in production if user/admin JWT secrets are missing, weak, or collide
  validateDomainSecretsOnBoot(configService);

  const logger = app.get(PinoLoggerService);
  const telemetry = app.get(TelemetryService);
  app.useLogger(logger);

  const enforceHttps = isHttpsEnforced(configService);
  const fastifyInstance = app.getHttpAdapter().getInstance();

  // Fastify Correlation ID + HTTPS Enforcement + Structured HTTP Access Telemetry Hook
  fastifyInstance.addHook('onRequest', (req: any, reply: any, done: () => void) => {
    const incomingCid = req.headers['x-correlation-id'] || req.headers['x-request-id'];
    const correlationId =
      typeof incomingCid === 'string' && incomingCid.trim().length > 0
        ? incomingCid.trim().slice(0, 64)
        : randomUUID();

    req.correlationId = correlationId;
    req.requestStartMs = Date.now();
    reply.header('X-Correlation-Id', correlationId);

    const rawUrl: string = req.url || '/';
    const cleanPath = rawUrl.split('?')[0];

    // Enforce HTTPS when enabled/in production (skip loopback health/local workers)
    if (
      enforceHttps &&
      !isRequestHttps(req) &&
      !isLoopbackRequest(req) &&
      cleanPath !== '/api/health'
    ) {
      const host = String(req.headers?.host || '').replace(/[^a-zA-Z0-9.:-]/g, '');
      if (req.method === 'GET' || req.method === 'HEAD') {
        if (host) {
          reply.code(301).redirect(`https://${host}${rawUrl}`);
          return;
        }
      }
      reply.code(403).send({
        statusCode: 403,
        error: 'HTTPS Required',
        message: 'Comunicação insegura rejeitada. Utilize o protocolo HTTPS.',
      });
      return;
    }

    correlationStorage.run(
      {
        correlationId,
        method: req.method,
        path: cleanPath,
        startedAt: req.requestStartMs,
      },
      done,
    );
  });

  // Security Response Headers (Helmet-equivalent without external dependency)
  fastifyInstance.addHook('onSend', (req: any, reply: any, payload: any, done: (err?: any, val?: any) => void) => {
    const cleanPath = (req.url || '').split('?')[0];

    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('X-XSS-Protection', '0');
    reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    reply.header('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');

    if (enforceHttps || isRequestHttps(req)) {
      reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
    }

    // Isolate user-uploaded assets in /uploads/ so HTML/SVG files can never execute JS on our origin
    if (cleanPath.startsWith('/uploads')) {
      reply.header('Content-Security-Policy', "default-src 'none'; sandbox");
      reply.header('Cross-Origin-Resource-Policy', 'same-site');
    }

    if (cleanPath.startsWith('/api') && (req.headers?.authorization || req.headers?.['x-torex-kem'])) {
      reply.header('Cache-Control', 'no-store, no-cache, must-revalidate, private');
      reply.header('Pragma', 'no-cache');
    }

    if (
      cleanPath.startsWith('/api') &&
      !cleanPath.startsWith('/api/health') &&
      !cleanPath.startsWith('/api/webhook') &&
      !cleanPath.startsWith('/api/mt5-worker')
    ) {
      const clientKem = req.headers?.['x-torex-kem'];
      const statusCode = reply.statusCode || 200;
      const contentType = String(reply.getHeader('content-type') || '');
      if (
        typeof clientKem === 'string' &&
        clientKem.length >= 80 &&
        statusCode >= 200 &&
        statusCode < 300 &&
        statusCode !== 204 &&
        typeof payload === 'string' &&
        payload.length > 0 &&
        contentType.includes('application/json')
      ) {
        const encrypted = encryptJsonEnvelopeForClient(payload, clientKem);
        if (encrypted) {
          reply.header('X-Torex-Enc', 'ecdh-p256-aes256gcm-v1');
          done(null, encrypted);
          return;
        }
      }
    }

    done(null, payload);
  });

  fastifyInstance.addHook('onResponse', (req: any, reply: any, done: () => void) => {
    const rawUrl: string = req.url || '';
    const cleanPath = rawUrl.split('?')[0];
    if (cleanPath.startsWith('/api')) {
      const durationMs = Date.now() - (req.requestStartMs || Date.now());
      const statusCode = reply.statusCode || 200;
      telemetry.recordHttpRequest(req.method, cleanPath, statusCode, durationMs);

      const isQuietWorkerPoll =
        statusCode < 400 &&
        (cleanPath.includes('/mt5-worker/heartbeat') || cleanPath.includes('/mt5-worker/tasks'));

      if (!isQuietWorkerPoll) {
        const line = `${req.method} ${cleanPath} -> ${statusCode} (${durationMs}ms)`;
        if (statusCode >= 500) {
          logger.error(line, undefined, 'HttpAccess');
        } else if (statusCode >= 400) {
          logger.warn(line, 'HttpAccess');
        } else {
          logger.log(line, 'HttpAccess');
        }
      }
    }
    done();
  });

  // Register Fastify Multipart support
  await app.register(multipart, {
    limits: {
      fileSize: 52428800, // 50MB max multipart limit (per-route interceptors enforce tighter limits)
    },
  });

  // Register uploads static serving with nosniff + sandbox CSP headers
  const uploadsDir = join(process.cwd(), 'uploads');
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }
  await app.register(fastifyStatic, {
    root: uploadsDir,
    prefix: '/uploads/',
    decorateReply: false,
    setHeaders: (res) => {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
      res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
    },
  });

  // Register Frontend static files (client/dist) with proper MIME types & SPA fallback
  const candidateClientPaths = [
    join(process.cwd(), '..', 'client', 'dist'),
    join(process.cwd(), 'client', 'dist'),
    join(__dirname, '..', '..', 'client', 'dist'),
    join(__dirname, '..', 'client', 'dist'),
  ];
  const clientDist = candidateClientPaths.find((p) => fs.existsSync(p));

  if (clientDist) {
    const assetsDir = join(clientDist, 'assets');
    if (!fs.existsSync(assetsDir)) {
      fs.mkdirSync(assetsDir, { recursive: true });
    }

    await app.register(fastifyStatic, {
      root: assetsDir,
      prefix: '/assets/',
      wildcard: true,
      decorateReply: false,
      setHeaders: (res) => {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      },
    });

    await app.register(fastifyStatic, {
      root: clientDist,
      prefix: '/',
      wildcard: false,
      decorateReply: false,
      setHeaders: (res, filePath) => {
        if (
          filePath.endsWith('.html') ||
          filePath.endsWith('sw.js') ||
          filePath.endsWith('registerSW.js') ||
          filePath.endsWith('.webmanifest') ||
          /workbox-[a-zA-Z0-9_-]+\.js$/.test(filePath)
        ) {
          res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
          res.setHeader('Pragma', 'no-cache');
          res.setHeader('Expires', '0');
        }
      },
    });
    logger.log(`Frontend SPA static files served from: ${clientDist}`, 'Bootstrap');
  } else {
    logger.warn(
      'Frontend client/dist not found. Run "cd client && npm run build" to serve the frontend.',
      'Bootstrap',
    );
  }

  // Enable CORS with explicit allowlist validation
  app.enableCors({
    origin: (origin, callback) => {
      if (isCorsOriginAllowed(origin, configService)) {
        callback(null, true);
      } else {
        callback(new Error(`CORS origin denied: ${origin}`), false);
      }
    },
    credentials: true,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    allowedHeaders:
      'Content-Type, Accept, Authorization, App-Token, X-App-Token, X-Account-Id, X-Correlation-Id, X-Request-Id, X-Worker-Id, X-Worker-Key, X-Idempotency-Key, X-Client-Updated-At, X-Sync-Replay',
    exposedHeaders: 'X-Correlation-Id, X-Idempotency-Replayed',
  });

  // Connect RabbitMQ Microservice (Optional)
  if (process.env.RABBITMQ_ENABLED === 'true') {
    app.connectMicroservice<MicroserviceOptions>({
      transport: Transport.RMQ,
      options: {
        urls: [process.env.RABBITMQ_URL || 'amqp://rabbitmq:5672'],
        queue: process.env.RABBITMQ_QUEUE || 'platform_notifications',
        queueOptions: {
          durable: false,
        },
      },
    });
    logger.log('RabbitMQ Microservice connected', 'Bootstrap');
  } else {
    logger.log('RabbitMQ microservice disabled via configuration', 'Bootstrap');
  }

  // Use Socket.IO Redis Adapter (supports multi-instance pub/sub + fallback em memória)
  const redisIoAdapter = new RedisIoAdapter(app);
  await redisIoAdapter.connectToRedis(configService).catch(() => false);
  app.useWebSocketAdapter(redisIoAdapter as any);

  // Global Validation Pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidUnknownValues: true,
    }),
  );

  // Global Generic Exception Filter with Telemetry integration
  app.useGlobalFilters(new GenericExceptionFilter(telemetry));

  // Global Prefix
  app.setGlobalPrefix('api');

  // Start microservices if enabled
  if (process.env.RABBITMQ_ENABLED === 'true') {
    await app.startAllMicroservices();
  }

  const port = configService.get<number>('PORT') || 3000;
  const baseUrl = configService.get<string>('BASE_URL');

  if (!baseUrl && process.env.NODE_ENV === 'production') {
    logger.error(
      'BASE_URL is NOT defined in production! Links and callbacks may resolve improperly.',
      undefined,
      'Bootstrap',
    );
  }

  await app.listen(port, '0.0.0.0');
  const protocol = httpsOptions ? 'https' : 'http';
  const actualBaseUrl = baseUrl || `${protocol}://localhost:${port}`;
  logger.log(
    `NestJS Backend listening on port ${port} (${protocol.toUpperCase()}) | HTTPS Enforced: ${enforceHttps} | API: ${actualBaseUrl}/api`,
    'Bootstrap',
  );
}
bootstrap();
