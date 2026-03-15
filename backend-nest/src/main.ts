import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { Transport, MicroserviceOptions } from '@nestjs/microservices';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

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
        urls: [process.env.RABBITMQ_URL || 'amqp://localhost:5672'],
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
  app.useWebSocketAdapter(new IoAdapter(app));

  // Global Validation Pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );

  // Global Prefix
  app.setGlobalPrefix('api');

  // Start microservices if enabled
  if (process.env.RABBITMQ_ENABLED === 'true') {
    await app.startAllMicroservices();
  }

  // Start on Port 3000 to match frontend proxy
  const port = process.env.PORT || 3000;
  const baseUrl = process.env.BASE_URL || `http://localhost:${port}`;
  await app.listen(port);
  console.log(`🚀 NestJS Backend running on ${baseUrl}`);
  console.log(`📡 API Base: ${baseUrl}/api`);
}
bootstrap();
