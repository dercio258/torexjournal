import { INestApplicationContext, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
import { ServerOptions } from 'socket.io';

export class RedisIoAdapter extends IoAdapter {
  private readonly logger = new Logger(RedisIoAdapter.name);
  private adapterConstructor: ReturnType<typeof createAdapter> | null = null;
  private pubClient: Redis | null = null;
  private subClient: Redis | null = null;

  constructor(appOrHttpServer: INestApplicationContext) {
    super(appOrHttpServer as any);
  }

  async connectToRedis(configService: ConfigService): Promise<boolean> {
    const host = (configService.get<string>('REDIS_HOST') || '').trim();
    const port = Number(configService.get<number>('REDIS_PORT') || 6379);
    const password = configService.get<string>('REDIS_PASSWORD') || undefined;

    if (!host) {
      this.logger.warn(
        'REDIS_HOST não configurado; WebSocket usará adapter em memória (single-instance).',
      );
      return false;
    }

    const baseOpts = {
      host,
      port,
      password,
      maxRetriesPerRequest: null as number | null,
      enableReadyCheck: true,
      lazyConnect: true,
    };

    const pub = new Redis(baseOpts);
    const sub = pub.duplicate();

    pub.on('error', (err) => {
      this.logger.warn(`RedisIoAdapter pub error: ${err?.message || err}`);
    });
    sub.on('error', (err) => {
      this.logger.warn(`RedisIoAdapter sub error: ${err?.message || err}`);
    });

    try {
      await Promise.race([
        Promise.all([pub.connect(), sub.connect()]),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('RedisIoAdapter connect timeout')), 4000),
        ),
      ]);

      this.pubClient = pub;
      this.subClient = sub;
      this.adapterConstructor = createAdapter(pub, sub, {
        key: `${configService.get<string>('REDIS_PREFIX') || '{cossa_trading}'}:socket.io`,
      });
      this.logger.log(`Socket.IO Redis adapter conectado (${host}:${port})`);
      return true;
    } catch (err: any) {
      this.logger.warn(
        `Falha ao conectar Socket.IO Redis adapter (${err?.message || err}); usando fallback em memória.`,
      );
      try {
        pub.disconnect();
      } catch {
        // ignore
      }
      try {
        sub.disconnect();
      } catch {
        // ignore
      }
      this.adapterConstructor = null;
      return false;
    }
  }

  override createIOServer(port: number, options?: ServerOptions): any {
    const server = super.createIOServer(port, options);
    if (this.adapterConstructor) {
      server.adapter(this.adapterConstructor);
    }
    return server;
  }

  async closeClients(): Promise<void> {
    try {
      await this.pubClient?.quit();
    } catch {
      this.pubClient?.disconnect();
    }
    try {
      await this.subClient?.quit();
    } catch {
      this.subClient?.disconnect();
    }
  }
}
