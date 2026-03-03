import * as $protobuf from "protobufjs";
import Long = require("long");
/** Namespace browser. */
export namespace browser {

    /** PacketType enum. */
    enum PacketType {
        PING = 0,
        AUTH = 1,
        ACCOUNT_UPDATE = 2,
        HISTORY_UPDATE = 3,
        CONNECTION_STATUS = 4,
        PONG = 5
    }

    /** Properties of a BrowserPacket. */
    interface IBrowserPacket {

        /** BrowserPacket type */
        type?: (browser.PacketType|null);

        /** BrowserPacket auth */
        auth?: (browser.IAuth|null);

        /** BrowserPacket accountUpdate */
        accountUpdate?: (browser.IAccountUpdate|null);

        /** BrowserPacket historyUpdate */
        historyUpdate?: (browser.IHistoryUpdate|null);

        /** BrowserPacket connectionStatus */
        connectionStatus?: (browser.IConnectionStatus|null);
    }

    /** Represents a BrowserPacket. */
    class BrowserPacket implements IBrowserPacket {

        /**
         * Constructs a new BrowserPacket.
         * @param [properties] Properties to set
         */
        constructor(properties?: browser.IBrowserPacket);

        /** BrowserPacket type. */
        public type: browser.PacketType;

        /** BrowserPacket auth. */
        public auth?: (browser.IAuth|null);

        /** BrowserPacket accountUpdate. */
        public accountUpdate?: (browser.IAccountUpdate|null);

        /** BrowserPacket historyUpdate. */
        public historyUpdate?: (browser.IHistoryUpdate|null);

        /** BrowserPacket connectionStatus. */
        public connectionStatus?: (browser.IConnectionStatus|null);

        /**
         * Creates a new BrowserPacket instance using the specified properties.
         * @param [properties] Properties to set
         * @returns BrowserPacket instance
         */
        public static create(properties?: browser.IBrowserPacket): browser.BrowserPacket;

        /**
         * Encodes the specified BrowserPacket message. Does not implicitly {@link browser.BrowserPacket.verify|verify} messages.
         * @param message BrowserPacket message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encode(message: browser.IBrowserPacket, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified BrowserPacket message, length delimited. Does not implicitly {@link browser.BrowserPacket.verify|verify} messages.
         * @param message BrowserPacket message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encodeDelimited(message: browser.IBrowserPacket, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes a BrowserPacket message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns BrowserPacket
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): browser.BrowserPacket;

        /**
         * Decodes a BrowserPacket message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns BrowserPacket
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): browser.BrowserPacket;

        /**
         * Verifies a BrowserPacket message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        public static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates a BrowserPacket message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns BrowserPacket
         */
        public static fromObject(object: { [k: string]: any }): browser.BrowserPacket;

        /**
         * Creates a plain object from a BrowserPacket message. Also converts values to other types if specified.
         * @param message BrowserPacket
         * @param [options] Conversion options
         * @returns Plain object
         */
        public static toObject(message: browser.BrowserPacket, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this BrowserPacket to JSON.
         * @returns JSON object
         */
        public toJSON(): { [k: string]: any };

        /**
         * Gets the default type url for BrowserPacket
         * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns The default type url
         */
        public static getTypeUrl(typeUrlPrefix?: string): string;
    }

    /** Properties of an Auth. */
    interface IAuth {

        /** Auth token */
        token?: (string|null);
    }

    /** Represents an Auth. */
    class Auth implements IAuth {

        /**
         * Constructs a new Auth.
         * @param [properties] Properties to set
         */
        constructor(properties?: browser.IAuth);

        /** Auth token. */
        public token: string;

        /**
         * Creates a new Auth instance using the specified properties.
         * @param [properties] Properties to set
         * @returns Auth instance
         */
        public static create(properties?: browser.IAuth): browser.Auth;

        /**
         * Encodes the specified Auth message. Does not implicitly {@link browser.Auth.verify|verify} messages.
         * @param message Auth message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encode(message: browser.IAuth, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified Auth message, length delimited. Does not implicitly {@link browser.Auth.verify|verify} messages.
         * @param message Auth message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encodeDelimited(message: browser.IAuth, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes an Auth message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns Auth
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): browser.Auth;

        /**
         * Decodes an Auth message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns Auth
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): browser.Auth;

        /**
         * Verifies an Auth message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        public static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates an Auth message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns Auth
         */
        public static fromObject(object: { [k: string]: any }): browser.Auth;

        /**
         * Creates a plain object from an Auth message. Also converts values to other types if specified.
         * @param message Auth
         * @param [options] Conversion options
         * @returns Plain object
         */
        public static toObject(message: browser.Auth, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this Auth to JSON.
         * @returns JSON object
         */
        public toJSON(): { [k: string]: any };

        /**
         * Gets the default type url for Auth
         * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns The default type url
         */
        public static getTypeUrl(typeUrlPrefix?: string): string;
    }

    /** Properties of an AccountUpdate. */
    interface IAccountUpdate {

        /** AccountUpdate balance */
        balance?: (number|null);

        /** AccountUpdate equity */
        equity?: (number|null);

        /** AccountUpdate margin */
        margin?: (number|null);

        /** AccountUpdate marginFree */
        marginFree?: (number|null);

        /** AccountUpdate marginLevel */
        marginLevel?: (number|null);

        /** AccountUpdate positions */
        positions?: (browser.IPosition[]|null);
    }

    /** Represents an AccountUpdate. */
    class AccountUpdate implements IAccountUpdate {

        /**
         * Constructs a new AccountUpdate.
         * @param [properties] Properties to set
         */
        constructor(properties?: browser.IAccountUpdate);

        /** AccountUpdate balance. */
        public balance: number;

        /** AccountUpdate equity. */
        public equity: number;

        /** AccountUpdate margin. */
        public margin: number;

        /** AccountUpdate marginFree. */
        public marginFree: number;

        /** AccountUpdate marginLevel. */
        public marginLevel: number;

        /** AccountUpdate positions. */
        public positions: browser.IPosition[];

        /**
         * Creates a new AccountUpdate instance using the specified properties.
         * @param [properties] Properties to set
         * @returns AccountUpdate instance
         */
        public static create(properties?: browser.IAccountUpdate): browser.AccountUpdate;

        /**
         * Encodes the specified AccountUpdate message. Does not implicitly {@link browser.AccountUpdate.verify|verify} messages.
         * @param message AccountUpdate message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encode(message: browser.IAccountUpdate, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified AccountUpdate message, length delimited. Does not implicitly {@link browser.AccountUpdate.verify|verify} messages.
         * @param message AccountUpdate message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encodeDelimited(message: browser.IAccountUpdate, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes an AccountUpdate message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns AccountUpdate
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): browser.AccountUpdate;

        /**
         * Decodes an AccountUpdate message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns AccountUpdate
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): browser.AccountUpdate;

        /**
         * Verifies an AccountUpdate message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        public static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates an AccountUpdate message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns AccountUpdate
         */
        public static fromObject(object: { [k: string]: any }): browser.AccountUpdate;

        /**
         * Creates a plain object from an AccountUpdate message. Also converts values to other types if specified.
         * @param message AccountUpdate
         * @param [options] Conversion options
         * @returns Plain object
         */
        public static toObject(message: browser.AccountUpdate, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this AccountUpdate to JSON.
         * @returns JSON object
         */
        public toJSON(): { [k: string]: any };

        /**
         * Gets the default type url for AccountUpdate
         * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns The default type url
         */
        public static getTypeUrl(typeUrlPrefix?: string): string;
    }

    /** Properties of a Position. */
    interface IPosition {

        /** Position ticket */
        ticket?: (number|Long|null);

        /** Position symbol */
        symbol?: (string|null);

        /** Position type */
        type?: (string|null);

        /** Position volume */
        volume?: (number|null);

        /** Position openPrice */
        openPrice?: (number|null);

        /** Position currentPrice */
        currentPrice?: (number|null);

        /** Position profit */
        profit?: (number|null);

        /** Position sl */
        sl?: (number|null);

        /** Position tp */
        tp?: (number|null);

        /** Position openTime */
        openTime?: (number|Long|null);
    }

    /** Represents a Position. */
    class Position implements IPosition {

        /**
         * Constructs a new Position.
         * @param [properties] Properties to set
         */
        constructor(properties?: browser.IPosition);

        /** Position ticket. */
        public ticket: (number|Long);

        /** Position symbol. */
        public symbol: string;

        /** Position type. */
        public type: string;

        /** Position volume. */
        public volume: number;

        /** Position openPrice. */
        public openPrice: number;

        /** Position currentPrice. */
        public currentPrice: number;

        /** Position profit. */
        public profit: number;

        /** Position sl. */
        public sl: number;

        /** Position tp. */
        public tp: number;

        /** Position openTime. */
        public openTime: (number|Long);

        /**
         * Creates a new Position instance using the specified properties.
         * @param [properties] Properties to set
         * @returns Position instance
         */
        public static create(properties?: browser.IPosition): browser.Position;

        /**
         * Encodes the specified Position message. Does not implicitly {@link browser.Position.verify|verify} messages.
         * @param message Position message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encode(message: browser.IPosition, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified Position message, length delimited. Does not implicitly {@link browser.Position.verify|verify} messages.
         * @param message Position message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encodeDelimited(message: browser.IPosition, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes a Position message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns Position
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): browser.Position;

        /**
         * Decodes a Position message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns Position
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): browser.Position;

        /**
         * Verifies a Position message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        public static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates a Position message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns Position
         */
        public static fromObject(object: { [k: string]: any }): browser.Position;

        /**
         * Creates a plain object from a Position message. Also converts values to other types if specified.
         * @param message Position
         * @param [options] Conversion options
         * @returns Plain object
         */
        public static toObject(message: browser.Position, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this Position to JSON.
         * @returns JSON object
         */
        public toJSON(): { [k: string]: any };

        /**
         * Gets the default type url for Position
         * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns The default type url
         */
        public static getTypeUrl(typeUrlPrefix?: string): string;
    }

    /** Properties of a HistoryUpdate. */
    interface IHistoryUpdate {

        /** HistoryUpdate count */
        count?: (number|null);

        /** HistoryUpdate trades */
        trades?: (browser.ITrade[]|null);
    }

    /** Represents a HistoryUpdate. */
    class HistoryUpdate implements IHistoryUpdate {

        /**
         * Constructs a new HistoryUpdate.
         * @param [properties] Properties to set
         */
        constructor(properties?: browser.IHistoryUpdate);

        /** HistoryUpdate count. */
        public count: number;

        /** HistoryUpdate trades. */
        public trades: browser.ITrade[];

        /**
         * Creates a new HistoryUpdate instance using the specified properties.
         * @param [properties] Properties to set
         * @returns HistoryUpdate instance
         */
        public static create(properties?: browser.IHistoryUpdate): browser.HistoryUpdate;

        /**
         * Encodes the specified HistoryUpdate message. Does not implicitly {@link browser.HistoryUpdate.verify|verify} messages.
         * @param message HistoryUpdate message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encode(message: browser.IHistoryUpdate, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified HistoryUpdate message, length delimited. Does not implicitly {@link browser.HistoryUpdate.verify|verify} messages.
         * @param message HistoryUpdate message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encodeDelimited(message: browser.IHistoryUpdate, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes a HistoryUpdate message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns HistoryUpdate
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): browser.HistoryUpdate;

        /**
         * Decodes a HistoryUpdate message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns HistoryUpdate
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): browser.HistoryUpdate;

        /**
         * Verifies a HistoryUpdate message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        public static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates a HistoryUpdate message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns HistoryUpdate
         */
        public static fromObject(object: { [k: string]: any }): browser.HistoryUpdate;

        /**
         * Creates a plain object from a HistoryUpdate message. Also converts values to other types if specified.
         * @param message HistoryUpdate
         * @param [options] Conversion options
         * @returns Plain object
         */
        public static toObject(message: browser.HistoryUpdate, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this HistoryUpdate to JSON.
         * @returns JSON object
         */
        public toJSON(): { [k: string]: any };

        /**
         * Gets the default type url for HistoryUpdate
         * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns The default type url
         */
        public static getTypeUrl(typeUrlPrefix?: string): string;
    }

    /** Properties of a Trade. */
    interface ITrade {

        /** Trade ticket */
        ticket?: (number|Long|null);

        /** Trade symbol */
        symbol?: (string|null);

        /** Trade type */
        type?: (string|null);

        /** Trade volume */
        volume?: (number|null);

        /** Trade openPrice */
        openPrice?: (number|null);

        /** Trade closePrice */
        closePrice?: (number|null);

        /** Trade openTime */
        openTime?: (number|Long|null);

        /** Trade closeTime */
        closeTime?: (number|Long|null);

        /** Trade profit */
        profit?: (number|null);

        /** Trade commission */
        commission?: (number|null);

        /** Trade swap */
        swap?: (number|null);

        /** Trade comment */
        comment?: (string|null);
    }

    /** Represents a Trade. */
    class Trade implements ITrade {

        /**
         * Constructs a new Trade.
         * @param [properties] Properties to set
         */
        constructor(properties?: browser.ITrade);

        /** Trade ticket. */
        public ticket: (number|Long);

        /** Trade symbol. */
        public symbol: string;

        /** Trade type. */
        public type: string;

        /** Trade volume. */
        public volume: number;

        /** Trade openPrice. */
        public openPrice: number;

        /** Trade closePrice. */
        public closePrice: number;

        /** Trade openTime. */
        public openTime: (number|Long);

        /** Trade closeTime. */
        public closeTime: (number|Long);

        /** Trade profit. */
        public profit: number;

        /** Trade commission. */
        public commission: number;

        /** Trade swap. */
        public swap: number;

        /** Trade comment. */
        public comment: string;

        /**
         * Creates a new Trade instance using the specified properties.
         * @param [properties] Properties to set
         * @returns Trade instance
         */
        public static create(properties?: browser.ITrade): browser.Trade;

        /**
         * Encodes the specified Trade message. Does not implicitly {@link browser.Trade.verify|verify} messages.
         * @param message Trade message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encode(message: browser.ITrade, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified Trade message, length delimited. Does not implicitly {@link browser.Trade.verify|verify} messages.
         * @param message Trade message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encodeDelimited(message: browser.ITrade, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes a Trade message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns Trade
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): browser.Trade;

        /**
         * Decodes a Trade message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns Trade
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): browser.Trade;

        /**
         * Verifies a Trade message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        public static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates a Trade message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns Trade
         */
        public static fromObject(object: { [k: string]: any }): browser.Trade;

        /**
         * Creates a plain object from a Trade message. Also converts values to other types if specified.
         * @param message Trade
         * @param [options] Conversion options
         * @returns Plain object
         */
        public static toObject(message: browser.Trade, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this Trade to JSON.
         * @returns JSON object
         */
        public toJSON(): { [k: string]: any };

        /**
         * Gets the default type url for Trade
         * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns The default type url
         */
        public static getTypeUrl(typeUrlPrefix?: string): string;
    }

    /** Properties of a ConnectionStatus. */
    interface IConnectionStatus {

        /** ConnectionStatus isConnected */
        isConnected?: (boolean|null);
    }

    /** Represents a ConnectionStatus. */
    class ConnectionStatus implements IConnectionStatus {

        /**
         * Constructs a new ConnectionStatus.
         * @param [properties] Properties to set
         */
        constructor(properties?: browser.IConnectionStatus);

        /** ConnectionStatus isConnected. */
        public isConnected: boolean;

        /**
         * Creates a new ConnectionStatus instance using the specified properties.
         * @param [properties] Properties to set
         * @returns ConnectionStatus instance
         */
        public static create(properties?: browser.IConnectionStatus): browser.ConnectionStatus;

        /**
         * Encodes the specified ConnectionStatus message. Does not implicitly {@link browser.ConnectionStatus.verify|verify} messages.
         * @param message ConnectionStatus message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encode(message: browser.IConnectionStatus, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified ConnectionStatus message, length delimited. Does not implicitly {@link browser.ConnectionStatus.verify|verify} messages.
         * @param message ConnectionStatus message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encodeDelimited(message: browser.IConnectionStatus, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes a ConnectionStatus message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns ConnectionStatus
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): browser.ConnectionStatus;

        /**
         * Decodes a ConnectionStatus message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns ConnectionStatus
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): browser.ConnectionStatus;

        /**
         * Verifies a ConnectionStatus message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        public static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates a ConnectionStatus message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns ConnectionStatus
         */
        public static fromObject(object: { [k: string]: any }): browser.ConnectionStatus;

        /**
         * Creates a plain object from a ConnectionStatus message. Also converts values to other types if specified.
         * @param message ConnectionStatus
         * @param [options] Conversion options
         * @returns Plain object
         */
        public static toObject(message: browser.ConnectionStatus, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this ConnectionStatus to JSON.
         * @returns JSON object
         */
        public toJSON(): { [k: string]: any };

        /**
         * Gets the default type url for ConnectionStatus
         * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns The default type url
         */
        public static getTypeUrl(typeUrlPrefix?: string): string;
    }
}
