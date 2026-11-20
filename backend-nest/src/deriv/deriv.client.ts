import { Logger } from '@nestjs/common';
import * as WebSocket from 'ws';
import { Observable, Subject } from 'rxjs';
import { filter, map } from 'rxjs/operators';

export class DerivClient {
    private readonly logger = new Logger(DerivClient.name);
    private ws: WebSocket | null = null;
    private readonly appId: string;
    private readonly standardUrl: string;
    private url: string;
    private messageSubject = new Subject<any>();
    private connectionSubject = new Subject<boolean>();
    private isConnected = false;
    private isAuthorized = false;
    private isManuallyClosed = false;
    private reconnectInterval = 2000;
    private maxReconnectAttempts = 50;
    private reconnectAttempts = 0;
    private pingIntervalHandle: ReturnType<typeof setInterval> | null = null;
    private reconnectTimeoutHandle: ReturnType<typeof setTimeout> | null = null;
    private lastActivityAt = 0;
    private reconnectUrlResolver?: () => Promise<string | null>;

    setReconnectUrlResolver(resolver?: () => Promise<string | null>) {
        this.reconnectUrlResolver = resolver;
    }

    constructor(appId?: string) {
        this.appId = appId || process.env.DERIV_APP_ID || '1089';
        this.standardUrl = `wss://ws.binaryws.com/websockets/v3?app_id=${this.appId}`;
        this.url = this.standardUrl;
    }

    connect(targetUrl?: string): Promise<void> {
        this.isManuallyClosed = false;
        if (this.reconnectTimeoutHandle) {
            clearTimeout(this.reconnectTimeoutHandle);
            this.reconnectTimeoutHandle = null;
        }

        if (targetUrl) {
            this.url = targetUrl;
        } else if (!this.url) {
            this.url = this.standardUrl;
        }

        if (this.ws) {
            try {
                this.ws.removeAllListeners();
                this.ws.terminate();
            } catch {
                // ignore cleanup errors
            }
            this.ws = null;
        }

        return new Promise((resolve, reject) => {
            let settled = false;
            const socket = new WebSocket(this.url);
            this.ws = socket;

            socket.on('open', () => {
                const isOtp = this.url.includes('otp=');
                this.logger.log(`Connected to Deriv WebSocket (${isOtp ? 'OTP-authenticated gateway' : 'Standard gateway'})`);
                this.isConnected = true;
                this.lastActivityAt = Date.now();
                if (isOtp) {
                    this.isAuthorized = true;
                }
                this.reconnectAttempts = 0;
                this.connectionSubject.next(true);
                this.startPing();
                if (!settled) {
                    settled = true;
                    resolve();
                }
            });

            socket.on('message', (data: string) => {
                this.lastActivityAt = Date.now();
                try {
                    const message = JSON.parse(data);
                    this.messageSubject.next(message);
                } catch (e) {
                    this.logger.error('Failed to parse message from Deriv', e.stack);
                }
            });

            socket.on('close', () => {
                this.logger.warn('Disconnected from Deriv WebSocket');
                const wasConnected = this.isConnected;
                this.isConnected = false;
                this.isAuthorized = false;
                this.stopPing();
                if (wasConnected) {
                    this.connectionSubject.next(false);
                }
                if (!settled) {
                    settled = true;
                    reject(new Error('Deriv WebSocket closed before open'));
                }
                this.handleReconnect();
            });

            socket.on('error', (err) => {
                this.logger.error('Deriv WebSocket error', err.stack);
                if (!this.isConnected && !settled) {
                    settled = true;
                    reject(err);
                }
            });
        });
    }

    private startPing() {
        this.stopPing();
        this.pingIntervalHandle = setInterval(() => {
            if (!this.isConnected || !this.ws) return;
            // Half-open zombie socket watchdog (75s without traffic)
            if (this.lastActivityAt > 0 && Date.now() - this.lastActivityAt > 75_000) {
                this.logger.warn('Deriv WebSocket inactive for >75s; forcing reconnect.');
                try {
                    this.ws.terminate();
                } catch {
                    // ignore
                }
                return;
            }
            this.send({ ping: 1 });
        }, 30000);
    }

    private stopPing() {
        if (this.pingIntervalHandle) {
            clearInterval(this.pingIntervalHandle);
            this.pingIntervalHandle = null;
        }
    }

    private handleReconnect() {
        if (this.isManuallyClosed || this.reconnectTimeoutHandle) return;

        // URL OTP é de uso único e expira; em reconexões sempre volta para o gateway padrão
        if (this.url.includes('otp=')) {
            this.url = this.standardUrl;
        }

        if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            const expDelay = Math.round(
                this.reconnectInterval * Math.pow(1.6, Math.min(this.reconnectAttempts - 1, 8)),
            );
            const jitter = Math.floor(Math.random() * 600);
            const delayMs = Math.min(30_000, expDelay) + jitter;

            this.logger.log(`Attempting to reconnect (${this.reconnectAttempts}/${this.maxReconnectAttempts}) in ${(delayMs / 1000).toFixed(1)}s...`);
            this.reconnectTimeoutHandle = setTimeout(() => {
                this.reconnectTimeoutHandle = null;
                if (!this.isConnected && !this.isManuallyClosed) {
                    void (async () => {
                        let freshUrl: string | null = null;
                        if (this.reconnectUrlResolver) {
                            try {
                                freshUrl = await this.reconnectUrlResolver();
                            } catch {
                                freshUrl = null;
                            }
                        }
                        await this.connect(freshUrl || undefined).catch(() => {});
                    })();
                }
            }, delayMs);
        } else {
            this.logger.error('Max reconnection attempts reached for Deriv WebSocket. Manual intervention may be required.');
        }
    }

    send(data: any): void {
        if (this.isConnected) {
            this.ws.send(JSON.stringify(data));
        } else {
            this.logger.error('Cannot send message: Deriv WebSocket is not connected');
        }
    }

    onMessage<T>(msgType?: string): Observable<T> {
        return this.messageSubject.asObservable().pipe(
            filter(msg => !msgType || msg.msg_type === msgType),
            map(msg => msg as T)
        );
    }

    onConnectionChange(): Observable<boolean> {
        return this.connectionSubject.asObservable();
    }

    setAuthorized(val: boolean) {
        this.isAuthorized = val;
    }

    getIsAuthorized(): boolean {
        return this.isAuthorized;
    }

    request<T>(data: any, msgType: string, timeoutMs: number = 30000): Promise<T> {
        const requestId = Math.floor(Math.random() * 1000000);
        const requestData = { ...data, req_id: requestId };

        return new Promise((resolve, reject) => {
            if (!this.isConnected) {
                return reject(new Error(`Cannot send ${msgType}: Deriv WebSocket is not connected`));
            }

            if (msgType !== 'authorize' && !this.isAuthorized) {
                return reject(new Error(`Cannot send ${msgType}: Client not authorized`));
            }

            const subscription = this.onMessage<any>(msgType).pipe(
                filter(msg => msg.req_id === requestId)
            ).subscribe({
                next: (response) => {
                    clearTimeout(timeoutHandle);
                    connSub.unsubscribe();
                    subscription.unsubscribe();
                    if (response.error) {
                        reject(new Error(response.error.message || `Deriv API Error: ${msgType}`));
                    } else {
                        resolve(response);
                    }
                },
                error: (err) => {
                    clearTimeout(timeoutHandle);
                    connSub.unsubscribe();
                    subscription.unsubscribe();
                    reject(err);
                }
            });

            // Handle socket closure while request is pending
            const connSub = this.onConnectionChange().pipe(
                filter(connected => !connected)
            ).subscribe(() => {
                clearTimeout(timeoutHandle);
                subscription.unsubscribe();
                connSub.unsubscribe();
                reject(new Error(`Deriv connection lost while waiting for ${msgType}`));
            });

            this.send(requestData);

            const timeoutHandle = setTimeout(() => {
                subscription.unsubscribe();
                connSub.unsubscribe();
                reject(new Error(`Deriv request timeout: ${msgType} (${timeoutMs}ms)`));
            }, timeoutMs);
        });
    }

    disconnect() {
        this.isManuallyClosed = true;
        this.stopPing();
        if (this.reconnectTimeoutHandle) {
            clearTimeout(this.reconnectTimeoutHandle);
            this.reconnectTimeoutHandle = null;
        }
        if (this.ws) {
            this.ws.removeAllListeners();
            try {
                this.ws.close();
            } catch {
                // ignore
            }
            this.ws = null;
            this.isConnected = false;
            this.isAuthorized = false;
        }
    }
}
