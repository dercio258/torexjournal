import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import makeWASocket, { 
    useMultiFileAuthState, 
    DisconnectReason, 
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore,
    WAConnectionState
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import * as path from 'path';
import * as fs from 'fs';
import pino from 'pino';
import { EventEmitter2 } from '@nestjs/event-emitter';

@Injectable()
export class BaileysService implements OnModuleInit {
    private readonly logger = new Logger(BaileysService.name);
    public sock: any;
    private state: WAConnectionState = 'close';
    public qrCode: string | null = null;

    constructor(private eventEmitter: EventEmitter2) {}

    async onModuleInit() {
        // Do not await so it doesn't block app startup if connection or version fetch hangs
        this.connectToWhatsApp().catch(err => {
            this.logger.error(`Initial WhatsApp connection failed: ${err.message}`);
        });
    }

    async connectToWhatsApp() {
        const { state, saveCreds } = await useMultiFileAuthState(
            path.join(process.cwd(), 'wa_auth')
        );

        const { version, isLatest } = await fetchLatestBaileysVersion();
        this.logger.log(`using WA v${version.join('.')}, isLatest: ${isLatest}`);

        // Explicitly close existing socket before reconnecting
        if (this.sock) {
            try {
                this.sock.ev.removeAllListeners('connection.update');
                this.sock.ev.removeAllListeners('creds.update');
                this.sock.ev.removeAllListeners('messages.upsert');
                this.sock.ws.close();
            } catch (e) {}
        }

        this.sock = makeWASocket({
            version,
            printQRInTerminal: false, // QR handled via API
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' })),
            },
            logger: pino({ level: 'silent' }),
            browser: ['Torex.J', 'Chrome', '1.0.0'],
        });

        this.sock.ev.on('connection.update', (update: any) => {
            const { connection, lastDisconnect, qr } = update;
            
            if (qr) {
                this.qrCode = qr;
                this.logger.warn('WhatsApp QR Code generated. Scan it to connect.');
                this.eventEmitter.emit('whatsapp.qr', qr);
            }

            if (connection) {
                this.state = connection;
                if (connection === 'open') {
                    this.qrCode = null; // Clear QR on connection
                    this.logger.log('WhatsApp connection opened successfully');
                    this.eventEmitter.emit('whatsapp.connected');
                } else if (connection === 'close') {
                    const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
                    const errorMessage = (lastDisconnect?.error as Error)?.message || 'Unknown error';
                    const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
                    
                    this.logger.error(`WhatsApp connection closed [Code: ${statusCode}]: ${errorMessage}. Reconnecting: ${shouldReconnect}`);
                    
                    if (shouldReconnect) {
                        setTimeout(() => this.connectToWhatsApp(), 3000); // 3s delay before reconnect
                    } else {
                        this.qrCode = null;
                        this.state = 'close';
                    }
                }
            }
        });

        this.sock.ev.on('creds.update', saveCreds);

        this.sock.ev.on('messages.upsert', (m: any) => {
            this.eventEmitter.emit('whatsapp.messages.upsert', m);
        });
    }

    async sendMessage(number: string, text: string) {
        if (this.state !== 'open' || !this.sock) {
            this.logger.error(`WhatsApp not connected (State: ${this.state}). Cannot send message.`);
            return false;
        }

        // Handle various JID formats, including LIDs and cleanup
        let jid = number;
        if (!jid.includes('@')) {
            jid = `${number}@s.whatsapp.net`;
        }
        
        // Ensure lid JIDs are handled if they come in malformed
        if (jid.includes('@lid@s.whatsapp.net')) {
            jid = jid.replace('@lid@s.whatsapp.net', '@s.whatsapp.net');
        }
        
        this.logger.log(`Sending WhatsApp message to JID: ${jid}`);
        try {
            await this.sock.sendMessage(jid, { text });
            return true;
        } catch (error) {
            this.logger.error(`Failed to send message to ${jid}: ${error.message}`);
            return false;
        }
    }

    getConnectionStatus() {
        return this.state;
    }

    async logout() {
        try {
            if (this.sock) {
                await this.sock.logout().catch(() => {});
            }
            const authPath = path.join(process.cwd(), 'wa_auth');
            if (fs.existsSync(authPath)) {
                fs.rmSync(authPath, { recursive: true, force: true });
            }
            this.state = 'close';
            this.qrCode = null;
            this.sock = null;
            
            // Re-initialize to show fresh QR
            setTimeout(() => this.connectToWhatsApp(), 2000);
            
            return true;
        } catch (error) {
            this.logger.error(`Logout failed: ${error.message}`);
            return false;
        }
    }
}
