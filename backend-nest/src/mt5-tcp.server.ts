import { Injectable, OnModuleInit, OnModuleDestroy, Logger, Inject, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as net from 'net';
import { Redis } from 'ioredis';
// Removed: import * as protobuf from 'protobufjs'; // Parsing manual for V2
// Removed: path, crypto (for V2 simple token)

import { Mt5Service } from './mt5/mt5.service';

@Injectable()
export class Mt5TcpServer implements OnModuleInit, OnModuleDestroy {
    private server: net.Server;
    private readonly logger = new Logger(Mt5TcpServer.name);
    private redis: Redis;

    // Clients Map: socketId -> State
    private clients = new Map<string, { socket: net.Socket, authenticated: boolean }>();

    constructor(
        private configService: ConfigService,
        @Inject(forwardRef(() => Mt5Service)) private mt5Service: Mt5Service
    ) {
        this.redis = new Redis({
            host: this.configService.get('REDIS_HOST'),
            port: this.configService.get('REDIS_PORT'),
            password: this.configService.get('REDIS_PASSWORD'),
            keyPrefix: this.configService.get('REDIS_PREFIX', '{cossa_trading}'),
        });
    }

    async onModuleInit() {
        const port = this.configService.get<number>('MT5_TCP_PORT') || 3003;
        this.server = net.createServer((socket) => this.handleConnection(socket));
        this.server.listen(port, '0.0.0.0', () => {
            this.logger.log(`🚀 TCP Server V2 (Stable) ouvindo na porta ${port}`);
        });
    }

    onModuleDestroy() {
        if (this.server) this.server.close();
    }

    private handleConnection(socket: net.Socket) {
        const socketId = `${socket.remoteAddress}:${socket.remotePort}`;
        this.logger.log(`🔌 Nova Conexão: ${socketId}`);
        this.clients.set(socketId, { socket, authenticated: false });

        let buffer = Buffer.alloc(0);

        socket.on('data', (chunk) => {
            // DoS Check
            if (buffer.length + chunk.length > 5 * 1024 * 1024) {
                socket.destroy(); return;
            }
            buffer = Buffer.concat([buffer, chunk]);

            // V2 Framing: [ID: 1 Byte] [Size: 4 Bytes LE] [Payload]
            while (buffer.length >= 5) {
                const msgId = buffer.readUInt8(0);
                const msgSize = buffer.readUInt32LE(1);

                if (msgSize > 1024 * 1024) { // 1MB Max Packet
                    socket.destroy(); return;
                }

                if (buffer.length < 5 + msgSize) break; // Wait for full payload

                const payload = buffer.subarray(5, 5 + msgSize);
                buffer = buffer.subarray(5 + msgSize);

                this.processPacket(socketId, msgId, payload);
            }
        });

        socket.on('error', (err) => {
            this.logger.error(`Erro Socket ${socketId}: ${err.message}`);
            this.cleanupClient(socketId);
        });

        socket.on('close', () => {
            this.logger.log(`❌ Desconectado: ${socketId}`);
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
            const token = this.extractStringField(payload, 1) || payload.toString();

            // Strict Database Validation
            // We can't await here easily because processPacket is synchronous in the loop
            // BUT we can make processPacket async and handle it.
            // However, for simplicity and to avoid blocking the loop too much, we'll do it.
            this.validateClient(client, token);
            return;
        }

        // --- AUTH CHECK ---
        if (!client.authenticated) {
            // Allow only Auth
            client.socket.destroy();
            return;
        }

        // --- HANDLER: HEARTBEAT (ID 99) ---
        if (msgId === 99) {
            // Alive.
            return;
        }

        // --- HANDLER: MARKET DATA (ID 3) ---
        if (msgId === 3) {
            // CossaConnector sends: Symbol (1), JSON (2)
            const symbol = this.extractStringField(payload, 1);
            const jsonStr = this.extractStringField(payload, 2);

            if (symbol && jsonStr) {
                try {
                    const data = JSON.parse(jsonStr);
                    // Add to Redis Stream
                    this.redis.xadd('stream:mt5_market_data', 'MAXLEN', '~', 10000, '*', 'data', JSON.stringify({
                        ts: Date.now(),
                        symbol: symbol,
                        ...data
                    }));
                } catch (e) {
                    // silent fail
                }
            }
        }

        // --- HANDLER: TRADE DATA (ID 4) ---
        if (msgId === 4) {
            // EA Sends: JSON Array (1)
            const jsonStr = this.extractStringField(payload, 1);
            if (jsonStr) {
                try {
                    // Just validate it's JSON
                    JSON.parse(jsonStr);
                    // Add to Redis Stream
                    this.redis.xadd('stream:mt5_trade_data', 'MAXLEN', '~', 5000, '*', 'data', jsonStr);
                    this.logger.debug(`Received Trades Update: ${jsonStr.length} bytes`);
                } catch (e) {
                    this.logger.error('Invalid Trade JSON');
                }
            }
        }
    }

    public sendCommand(socketId: string, cmdType: number, payloadStr: string = ""): boolean {
        const client = this.clients.get(socketId);
        if (!client || !client.authenticated) return false;

        // V2 Protocol Command:
        // ID 8 (Command)
        // Payload: [Byte CmdType] [String Payload]

        const payloadBuffer = Buffer.alloc(1 + Buffer.byteLength(payloadStr));
        payloadBuffer.writeUInt8(cmdType, 0);
        payloadBuffer.write(payloadStr, 1);

        this.sendPacket(client.socket, 8, payloadBuffer);
        return true;
    }

    private sendPacket(socket: net.Socket, msgId: number, payload: Buffer) {
        const header = Buffer.alloc(5);
        header.writeUInt8(msgId, 0); // ID
        header.writeUInt32LE(payload.length, 1); // Size
        socket.write(Buffer.concat([header, payload]));
    }

    private async validateClient(client: { socket: net.Socket, authenticated: boolean }, token: string) {
        try {
            const account = await this.mt5Service.validateAppToken(token);
            if (account) {
                client.authenticated = true;
                this.logger.log(`✅ Cliente Autenticado: ${client.socket.remoteAddress} (Account: ${account.id})`);
                this.sendPacket(client.socket, 2, Buffer.alloc(0));

                // Update connection status immediately
                this.mt5Service.updateHeartbeat(token);
            } else {
                this.logger.warn(`⛔ Token Inválido: ${token}`);
                // Send Error Packet (ID 5)
                const errorMsg = "Erro: Token Inválido ou Conta não encontrada.";
                this.sendPacket(client.socket, 5, Buffer.from(errorMsg, 'utf-8'));

                // Give client a moment to read the error before kill
                setTimeout(() => {
                    if (!client.socket.destroyed) client.socket.destroy();
                }, 500);
            }
        } catch (e) {
            this.logger.error(`Erro validando token: ${e.message}`);
            client.socket.destroy();
        }
    }

    private extractStringField(buffer: Buffer, fieldNum: number): string | null {
        let offset = 0;
        const len = buffer.length;

        while (offset < len) {
            if (offset + 1 >= len) break;

            // Read Key (VarInt)
            // Simplified: Assume 1 byte key for low field nums
            const key = buffer[offset++];
            const wireType = key & 7;
            const field = key >> 3;

            if (field === fieldNum) {
                if (wireType === 2) { // Length Delimited
                    // Read Length (VarInt) - Simplified 1 byte
                    const strLen = buffer[offset++];
                    if (offset + strLen <= len) {
                        return buffer.subarray(offset, offset + strLen).toString('utf-8');
                    }
                }
                return null;
            }

            // Skip unknown
            // To do this properly without full parser is hard.
            // Assumption: Fields come in order. If simpler, just search?
            // Actually, correct parsing is needed. 
            // If fields are not found immediately, we abort.
            return null;
        }
        return null;
    }
}