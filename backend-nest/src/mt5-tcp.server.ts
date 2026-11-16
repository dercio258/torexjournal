import {
    Injectable,
    OnModuleInit,
    OnModuleDestroy,
    Logger,
    Inject,
    forwardRef,
    Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as net from 'net';
import Redis from 'ioredis';
import { Mt5Service } from './mt5/mt5.service';
import { TelemetryService } from './common/observability/telemetry.service';
import { diagnoseRedisError, formatErrorDetails } from './common/observability/error-formatter';

interface TcpClientSession {
    socket: net.Socket;
    authenticated: boolean;
    userId?: string;
    accountId?: string;
    appToken?: string;
    lastHbPersistedAt?: number;
}

@Injectable()
export class Mt5TcpServer implements OnModuleInit, OnModuleDestroy {
    private server: net.Server;
    private readonly logger = new Logger(Mt5TcpServer.name);
    private redis: Redis;
    private readonly redisEndpoint: string;
    private lastRedisErrorLoggedAt = 0;
    private lastRedisErrorKey = '';

    private clients = new Map<string, TcpClientSession>();

    constructor(
        private configService: ConfigService,
        @Inject(forwardRef(() => Mt5Service)) private mt5Service: Mt5Service,
        @Optional() private telemetry?: TelemetryService,
    ) {
        const host = this.configService.get<string>('REDIS_HOST') || '127.0.0.1';
        const port = Number(this.configService.get<number>('REDIS_PORT') || 6379);
        this.redisEndpoint = `${host}:${port}`;

        this.redis = new Redis({
            host,
            port,
            password: this.configService.get('REDIS_PASSWORD'),
            keyPrefix: this.configService.get('REDIS_PREFIX', '{cossa_trading}'),
            maxRetriesPerRequest: 3,
        });
        this.redis.on('error', (err) => {
            this.logRedisErrorThrottled('Conexão Redis TCP Server', err);
        });
    }

    private logRedisErrorThrottled(operation: string, err: unknown) {
        const diag = diagnoseRedisError(err, this.redisEndpoint);
        const now = Date.now();
        if (diag.technicalSummary !== this.lastRedisErrorKey || now - this.lastRedisErrorLoggedAt >= 30_000) {
            this.lastRedisErrorKey = diag.technicalSummary;
            this.lastRedisErrorLoggedAt = now;
            this.logger.error(
                `[${operation}] ${diag.explanation} | detalhe: ${diag.technicalSummary}`,
                err instanceof Error ? err.stack : undefined,
            );
            this.telemetry?.recordError('mt5-tcp-redis', `${operation}: ${diag.technicalSummary}`);
        }
    }

    async onModuleInit() {
        const port = Number(this.configService.get<number>('MT5_TCP_PORT') || 3003);
        this.server = net.createServer((socket) => this.handleConnection(socket));
        this.server.on('error', (err: any) => {
            if (err?.code === 'EADDRINUSE') {
                this.logger.warn(
                    `MT5 TCP port ${port} already in use by another instance; skipping duplicate TCP listener.`,
                );
                return;
            }
            this.logger.error(`MT5 TCP Server error: ${err?.message || err}`);
        });
        this.server.listen(port, '0.0.0.0', () => {
            this.logger.log(`MT5 TCP Server V2 listening on port ${port}`);
        });
    }

    onModuleDestroy() {
        if (this.server) {
            try {
                this.server.close();
            } catch {
                // ignore
            }
        }
        if (this.redis) {
            this.redis.disconnect();
        }
    }

    private handleConnection(socket: net.Socket) {
        const socketId = `${socket.remoteAddress}:${socket.remotePort}`;
        this.clients.set(socketId, { socket, authenticated: false });

        let buffer = Buffer.alloc(0);

        socket.on('data', (chunk) => {
            if (buffer.length + chunk.length > 5 * 1024 * 1024) {
                socket.destroy();
                return;
            }
            buffer = Buffer.concat([buffer, chunk]);

            while (buffer.length >= 5) {
                const msgId = buffer.readUInt8(0);
                const msgSize = buffer.readUInt32LE(1);

                if (msgSize > 1024 * 1024) {
                    socket.destroy();
                    return;
                }

                if (buffer.length < 5 + msgSize) break;

                const payload = buffer.subarray(5, 5 + msgSize);
                buffer = buffer.subarray(5 + msgSize);

                this.processPacket(socketId, msgId, payload);
            }
        });

        socket.on('error', (err) => {
            this.logger.debug(`TCP socket error (${socketId}): ${err.message}`);
            this.cleanupClient(socketId);
        });

        socket.on('close', () => {
            this.cleanupClient(socketId);
        });
    }

    private cleanupClient(id: string) {
        this.clients.delete(id);
    }

    private processPacket(socketId: string, msgId: number, payload: Buffer) {
        const client = this.clients.get(socketId);
        if (!client) return;

        // --- HANDLER: AUTH (ID 1) ---
        if (msgId === 1) {
            const token = (this.extractStringField(payload, 1) || payload.toString()).trim();
            this.validateClient(client, token);
            return;
        }

        if (!client.authenticated) {
            client.socket.destroy();
            return;
        }

        // --- HANDLER: HEARTBEAT (ID 99) ---
        if (msgId === 99) {
            this.telemetry?.recordMt5Metric('tcpHeartbeats', 1);
            const now = Date.now();
            if (client.appToken && (!client.lastHbPersistedAt || now - client.lastHbPersistedAt >= 30_000)) {
                client.lastHbPersistedAt = now;
                this.mt5Service.updateHeartbeat(client.appToken).catch(() => {});
            }
            return;
        }

        // --- HANDLER: MARKET DATA (ID 3) ---
        if (msgId === 3) {
            const symbol = this.extractStringField(payload, 1);
            const jsonStr = this.extractStringField(payload, 2);

            if (symbol && jsonStr) {
                try {
                    const data = JSON.parse(jsonStr);
                    this.redis
                        .xadd(
                            'stream:mt5_market_data',
                            'MAXLEN',
                            '~',
                            10000,
                            '*',
                            'data',
                            JSON.stringify({
                                ts: Date.now(),
                                symbol,
                                token: client.appToken,
                                ...data,
                            }),
                        )
                        .catch((err) => this.logRedisErrorThrottled('XADD stream:mt5_market_data', err));
                } catch {
                    // ignore malformed JSON
                }
            }
        }

        // --- HANDLER: TRADE DATA (ID 4) ---
        if (msgId === 4) {
            const jsonStr = this.extractStringField(payload, 1);
            if (jsonStr) {
                try {
                    JSON.parse(jsonStr);
                    this.redis
                        .xadd(
                            'stream:mt5_trade_data',
                            'MAXLEN',
                            '~',
                            5000,
                            '*',
                            'data',
                            jsonStr,
                            'userId',
                            client.userId || '',
                            'accountId',
                            client.accountId || '',
                        )
                        .catch((err) => this.logRedisErrorThrottled('XADD stream:mt5_trade_data', err));
                } catch (e) {
                    this.logger.warn(
                        `JSON de trade inválido recebido via TCP (account=${client.accountId || 'n/a'}): ${formatErrorDetails(e)}`,
                    );
                }
            }
        }
    }

    public sendCommand(socketId: string, cmdType: number, payloadStr: string = ''): boolean {
        const client = this.clients.get(socketId);
        if (!client || !client.authenticated) return false;

        const payloadBuffer = Buffer.alloc(1 + Buffer.byteLength(payloadStr));
        payloadBuffer.writeUInt8(cmdType, 0);
        payloadBuffer.write(payloadStr, 1);

        this.sendPacket(client.socket, 8, payloadBuffer);
        return true;
    }

    private sendPacket(socket: net.Socket, msgId: number, payload: Buffer) {
        if (socket.destroyed) return;
        const header = Buffer.alloc(5);
        header.writeUInt8(msgId, 0);
        header.writeUInt32LE(payload.length, 1);
        socket.write(Buffer.concat([header, payload]));
    }

    private async validateClient(client: TcpClientSession, token: string) {
        try {
            const account = await this.mt5Service.validateAppToken(token);
            if (account) {
                client.authenticated = true;
                client.userId = account.userId;
                client.accountId = account.id;
                client.appToken = token;
                client.lastHbPersistedAt = Date.now();
                this.logger.log(
                    `MT5 TCP client authenticated: ${client.socket.remoteAddress} (account=${account.id})`,
                );
                this.sendPacket(client.socket, 2, Buffer.alloc(0));

                await this.mt5Service.updateHeartbeat(token);
            } else {
                this.logger.warn(`Invalid MT5 TCP token from ${client.socket.remoteAddress}`);
                const errorMsg = 'Erro: Token Inválido ou Conta não encontrada.';
                this.sendPacket(client.socket, 5, Buffer.from(errorMsg, 'utf-8'));

                setTimeout(() => {
                    if (!client.socket.destroyed) client.socket.destroy();
                }, 500);
            }
        } catch (e: any) {
            this.logger.error(
                `Erro ao validar token MT5 TCP (${client.socket.remoteAddress}): ${formatErrorDetails(e)}`,
                e instanceof Error ? e.stack : undefined,
            );
            client.socket.destroy();
        }
    }

    private extractStringField(buffer: Buffer, fieldNum: number): string | null {
        let offset = 0;
        const len = buffer.length;

        while (offset < len) {
            if (offset + 1 >= len) break;

            const key = buffer[offset++];
            const wireType = key & 7;
            const field = key >> 3;

            if (field === fieldNum) {
                if (wireType === 2) {
                    const strLen = buffer[offset++];
                    if (offset + strLen <= len) {
                        return buffer.subarray(offset, offset + strLen).toString('utf-8');
                    }
                }
                return null;
            }
            return null;
        }
        return null;
    }
}
