/*eslint-disable block-scoped-var, id-length, no-control-regex, no-magic-numbers, no-prototype-builtins, no-redeclare, no-shadow, no-var, sort-vars*/
import * as $protobuf from "protobufjs/minimal";

// Common aliases
const $Reader = $protobuf.Reader, $Writer = $protobuf.Writer, $util = $protobuf.util;

// Exported root namespace
const $root = $protobuf.roots["default"] || ($protobuf.roots["default"] = {});

export const browser = $root.browser = (() => {

    /**
     * Namespace browser.
     * @exports browser
     * @namespace
     */
    const browser = {};

    /**
     * PacketType enum.
     * @name browser.PacketType
     * @enum {number}
     * @property {number} PING=0 PING value
     * @property {number} AUTH=1 AUTH value
     * @property {number} ACCOUNT_UPDATE=2 ACCOUNT_UPDATE value
     * @property {number} HISTORY_UPDATE=3 HISTORY_UPDATE value
     * @property {number} CONNECTION_STATUS=4 CONNECTION_STATUS value
     * @property {number} PONG=5 PONG value
     */
    browser.PacketType = (function() {
        const valuesById = {}, values = Object.create(valuesById);
        values[valuesById[0] = "PING"] = 0;
        values[valuesById[1] = "AUTH"] = 1;
        values[valuesById[2] = "ACCOUNT_UPDATE"] = 2;
        values[valuesById[3] = "HISTORY_UPDATE"] = 3;
        values[valuesById[4] = "CONNECTION_STATUS"] = 4;
        values[valuesById[5] = "PONG"] = 5;
        return values;
    })();

    browser.BrowserPacket = (function() {

        /**
         * Properties of a BrowserPacket.
         * @memberof browser
         * @interface IBrowserPacket
         * @property {browser.PacketType|null} [type] BrowserPacket type
         * @property {browser.IAuth|null} [auth] BrowserPacket auth
         * @property {browser.IAccountUpdate|null} [accountUpdate] BrowserPacket accountUpdate
         * @property {browser.IHistoryUpdate|null} [historyUpdate] BrowserPacket historyUpdate
         * @property {browser.IConnectionStatus|null} [connectionStatus] BrowserPacket connectionStatus
         */

        /**
         * Constructs a new BrowserPacket.
         * @memberof browser
         * @classdesc Represents a BrowserPacket.
         * @implements IBrowserPacket
         * @constructor
         * @param {browser.IBrowserPacket=} [properties] Properties to set
         */
        function BrowserPacket(properties) {
            if (properties)
                for (let keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                    if (properties[keys[i]] != null)
                        this[keys[i]] = properties[keys[i]];
        }

        /**
         * BrowserPacket type.
         * @member {browser.PacketType} type
         * @memberof browser.BrowserPacket
         * @instance
         */
        BrowserPacket.prototype.type = 0;

        /**
         * BrowserPacket auth.
         * @member {browser.IAuth|null|undefined} auth
         * @memberof browser.BrowserPacket
         * @instance
         */
        BrowserPacket.prototype.auth = null;

        /**
         * BrowserPacket accountUpdate.
         * @member {browser.IAccountUpdate|null|undefined} accountUpdate
         * @memberof browser.BrowserPacket
         * @instance
         */
        BrowserPacket.prototype.accountUpdate = null;

        /**
         * BrowserPacket historyUpdate.
         * @member {browser.IHistoryUpdate|null|undefined} historyUpdate
         * @memberof browser.BrowserPacket
         * @instance
         */
        BrowserPacket.prototype.historyUpdate = null;

        /**
         * BrowserPacket connectionStatus.
         * @member {browser.IConnectionStatus|null|undefined} connectionStatus
         * @memberof browser.BrowserPacket
         * @instance
         */
        BrowserPacket.prototype.connectionStatus = null;

        /**
         * Creates a new BrowserPacket instance using the specified properties.
         * @function create
         * @memberof browser.BrowserPacket
         * @static
         * @param {browser.IBrowserPacket=} [properties] Properties to set
         * @returns {browser.BrowserPacket} BrowserPacket instance
         */
        BrowserPacket.create = function create(properties) {
            return new BrowserPacket(properties);
        };

        /**
         * Encodes the specified BrowserPacket message. Does not implicitly {@link browser.BrowserPacket.verify|verify} messages.
         * @function encode
         * @memberof browser.BrowserPacket
         * @static
         * @param {browser.IBrowserPacket} message BrowserPacket message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        BrowserPacket.encode = function encode(message, writer) {
            if (!writer)
                writer = $Writer.create();
            if (message.type != null && Object.hasOwnProperty.call(message, "type"))
                writer.uint32(/* id 1, wireType 0 =*/8).int32(message.type);
            if (message.auth != null && Object.hasOwnProperty.call(message, "auth"))
                $root.browser.Auth.encode(message.auth, writer.uint32(/* id 2, wireType 2 =*/18).fork()).ldelim();
            if (message.accountUpdate != null && Object.hasOwnProperty.call(message, "accountUpdate"))
                $root.browser.AccountUpdate.encode(message.accountUpdate, writer.uint32(/* id 3, wireType 2 =*/26).fork()).ldelim();
            if (message.historyUpdate != null && Object.hasOwnProperty.call(message, "historyUpdate"))
                $root.browser.HistoryUpdate.encode(message.historyUpdate, writer.uint32(/* id 4, wireType 2 =*/34).fork()).ldelim();
            if (message.connectionStatus != null && Object.hasOwnProperty.call(message, "connectionStatus"))
                $root.browser.ConnectionStatus.encode(message.connectionStatus, writer.uint32(/* id 5, wireType 2 =*/42).fork()).ldelim();
            return writer;
        };

        /**
         * Encodes the specified BrowserPacket message, length delimited. Does not implicitly {@link browser.BrowserPacket.verify|verify} messages.
         * @function encodeDelimited
         * @memberof browser.BrowserPacket
         * @static
         * @param {browser.IBrowserPacket} message BrowserPacket message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        BrowserPacket.encodeDelimited = function encodeDelimited(message, writer) {
            return this.encode(message, writer).ldelim();
        };

        /**
         * Decodes a BrowserPacket message from the specified reader or buffer.
         * @function decode
         * @memberof browser.BrowserPacket
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @param {number} [length] Message length if known beforehand
         * @returns {browser.BrowserPacket} BrowserPacket
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        BrowserPacket.decode = function decode(reader, length, error) {
            if (!(reader instanceof $Reader))
                reader = $Reader.create(reader);
            let end = length === undefined ? reader.len : reader.pos + length, message = new $root.browser.BrowserPacket();
            while (reader.pos < end) {
                let tag = reader.uint32();
                if (tag === error)
                    break;
                switch (tag >>> 3) {
                case 1: {
                        message.type = reader.int32();
                        break;
                    }
                case 2: {
                        message.auth = $root.browser.Auth.decode(reader, reader.uint32());
                        break;
                    }
                case 3: {
                        message.accountUpdate = $root.browser.AccountUpdate.decode(reader, reader.uint32());
                        break;
                    }
                case 4: {
                        message.historyUpdate = $root.browser.HistoryUpdate.decode(reader, reader.uint32());
                        break;
                    }
                case 5: {
                        message.connectionStatus = $root.browser.ConnectionStatus.decode(reader, reader.uint32());
                        break;
                    }
                default:
                    reader.skipType(tag & 7);
                    break;
                }
            }
            return message;
        };

        /**
         * Decodes a BrowserPacket message from the specified reader or buffer, length delimited.
         * @function decodeDelimited
         * @memberof browser.BrowserPacket
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @returns {browser.BrowserPacket} BrowserPacket
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        BrowserPacket.decodeDelimited = function decodeDelimited(reader) {
            if (!(reader instanceof $Reader))
                reader = new $Reader(reader);
            return this.decode(reader, reader.uint32());
        };

        /**
         * Verifies a BrowserPacket message.
         * @function verify
         * @memberof browser.BrowserPacket
         * @static
         * @param {Object.<string,*>} message Plain object to verify
         * @returns {string|null} `null` if valid, otherwise the reason why it is not
         */
        BrowserPacket.verify = function verify(message) {
            if (typeof message !== "object" || message === null)
                return "object expected";
            if (message.type != null && message.hasOwnProperty("type"))
                switch (message.type) {
                default:
                    return "type: enum value expected";
                case 0:
                case 1:
                case 2:
                case 3:
                case 4:
                case 5:
                    break;
                }
            if (message.auth != null && message.hasOwnProperty("auth")) {
                let error = $root.browser.Auth.verify(message.auth);
                if (error)
                    return "auth." + error;
            }
            if (message.accountUpdate != null && message.hasOwnProperty("accountUpdate")) {
                let error = $root.browser.AccountUpdate.verify(message.accountUpdate);
                if (error)
                    return "accountUpdate." + error;
            }
            if (message.historyUpdate != null && message.hasOwnProperty("historyUpdate")) {
                let error = $root.browser.HistoryUpdate.verify(message.historyUpdate);
                if (error)
                    return "historyUpdate." + error;
            }
            if (message.connectionStatus != null && message.hasOwnProperty("connectionStatus")) {
                let error = $root.browser.ConnectionStatus.verify(message.connectionStatus);
                if (error)
                    return "connectionStatus." + error;
            }
            return null;
        };

        /**
         * Creates a BrowserPacket message from a plain object. Also converts values to their respective internal types.
         * @function fromObject
         * @memberof browser.BrowserPacket
         * @static
         * @param {Object.<string,*>} object Plain object
         * @returns {browser.BrowserPacket} BrowserPacket
         */
        BrowserPacket.fromObject = function fromObject(object) {
            if (object instanceof $root.browser.BrowserPacket)
                return object;
            let message = new $root.browser.BrowserPacket();
            switch (object.type) {
            default:
                if (typeof object.type === "number") {
                    message.type = object.type;
                    break;
                }
                break;
            case "PING":
            case 0:
                message.type = 0;
                break;
            case "AUTH":
            case 1:
                message.type = 1;
                break;
            case "ACCOUNT_UPDATE":
            case 2:
                message.type = 2;
                break;
            case "HISTORY_UPDATE":
            case 3:
                message.type = 3;
                break;
            case "CONNECTION_STATUS":
            case 4:
                message.type = 4;
                break;
            case "PONG":
            case 5:
                message.type = 5;
                break;
            }
            if (object.auth != null) {
                if (typeof object.auth !== "object")
                    throw TypeError(".browser.BrowserPacket.auth: object expected");
                message.auth = $root.browser.Auth.fromObject(object.auth);
            }
            if (object.accountUpdate != null) {
                if (typeof object.accountUpdate !== "object")
                    throw TypeError(".browser.BrowserPacket.accountUpdate: object expected");
                message.accountUpdate = $root.browser.AccountUpdate.fromObject(object.accountUpdate);
            }
            if (object.historyUpdate != null) {
                if (typeof object.historyUpdate !== "object")
                    throw TypeError(".browser.BrowserPacket.historyUpdate: object expected");
                message.historyUpdate = $root.browser.HistoryUpdate.fromObject(object.historyUpdate);
            }
            if (object.connectionStatus != null) {
                if (typeof object.connectionStatus !== "object")
                    throw TypeError(".browser.BrowserPacket.connectionStatus: object expected");
                message.connectionStatus = $root.browser.ConnectionStatus.fromObject(object.connectionStatus);
            }
            return message;
        };

        /**
         * Creates a plain object from a BrowserPacket message. Also converts values to other types if specified.
         * @function toObject
         * @memberof browser.BrowserPacket
         * @static
         * @param {browser.BrowserPacket} message BrowserPacket
         * @param {$protobuf.IConversionOptions} [options] Conversion options
         * @returns {Object.<string,*>} Plain object
         */
        BrowserPacket.toObject = function toObject(message, options) {
            if (!options)
                options = {};
            let object = {};
            if (options.defaults) {
                object.type = options.enums === String ? "PING" : 0;
                object.auth = null;
                object.accountUpdate = null;
                object.historyUpdate = null;
                object.connectionStatus = null;
            }
            if (message.type != null && message.hasOwnProperty("type"))
                object.type = options.enums === String ? $root.browser.PacketType[message.type] === undefined ? message.type : $root.browser.PacketType[message.type] : message.type;
            if (message.auth != null && message.hasOwnProperty("auth"))
                object.auth = $root.browser.Auth.toObject(message.auth, options);
            if (message.accountUpdate != null && message.hasOwnProperty("accountUpdate"))
                object.accountUpdate = $root.browser.AccountUpdate.toObject(message.accountUpdate, options);
            if (message.historyUpdate != null && message.hasOwnProperty("historyUpdate"))
                object.historyUpdate = $root.browser.HistoryUpdate.toObject(message.historyUpdate, options);
            if (message.connectionStatus != null && message.hasOwnProperty("connectionStatus"))
                object.connectionStatus = $root.browser.ConnectionStatus.toObject(message.connectionStatus, options);
            return object;
        };

        /**
         * Converts this BrowserPacket to JSON.
         * @function toJSON
         * @memberof browser.BrowserPacket
         * @instance
         * @returns {Object.<string,*>} JSON object
         */
        BrowserPacket.prototype.toJSON = function toJSON() {
            return this.constructor.toObject(this, $protobuf.util.toJSONOptions);
        };

        /**
         * Gets the default type url for BrowserPacket
         * @function getTypeUrl
         * @memberof browser.BrowserPacket
         * @static
         * @param {string} [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns {string} The default type url
         */
        BrowserPacket.getTypeUrl = function getTypeUrl(typeUrlPrefix) {
            if (typeUrlPrefix === undefined) {
                typeUrlPrefix = "type.googleapis.com";
            }
            return typeUrlPrefix + "/browser.BrowserPacket";
        };

        return BrowserPacket;
    })();

    browser.Auth = (function() {

        /**
         * Properties of an Auth.
         * @memberof browser
         * @interface IAuth
         * @property {string|null} [token] Auth token
         */

        /**
         * Constructs a new Auth.
         * @memberof browser
         * @classdesc Represents an Auth.
         * @implements IAuth
         * @constructor
         * @param {browser.IAuth=} [properties] Properties to set
         */
        function Auth(properties) {
            if (properties)
                for (let keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                    if (properties[keys[i]] != null)
                        this[keys[i]] = properties[keys[i]];
        }

        /**
         * Auth token.
         * @member {string} token
         * @memberof browser.Auth
         * @instance
         */
        Auth.prototype.token = "";

        /**
         * Creates a new Auth instance using the specified properties.
         * @function create
         * @memberof browser.Auth
         * @static
         * @param {browser.IAuth=} [properties] Properties to set
         * @returns {browser.Auth} Auth instance
         */
        Auth.create = function create(properties) {
            return new Auth(properties);
        };

        /**
         * Encodes the specified Auth message. Does not implicitly {@link browser.Auth.verify|verify} messages.
         * @function encode
         * @memberof browser.Auth
         * @static
         * @param {browser.IAuth} message Auth message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        Auth.encode = function encode(message, writer) {
            if (!writer)
                writer = $Writer.create();
            if (message.token != null && Object.hasOwnProperty.call(message, "token"))
                writer.uint32(/* id 1, wireType 2 =*/10).string(message.token);
            return writer;
        };

        /**
         * Encodes the specified Auth message, length delimited. Does not implicitly {@link browser.Auth.verify|verify} messages.
         * @function encodeDelimited
         * @memberof browser.Auth
         * @static
         * @param {browser.IAuth} message Auth message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        Auth.encodeDelimited = function encodeDelimited(message, writer) {
            return this.encode(message, writer).ldelim();
        };

        /**
         * Decodes an Auth message from the specified reader or buffer.
         * @function decode
         * @memberof browser.Auth
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @param {number} [length] Message length if known beforehand
         * @returns {browser.Auth} Auth
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        Auth.decode = function decode(reader, length, error) {
            if (!(reader instanceof $Reader))
                reader = $Reader.create(reader);
            let end = length === undefined ? reader.len : reader.pos + length, message = new $root.browser.Auth();
            while (reader.pos < end) {
                let tag = reader.uint32();
                if (tag === error)
                    break;
                switch (tag >>> 3) {
                case 1: {
                        message.token = reader.string();
                        break;
                    }
                default:
                    reader.skipType(tag & 7);
                    break;
                }
            }
            return message;
        };

        /**
         * Decodes an Auth message from the specified reader or buffer, length delimited.
         * @function decodeDelimited
         * @memberof browser.Auth
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @returns {browser.Auth} Auth
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        Auth.decodeDelimited = function decodeDelimited(reader) {
            if (!(reader instanceof $Reader))
                reader = new $Reader(reader);
            return this.decode(reader, reader.uint32());
        };

        /**
         * Verifies an Auth message.
         * @function verify
         * @memberof browser.Auth
         * @static
         * @param {Object.<string,*>} message Plain object to verify
         * @returns {string|null} `null` if valid, otherwise the reason why it is not
         */
        Auth.verify = function verify(message) {
            if (typeof message !== "object" || message === null)
                return "object expected";
            if (message.token != null && message.hasOwnProperty("token"))
                if (!$util.isString(message.token))
                    return "token: string expected";
            return null;
        };

        /**
         * Creates an Auth message from a plain object. Also converts values to their respective internal types.
         * @function fromObject
         * @memberof browser.Auth
         * @static
         * @param {Object.<string,*>} object Plain object
         * @returns {browser.Auth} Auth
         */
        Auth.fromObject = function fromObject(object) {
            if (object instanceof $root.browser.Auth)
                return object;
            let message = new $root.browser.Auth();
            if (object.token != null)
                message.token = String(object.token);
            return message;
        };

        /**
         * Creates a plain object from an Auth message. Also converts values to other types if specified.
         * @function toObject
         * @memberof browser.Auth
         * @static
         * @param {browser.Auth} message Auth
         * @param {$protobuf.IConversionOptions} [options] Conversion options
         * @returns {Object.<string,*>} Plain object
         */
        Auth.toObject = function toObject(message, options) {
            if (!options)
                options = {};
            let object = {};
            if (options.defaults)
                object.token = "";
            if (message.token != null && message.hasOwnProperty("token"))
                object.token = message.token;
            return object;
        };

        /**
         * Converts this Auth to JSON.
         * @function toJSON
         * @memberof browser.Auth
         * @instance
         * @returns {Object.<string,*>} JSON object
         */
        Auth.prototype.toJSON = function toJSON() {
            return this.constructor.toObject(this, $protobuf.util.toJSONOptions);
        };

        /**
         * Gets the default type url for Auth
         * @function getTypeUrl
         * @memberof browser.Auth
         * @static
         * @param {string} [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns {string} The default type url
         */
        Auth.getTypeUrl = function getTypeUrl(typeUrlPrefix) {
            if (typeUrlPrefix === undefined) {
                typeUrlPrefix = "type.googleapis.com";
            }
            return typeUrlPrefix + "/browser.Auth";
        };

        return Auth;
    })();

    browser.AccountUpdate = (function() {

        /**
         * Properties of an AccountUpdate.
         * @memberof browser
         * @interface IAccountUpdate
         * @property {number|null} [balance] AccountUpdate balance
         * @property {number|null} [equity] AccountUpdate equity
         * @property {number|null} [margin] AccountUpdate margin
         * @property {number|null} [marginFree] AccountUpdate marginFree
         * @property {number|null} [marginLevel] AccountUpdate marginLevel
         * @property {Array.<browser.IPosition>|null} [positions] AccountUpdate positions
         */

        /**
         * Constructs a new AccountUpdate.
         * @memberof browser
         * @classdesc Represents an AccountUpdate.
         * @implements IAccountUpdate
         * @constructor
         * @param {browser.IAccountUpdate=} [properties] Properties to set
         */
        function AccountUpdate(properties) {
            this.positions = [];
            if (properties)
                for (let keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                    if (properties[keys[i]] != null)
                        this[keys[i]] = properties[keys[i]];
        }

        /**
         * AccountUpdate balance.
         * @member {number} balance
         * @memberof browser.AccountUpdate
         * @instance
         */
        AccountUpdate.prototype.balance = 0;

        /**
         * AccountUpdate equity.
         * @member {number} equity
         * @memberof browser.AccountUpdate
         * @instance
         */
        AccountUpdate.prototype.equity = 0;

        /**
         * AccountUpdate margin.
         * @member {number} margin
         * @memberof browser.AccountUpdate
         * @instance
         */
        AccountUpdate.prototype.margin = 0;

        /**
         * AccountUpdate marginFree.
         * @member {number} marginFree
         * @memberof browser.AccountUpdate
         * @instance
         */
        AccountUpdate.prototype.marginFree = 0;

        /**
         * AccountUpdate marginLevel.
         * @member {number} marginLevel
         * @memberof browser.AccountUpdate
         * @instance
         */
        AccountUpdate.prototype.marginLevel = 0;

        /**
         * AccountUpdate positions.
         * @member {Array.<browser.IPosition>} positions
         * @memberof browser.AccountUpdate
         * @instance
         */
        AccountUpdate.prototype.positions = $util.emptyArray;

        /**
         * Creates a new AccountUpdate instance using the specified properties.
         * @function create
         * @memberof browser.AccountUpdate
         * @static
         * @param {browser.IAccountUpdate=} [properties] Properties to set
         * @returns {browser.AccountUpdate} AccountUpdate instance
         */
        AccountUpdate.create = function create(properties) {
            return new AccountUpdate(properties);
        };

        /**
         * Encodes the specified AccountUpdate message. Does not implicitly {@link browser.AccountUpdate.verify|verify} messages.
         * @function encode
         * @memberof browser.AccountUpdate
         * @static
         * @param {browser.IAccountUpdate} message AccountUpdate message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        AccountUpdate.encode = function encode(message, writer) {
            if (!writer)
                writer = $Writer.create();
            if (message.balance != null && Object.hasOwnProperty.call(message, "balance"))
                writer.uint32(/* id 1, wireType 1 =*/9).double(message.balance);
            if (message.equity != null && Object.hasOwnProperty.call(message, "equity"))
                writer.uint32(/* id 2, wireType 1 =*/17).double(message.equity);
            if (message.margin != null && Object.hasOwnProperty.call(message, "margin"))
                writer.uint32(/* id 3, wireType 1 =*/25).double(message.margin);
            if (message.marginFree != null && Object.hasOwnProperty.call(message, "marginFree"))
                writer.uint32(/* id 4, wireType 1 =*/33).double(message.marginFree);
            if (message.marginLevel != null && Object.hasOwnProperty.call(message, "marginLevel"))
                writer.uint32(/* id 5, wireType 1 =*/41).double(message.marginLevel);
            if (message.positions != null && message.positions.length)
                for (let i = 0; i < message.positions.length; ++i)
                    $root.browser.Position.encode(message.positions[i], writer.uint32(/* id 6, wireType 2 =*/50).fork()).ldelim();
            return writer;
        };

        /**
         * Encodes the specified AccountUpdate message, length delimited. Does not implicitly {@link browser.AccountUpdate.verify|verify} messages.
         * @function encodeDelimited
         * @memberof browser.AccountUpdate
         * @static
         * @param {browser.IAccountUpdate} message AccountUpdate message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        AccountUpdate.encodeDelimited = function encodeDelimited(message, writer) {
            return this.encode(message, writer).ldelim();
        };

        /**
         * Decodes an AccountUpdate message from the specified reader or buffer.
         * @function decode
         * @memberof browser.AccountUpdate
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @param {number} [length] Message length if known beforehand
         * @returns {browser.AccountUpdate} AccountUpdate
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        AccountUpdate.decode = function decode(reader, length, error) {
            if (!(reader instanceof $Reader))
                reader = $Reader.create(reader);
            let end = length === undefined ? reader.len : reader.pos + length, message = new $root.browser.AccountUpdate();
            while (reader.pos < end) {
                let tag = reader.uint32();
                if (tag === error)
                    break;
                switch (tag >>> 3) {
                case 1: {
                        message.balance = reader.double();
                        break;
                    }
                case 2: {
                        message.equity = reader.double();
                        break;
                    }
                case 3: {
                        message.margin = reader.double();
                        break;
                    }
                case 4: {
                        message.marginFree = reader.double();
                        break;
                    }
                case 5: {
                        message.marginLevel = reader.double();
                        break;
                    }
                case 6: {
                        if (!(message.positions && message.positions.length))
                            message.positions = [];
                        message.positions.push($root.browser.Position.decode(reader, reader.uint32()));
                        break;
                    }
                default:
                    reader.skipType(tag & 7);
                    break;
                }
            }
            return message;
        };

        /**
         * Decodes an AccountUpdate message from the specified reader or buffer, length delimited.
         * @function decodeDelimited
         * @memberof browser.AccountUpdate
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @returns {browser.AccountUpdate} AccountUpdate
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        AccountUpdate.decodeDelimited = function decodeDelimited(reader) {
            if (!(reader instanceof $Reader))
                reader = new $Reader(reader);
            return this.decode(reader, reader.uint32());
        };

        /**
         * Verifies an AccountUpdate message.
         * @function verify
         * @memberof browser.AccountUpdate
         * @static
         * @param {Object.<string,*>} message Plain object to verify
         * @returns {string|null} `null` if valid, otherwise the reason why it is not
         */
        AccountUpdate.verify = function verify(message) {
            if (typeof message !== "object" || message === null)
                return "object expected";
            if (message.balance != null && message.hasOwnProperty("balance"))
                if (typeof message.balance !== "number")
                    return "balance: number expected";
            if (message.equity != null && message.hasOwnProperty("equity"))
                if (typeof message.equity !== "number")
                    return "equity: number expected";
            if (message.margin != null && message.hasOwnProperty("margin"))
                if (typeof message.margin !== "number")
                    return "margin: number expected";
            if (message.marginFree != null && message.hasOwnProperty("marginFree"))
                if (typeof message.marginFree !== "number")
                    return "marginFree: number expected";
            if (message.marginLevel != null && message.hasOwnProperty("marginLevel"))
                if (typeof message.marginLevel !== "number")
                    return "marginLevel: number expected";
            if (message.positions != null && message.hasOwnProperty("positions")) {
                if (!Array.isArray(message.positions))
                    return "positions: array expected";
                for (let i = 0; i < message.positions.length; ++i) {
                    let error = $root.browser.Position.verify(message.positions[i]);
                    if (error)
                        return "positions." + error;
                }
            }
            return null;
        };

        /**
         * Creates an AccountUpdate message from a plain object. Also converts values to their respective internal types.
         * @function fromObject
         * @memberof browser.AccountUpdate
         * @static
         * @param {Object.<string,*>} object Plain object
         * @returns {browser.AccountUpdate} AccountUpdate
         */
        AccountUpdate.fromObject = function fromObject(object) {
            if (object instanceof $root.browser.AccountUpdate)
                return object;
            let message = new $root.browser.AccountUpdate();
            if (object.balance != null)
                message.balance = Number(object.balance);
            if (object.equity != null)
                message.equity = Number(object.equity);
            if (object.margin != null)
                message.margin = Number(object.margin);
            if (object.marginFree != null)
                message.marginFree = Number(object.marginFree);
            if (object.marginLevel != null)
                message.marginLevel = Number(object.marginLevel);
            if (object.positions) {
                if (!Array.isArray(object.positions))
                    throw TypeError(".browser.AccountUpdate.positions: array expected");
                message.positions = [];
                for (let i = 0; i < object.positions.length; ++i) {
                    if (typeof object.positions[i] !== "object")
                        throw TypeError(".browser.AccountUpdate.positions: object expected");
                    message.positions[i] = $root.browser.Position.fromObject(object.positions[i]);
                }
            }
            return message;
        };

        /**
         * Creates a plain object from an AccountUpdate message. Also converts values to other types if specified.
         * @function toObject
         * @memberof browser.AccountUpdate
         * @static
         * @param {browser.AccountUpdate} message AccountUpdate
         * @param {$protobuf.IConversionOptions} [options] Conversion options
         * @returns {Object.<string,*>} Plain object
         */
        AccountUpdate.toObject = function toObject(message, options) {
            if (!options)
                options = {};
            let object = {};
            if (options.arrays || options.defaults)
                object.positions = [];
            if (options.defaults) {
                object.balance = 0;
                object.equity = 0;
                object.margin = 0;
                object.marginFree = 0;
                object.marginLevel = 0;
            }
            if (message.balance != null && message.hasOwnProperty("balance"))
                object.balance = options.json && !isFinite(message.balance) ? String(message.balance) : message.balance;
            if (message.equity != null && message.hasOwnProperty("equity"))
                object.equity = options.json && !isFinite(message.equity) ? String(message.equity) : message.equity;
            if (message.margin != null && message.hasOwnProperty("margin"))
                object.margin = options.json && !isFinite(message.margin) ? String(message.margin) : message.margin;
            if (message.marginFree != null && message.hasOwnProperty("marginFree"))
                object.marginFree = options.json && !isFinite(message.marginFree) ? String(message.marginFree) : message.marginFree;
            if (message.marginLevel != null && message.hasOwnProperty("marginLevel"))
                object.marginLevel = options.json && !isFinite(message.marginLevel) ? String(message.marginLevel) : message.marginLevel;
            if (message.positions && message.positions.length) {
                object.positions = [];
                for (let j = 0; j < message.positions.length; ++j)
                    object.positions[j] = $root.browser.Position.toObject(message.positions[j], options);
            }
            return object;
        };

        /**
         * Converts this AccountUpdate to JSON.
         * @function toJSON
         * @memberof browser.AccountUpdate
         * @instance
         * @returns {Object.<string,*>} JSON object
         */
        AccountUpdate.prototype.toJSON = function toJSON() {
            return this.constructor.toObject(this, $protobuf.util.toJSONOptions);
        };

        /**
         * Gets the default type url for AccountUpdate
         * @function getTypeUrl
         * @memberof browser.AccountUpdate
         * @static
         * @param {string} [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns {string} The default type url
         */
        AccountUpdate.getTypeUrl = function getTypeUrl(typeUrlPrefix) {
            if (typeUrlPrefix === undefined) {
                typeUrlPrefix = "type.googleapis.com";
            }
            return typeUrlPrefix + "/browser.AccountUpdate";
        };

        return AccountUpdate;
    })();

    browser.Position = (function() {

        /**
         * Properties of a Position.
         * @memberof browser
         * @interface IPosition
         * @property {number|Long|null} [ticket] Position ticket
         * @property {string|null} [symbol] Position symbol
         * @property {string|null} [type] Position type
         * @property {number|null} [volume] Position volume
         * @property {number|null} [openPrice] Position openPrice
         * @property {number|null} [currentPrice] Position currentPrice
         * @property {number|null} [profit] Position profit
         * @property {number|null} [sl] Position sl
         * @property {number|null} [tp] Position tp
         * @property {number|Long|null} [openTime] Position openTime
         */

        /**
         * Constructs a new Position.
         * @memberof browser
         * @classdesc Represents a Position.
         * @implements IPosition
         * @constructor
         * @param {browser.IPosition=} [properties] Properties to set
         */
        function Position(properties) {
            if (properties)
                for (let keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                    if (properties[keys[i]] != null)
                        this[keys[i]] = properties[keys[i]];
        }

        /**
         * Position ticket.
         * @member {number|Long} ticket
         * @memberof browser.Position
         * @instance
         */
        Position.prototype.ticket = $util.Long ? $util.Long.fromBits(0,0,false) : 0;

        /**
         * Position symbol.
         * @member {string} symbol
         * @memberof browser.Position
         * @instance
         */
        Position.prototype.symbol = "";

        /**
         * Position type.
         * @member {string} type
         * @memberof browser.Position
         * @instance
         */
        Position.prototype.type = "";

        /**
         * Position volume.
         * @member {number} volume
         * @memberof browser.Position
         * @instance
         */
        Position.prototype.volume = 0;

        /**
         * Position openPrice.
         * @member {number} openPrice
         * @memberof browser.Position
         * @instance
         */
        Position.prototype.openPrice = 0;

        /**
         * Position currentPrice.
         * @member {number} currentPrice
         * @memberof browser.Position
         * @instance
         */
        Position.prototype.currentPrice = 0;

        /**
         * Position profit.
         * @member {number} profit
         * @memberof browser.Position
         * @instance
         */
        Position.prototype.profit = 0;

        /**
         * Position sl.
         * @member {number} sl
         * @memberof browser.Position
         * @instance
         */
        Position.prototype.sl = 0;

        /**
         * Position tp.
         * @member {number} tp
         * @memberof browser.Position
         * @instance
         */
        Position.prototype.tp = 0;

        /**
         * Position openTime.
         * @member {number|Long} openTime
         * @memberof browser.Position
         * @instance
         */
        Position.prototype.openTime = $util.Long ? $util.Long.fromBits(0,0,false) : 0;

        /**
         * Creates a new Position instance using the specified properties.
         * @function create
         * @memberof browser.Position
         * @static
         * @param {browser.IPosition=} [properties] Properties to set
         * @returns {browser.Position} Position instance
         */
        Position.create = function create(properties) {
            return new Position(properties);
        };

        /**
         * Encodes the specified Position message. Does not implicitly {@link browser.Position.verify|verify} messages.
         * @function encode
         * @memberof browser.Position
         * @static
         * @param {browser.IPosition} message Position message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        Position.encode = function encode(message, writer) {
            if (!writer)
                writer = $Writer.create();
            if (message.ticket != null && Object.hasOwnProperty.call(message, "ticket"))
                writer.uint32(/* id 1, wireType 0 =*/8).int64(message.ticket);
            if (message.symbol != null && Object.hasOwnProperty.call(message, "symbol"))
                writer.uint32(/* id 2, wireType 2 =*/18).string(message.symbol);
            if (message.type != null && Object.hasOwnProperty.call(message, "type"))
                writer.uint32(/* id 3, wireType 2 =*/26).string(message.type);
            if (message.volume != null && Object.hasOwnProperty.call(message, "volume"))
                writer.uint32(/* id 4, wireType 1 =*/33).double(message.volume);
            if (message.openPrice != null && Object.hasOwnProperty.call(message, "openPrice"))
                writer.uint32(/* id 5, wireType 1 =*/41).double(message.openPrice);
            if (message.currentPrice != null && Object.hasOwnProperty.call(message, "currentPrice"))
                writer.uint32(/* id 6, wireType 1 =*/49).double(message.currentPrice);
            if (message.profit != null && Object.hasOwnProperty.call(message, "profit"))
                writer.uint32(/* id 7, wireType 1 =*/57).double(message.profit);
            if (message.sl != null && Object.hasOwnProperty.call(message, "sl"))
                writer.uint32(/* id 8, wireType 1 =*/65).double(message.sl);
            if (message.tp != null && Object.hasOwnProperty.call(message, "tp"))
                writer.uint32(/* id 9, wireType 1 =*/73).double(message.tp);
            if (message.openTime != null && Object.hasOwnProperty.call(message, "openTime"))
                writer.uint32(/* id 10, wireType 0 =*/80).int64(message.openTime);
            return writer;
        };

        /**
         * Encodes the specified Position message, length delimited. Does not implicitly {@link browser.Position.verify|verify} messages.
         * @function encodeDelimited
         * @memberof browser.Position
         * @static
         * @param {browser.IPosition} message Position message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        Position.encodeDelimited = function encodeDelimited(message, writer) {
            return this.encode(message, writer).ldelim();
        };

        /**
         * Decodes a Position message from the specified reader or buffer.
         * @function decode
         * @memberof browser.Position
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @param {number} [length] Message length if known beforehand
         * @returns {browser.Position} Position
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        Position.decode = function decode(reader, length, error) {
            if (!(reader instanceof $Reader))
                reader = $Reader.create(reader);
            let end = length === undefined ? reader.len : reader.pos + length, message = new $root.browser.Position();
            while (reader.pos < end) {
                let tag = reader.uint32();
                if (tag === error)
                    break;
                switch (tag >>> 3) {
                case 1: {
                        message.ticket = reader.int64();
                        break;
                    }
                case 2: {
                        message.symbol = reader.string();
                        break;
                    }
                case 3: {
                        message.type = reader.string();
                        break;
                    }
                case 4: {
                        message.volume = reader.double();
                        break;
                    }
                case 5: {
                        message.openPrice = reader.double();
                        break;
                    }
                case 6: {
                        message.currentPrice = reader.double();
                        break;
                    }
                case 7: {
                        message.profit = reader.double();
                        break;
                    }
                case 8: {
                        message.sl = reader.double();
                        break;
                    }
                case 9: {
                        message.tp = reader.double();
                        break;
                    }
                case 10: {
                        message.openTime = reader.int64();
                        break;
                    }
                default:
                    reader.skipType(tag & 7);
                    break;
                }
            }
            return message;
        };

        /**
         * Decodes a Position message from the specified reader or buffer, length delimited.
         * @function decodeDelimited
         * @memberof browser.Position
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @returns {browser.Position} Position
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        Position.decodeDelimited = function decodeDelimited(reader) {
            if (!(reader instanceof $Reader))
                reader = new $Reader(reader);
            return this.decode(reader, reader.uint32());
        };

        /**
         * Verifies a Position message.
         * @function verify
         * @memberof browser.Position
         * @static
         * @param {Object.<string,*>} message Plain object to verify
         * @returns {string|null} `null` if valid, otherwise the reason why it is not
         */
        Position.verify = function verify(message) {
            if (typeof message !== "object" || message === null)
                return "object expected";
            if (message.ticket != null && message.hasOwnProperty("ticket"))
                if (!$util.isInteger(message.ticket) && !(message.ticket && $util.isInteger(message.ticket.low) && $util.isInteger(message.ticket.high)))
                    return "ticket: integer|Long expected";
            if (message.symbol != null && message.hasOwnProperty("symbol"))
                if (!$util.isString(message.symbol))
                    return "symbol: string expected";
            if (message.type != null && message.hasOwnProperty("type"))
                if (!$util.isString(message.type))
                    return "type: string expected";
            if (message.volume != null && message.hasOwnProperty("volume"))
                if (typeof message.volume !== "number")
                    return "volume: number expected";
            if (message.openPrice != null && message.hasOwnProperty("openPrice"))
                if (typeof message.openPrice !== "number")
                    return "openPrice: number expected";
            if (message.currentPrice != null && message.hasOwnProperty("currentPrice"))
                if (typeof message.currentPrice !== "number")
                    return "currentPrice: number expected";
            if (message.profit != null && message.hasOwnProperty("profit"))
                if (typeof message.profit !== "number")
                    return "profit: number expected";
            if (message.sl != null && message.hasOwnProperty("sl"))
                if (typeof message.sl !== "number")
                    return "sl: number expected";
            if (message.tp != null && message.hasOwnProperty("tp"))
                if (typeof message.tp !== "number")
                    return "tp: number expected";
            if (message.openTime != null && message.hasOwnProperty("openTime"))
                if (!$util.isInteger(message.openTime) && !(message.openTime && $util.isInteger(message.openTime.low) && $util.isInteger(message.openTime.high)))
                    return "openTime: integer|Long expected";
            return null;
        };

        /**
         * Creates a Position message from a plain object. Also converts values to their respective internal types.
         * @function fromObject
         * @memberof browser.Position
         * @static
         * @param {Object.<string,*>} object Plain object
         * @returns {browser.Position} Position
         */
        Position.fromObject = function fromObject(object) {
            if (object instanceof $root.browser.Position)
                return object;
            let message = new $root.browser.Position();
            if (object.ticket != null)
                if ($util.Long)
                    (message.ticket = $util.Long.fromValue(object.ticket)).unsigned = false;
                else if (typeof object.ticket === "string")
                    message.ticket = parseInt(object.ticket, 10);
                else if (typeof object.ticket === "number")
                    message.ticket = object.ticket;
                else if (typeof object.ticket === "object")
                    message.ticket = new $util.LongBits(object.ticket.low >>> 0, object.ticket.high >>> 0).toNumber();
            if (object.symbol != null)
                message.symbol = String(object.symbol);
            if (object.type != null)
                message.type = String(object.type);
            if (object.volume != null)
                message.volume = Number(object.volume);
            if (object.openPrice != null)
                message.openPrice = Number(object.openPrice);
            if (object.currentPrice != null)
                message.currentPrice = Number(object.currentPrice);
            if (object.profit != null)
                message.profit = Number(object.profit);
            if (object.sl != null)
                message.sl = Number(object.sl);
            if (object.tp != null)
                message.tp = Number(object.tp);
            if (object.openTime != null)
                if ($util.Long)
                    (message.openTime = $util.Long.fromValue(object.openTime)).unsigned = false;
                else if (typeof object.openTime === "string")
                    message.openTime = parseInt(object.openTime, 10);
                else if (typeof object.openTime === "number")
                    message.openTime = object.openTime;
                else if (typeof object.openTime === "object")
                    message.openTime = new $util.LongBits(object.openTime.low >>> 0, object.openTime.high >>> 0).toNumber();
            return message;
        };

        /**
         * Creates a plain object from a Position message. Also converts values to other types if specified.
         * @function toObject
         * @memberof browser.Position
         * @static
         * @param {browser.Position} message Position
         * @param {$protobuf.IConversionOptions} [options] Conversion options
         * @returns {Object.<string,*>} Plain object
         */
        Position.toObject = function toObject(message, options) {
            if (!options)
                options = {};
            let object = {};
            if (options.defaults) {
                if ($util.Long) {
                    let long = new $util.Long(0, 0, false);
                    object.ticket = options.longs === String ? long.toString() : options.longs === Number ? long.toNumber() : long;
                } else
                    object.ticket = options.longs === String ? "0" : 0;
                object.symbol = "";
                object.type = "";
                object.volume = 0;
                object.openPrice = 0;
                object.currentPrice = 0;
                object.profit = 0;
                object.sl = 0;
                object.tp = 0;
                if ($util.Long) {
                    let long = new $util.Long(0, 0, false);
                    object.openTime = options.longs === String ? long.toString() : options.longs === Number ? long.toNumber() : long;
                } else
                    object.openTime = options.longs === String ? "0" : 0;
            }
            if (message.ticket != null && message.hasOwnProperty("ticket"))
                if (typeof message.ticket === "number")
                    object.ticket = options.longs === String ? String(message.ticket) : message.ticket;
                else
                    object.ticket = options.longs === String ? $util.Long.prototype.toString.call(message.ticket) : options.longs === Number ? new $util.LongBits(message.ticket.low >>> 0, message.ticket.high >>> 0).toNumber() : message.ticket;
            if (message.symbol != null && message.hasOwnProperty("symbol"))
                object.symbol = message.symbol;
            if (message.type != null && message.hasOwnProperty("type"))
                object.type = message.type;
            if (message.volume != null && message.hasOwnProperty("volume"))
                object.volume = options.json && !isFinite(message.volume) ? String(message.volume) : message.volume;
            if (message.openPrice != null && message.hasOwnProperty("openPrice"))
                object.openPrice = options.json && !isFinite(message.openPrice) ? String(message.openPrice) : message.openPrice;
            if (message.currentPrice != null && message.hasOwnProperty("currentPrice"))
                object.currentPrice = options.json && !isFinite(message.currentPrice) ? String(message.currentPrice) : message.currentPrice;
            if (message.profit != null && message.hasOwnProperty("profit"))
                object.profit = options.json && !isFinite(message.profit) ? String(message.profit) : message.profit;
            if (message.sl != null && message.hasOwnProperty("sl"))
                object.sl = options.json && !isFinite(message.sl) ? String(message.sl) : message.sl;
            if (message.tp != null && message.hasOwnProperty("tp"))
                object.tp = options.json && !isFinite(message.tp) ? String(message.tp) : message.tp;
            if (message.openTime != null && message.hasOwnProperty("openTime"))
                if (typeof message.openTime === "number")
                    object.openTime = options.longs === String ? String(message.openTime) : message.openTime;
                else
                    object.openTime = options.longs === String ? $util.Long.prototype.toString.call(message.openTime) : options.longs === Number ? new $util.LongBits(message.openTime.low >>> 0, message.openTime.high >>> 0).toNumber() : message.openTime;
            return object;
        };

        /**
         * Converts this Position to JSON.
         * @function toJSON
         * @memberof browser.Position
         * @instance
         * @returns {Object.<string,*>} JSON object
         */
        Position.prototype.toJSON = function toJSON() {
            return this.constructor.toObject(this, $protobuf.util.toJSONOptions);
        };

        /**
         * Gets the default type url for Position
         * @function getTypeUrl
         * @memberof browser.Position
         * @static
         * @param {string} [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns {string} The default type url
         */
        Position.getTypeUrl = function getTypeUrl(typeUrlPrefix) {
            if (typeUrlPrefix === undefined) {
                typeUrlPrefix = "type.googleapis.com";
            }
            return typeUrlPrefix + "/browser.Position";
        };

        return Position;
    })();

    browser.HistoryUpdate = (function() {

        /**
         * Properties of a HistoryUpdate.
         * @memberof browser
         * @interface IHistoryUpdate
         * @property {number|null} [count] HistoryUpdate count
         * @property {Array.<browser.ITrade>|null} [trades] HistoryUpdate trades
         */

        /**
         * Constructs a new HistoryUpdate.
         * @memberof browser
         * @classdesc Represents a HistoryUpdate.
         * @implements IHistoryUpdate
         * @constructor
         * @param {browser.IHistoryUpdate=} [properties] Properties to set
         */
        function HistoryUpdate(properties) {
            this.trades = [];
            if (properties)
                for (let keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                    if (properties[keys[i]] != null)
                        this[keys[i]] = properties[keys[i]];
        }

        /**
         * HistoryUpdate count.
         * @member {number} count
         * @memberof browser.HistoryUpdate
         * @instance
         */
        HistoryUpdate.prototype.count = 0;

        /**
         * HistoryUpdate trades.
         * @member {Array.<browser.ITrade>} trades
         * @memberof browser.HistoryUpdate
         * @instance
         */
        HistoryUpdate.prototype.trades = $util.emptyArray;

        /**
         * Creates a new HistoryUpdate instance using the specified properties.
         * @function create
         * @memberof browser.HistoryUpdate
         * @static
         * @param {browser.IHistoryUpdate=} [properties] Properties to set
         * @returns {browser.HistoryUpdate} HistoryUpdate instance
         */
        HistoryUpdate.create = function create(properties) {
            return new HistoryUpdate(properties);
        };

        /**
         * Encodes the specified HistoryUpdate message. Does not implicitly {@link browser.HistoryUpdate.verify|verify} messages.
         * @function encode
         * @memberof browser.HistoryUpdate
         * @static
         * @param {browser.IHistoryUpdate} message HistoryUpdate message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        HistoryUpdate.encode = function encode(message, writer) {
            if (!writer)
                writer = $Writer.create();
            if (message.count != null && Object.hasOwnProperty.call(message, "count"))
                writer.uint32(/* id 1, wireType 0 =*/8).int32(message.count);
            if (message.trades != null && message.trades.length)
                for (let i = 0; i < message.trades.length; ++i)
                    $root.browser.Trade.encode(message.trades[i], writer.uint32(/* id 2, wireType 2 =*/18).fork()).ldelim();
            return writer;
        };

        /**
         * Encodes the specified HistoryUpdate message, length delimited. Does not implicitly {@link browser.HistoryUpdate.verify|verify} messages.
         * @function encodeDelimited
         * @memberof browser.HistoryUpdate
         * @static
         * @param {browser.IHistoryUpdate} message HistoryUpdate message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        HistoryUpdate.encodeDelimited = function encodeDelimited(message, writer) {
            return this.encode(message, writer).ldelim();
        };

        /**
         * Decodes a HistoryUpdate message from the specified reader or buffer.
         * @function decode
         * @memberof browser.HistoryUpdate
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @param {number} [length] Message length if known beforehand
         * @returns {browser.HistoryUpdate} HistoryUpdate
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        HistoryUpdate.decode = function decode(reader, length, error) {
            if (!(reader instanceof $Reader))
                reader = $Reader.create(reader);
            let end = length === undefined ? reader.len : reader.pos + length, message = new $root.browser.HistoryUpdate();
            while (reader.pos < end) {
                let tag = reader.uint32();
                if (tag === error)
                    break;
                switch (tag >>> 3) {
                case 1: {
                        message.count = reader.int32();
                        break;
                    }
                case 2: {
                        if (!(message.trades && message.trades.length))
                            message.trades = [];
                        message.trades.push($root.browser.Trade.decode(reader, reader.uint32()));
                        break;
                    }
                default:
                    reader.skipType(tag & 7);
                    break;
                }
            }
            return message;
        };

        /**
         * Decodes a HistoryUpdate message from the specified reader or buffer, length delimited.
         * @function decodeDelimited
         * @memberof browser.HistoryUpdate
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @returns {browser.HistoryUpdate} HistoryUpdate
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        HistoryUpdate.decodeDelimited = function decodeDelimited(reader) {
            if (!(reader instanceof $Reader))
                reader = new $Reader(reader);
            return this.decode(reader, reader.uint32());
        };

        /**
         * Verifies a HistoryUpdate message.
         * @function verify
         * @memberof browser.HistoryUpdate
         * @static
         * @param {Object.<string,*>} message Plain object to verify
         * @returns {string|null} `null` if valid, otherwise the reason why it is not
         */
        HistoryUpdate.verify = function verify(message) {
            if (typeof message !== "object" || message === null)
                return "object expected";
            if (message.count != null && message.hasOwnProperty("count"))
                if (!$util.isInteger(message.count))
                    return "count: integer expected";
            if (message.trades != null && message.hasOwnProperty("trades")) {
                if (!Array.isArray(message.trades))
                    return "trades: array expected";
                for (let i = 0; i < message.trades.length; ++i) {
                    let error = $root.browser.Trade.verify(message.trades[i]);
                    if (error)
                        return "trades." + error;
                }
            }
            return null;
        };

        /**
         * Creates a HistoryUpdate message from a plain object. Also converts values to their respective internal types.
         * @function fromObject
         * @memberof browser.HistoryUpdate
         * @static
         * @param {Object.<string,*>} object Plain object
         * @returns {browser.HistoryUpdate} HistoryUpdate
         */
        HistoryUpdate.fromObject = function fromObject(object) {
            if (object instanceof $root.browser.HistoryUpdate)
                return object;
            let message = new $root.browser.HistoryUpdate();
            if (object.count != null)
                message.count = object.count | 0;
            if (object.trades) {
                if (!Array.isArray(object.trades))
                    throw TypeError(".browser.HistoryUpdate.trades: array expected");
                message.trades = [];
                for (let i = 0; i < object.trades.length; ++i) {
                    if (typeof object.trades[i] !== "object")
                        throw TypeError(".browser.HistoryUpdate.trades: object expected");
                    message.trades[i] = $root.browser.Trade.fromObject(object.trades[i]);
                }
            }
            return message;
        };

        /**
         * Creates a plain object from a HistoryUpdate message. Also converts values to other types if specified.
         * @function toObject
         * @memberof browser.HistoryUpdate
         * @static
         * @param {browser.HistoryUpdate} message HistoryUpdate
         * @param {$protobuf.IConversionOptions} [options] Conversion options
         * @returns {Object.<string,*>} Plain object
         */
        HistoryUpdate.toObject = function toObject(message, options) {
            if (!options)
                options = {};
            let object = {};
            if (options.arrays || options.defaults)
                object.trades = [];
            if (options.defaults)
                object.count = 0;
            if (message.count != null && message.hasOwnProperty("count"))
                object.count = message.count;
            if (message.trades && message.trades.length) {
                object.trades = [];
                for (let j = 0; j < message.trades.length; ++j)
                    object.trades[j] = $root.browser.Trade.toObject(message.trades[j], options);
            }
            return object;
        };

        /**
         * Converts this HistoryUpdate to JSON.
         * @function toJSON
         * @memberof browser.HistoryUpdate
         * @instance
         * @returns {Object.<string,*>} JSON object
         */
        HistoryUpdate.prototype.toJSON = function toJSON() {
            return this.constructor.toObject(this, $protobuf.util.toJSONOptions);
        };

        /**
         * Gets the default type url for HistoryUpdate
         * @function getTypeUrl
         * @memberof browser.HistoryUpdate
         * @static
         * @param {string} [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns {string} The default type url
         */
        HistoryUpdate.getTypeUrl = function getTypeUrl(typeUrlPrefix) {
            if (typeUrlPrefix === undefined) {
                typeUrlPrefix = "type.googleapis.com";
            }
            return typeUrlPrefix + "/browser.HistoryUpdate";
        };

        return HistoryUpdate;
    })();

    browser.Trade = (function() {

        /**
         * Properties of a Trade.
         * @memberof browser
         * @interface ITrade
         * @property {number|Long|null} [ticket] Trade ticket
         * @property {string|null} [symbol] Trade symbol
         * @property {string|null} [type] Trade type
         * @property {number|null} [volume] Trade volume
         * @property {number|null} [openPrice] Trade openPrice
         * @property {number|null} [closePrice] Trade closePrice
         * @property {number|Long|null} [openTime] Trade openTime
         * @property {number|Long|null} [closeTime] Trade closeTime
         * @property {number|null} [profit] Trade profit
         * @property {number|null} [commission] Trade commission
         * @property {number|null} [swap] Trade swap
         * @property {string|null} [comment] Trade comment
         */

        /**
         * Constructs a new Trade.
         * @memberof browser
         * @classdesc Represents a Trade.
         * @implements ITrade
         * @constructor
         * @param {browser.ITrade=} [properties] Properties to set
         */
        function Trade(properties) {
            if (properties)
                for (let keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                    if (properties[keys[i]] != null)
                        this[keys[i]] = properties[keys[i]];
        }

        /**
         * Trade ticket.
         * @member {number|Long} ticket
         * @memberof browser.Trade
         * @instance
         */
        Trade.prototype.ticket = $util.Long ? $util.Long.fromBits(0,0,false) : 0;

        /**
         * Trade symbol.
         * @member {string} symbol
         * @memberof browser.Trade
         * @instance
         */
        Trade.prototype.symbol = "";

        /**
         * Trade type.
         * @member {string} type
         * @memberof browser.Trade
         * @instance
         */
        Trade.prototype.type = "";

        /**
         * Trade volume.
         * @member {number} volume
         * @memberof browser.Trade
         * @instance
         */
        Trade.prototype.volume = 0;

        /**
         * Trade openPrice.
         * @member {number} openPrice
         * @memberof browser.Trade
         * @instance
         */
        Trade.prototype.openPrice = 0;

        /**
         * Trade closePrice.
         * @member {number} closePrice
         * @memberof browser.Trade
         * @instance
         */
        Trade.prototype.closePrice = 0;

        /**
         * Trade openTime.
         * @member {number|Long} openTime
         * @memberof browser.Trade
         * @instance
         */
        Trade.prototype.openTime = $util.Long ? $util.Long.fromBits(0,0,false) : 0;

        /**
         * Trade closeTime.
         * @member {number|Long} closeTime
         * @memberof browser.Trade
         * @instance
         */
        Trade.prototype.closeTime = $util.Long ? $util.Long.fromBits(0,0,false) : 0;

        /**
         * Trade profit.
         * @member {number} profit
         * @memberof browser.Trade
         * @instance
         */
        Trade.prototype.profit = 0;

        /**
         * Trade commission.
         * @member {number} commission
         * @memberof browser.Trade
         * @instance
         */
        Trade.prototype.commission = 0;

        /**
         * Trade swap.
         * @member {number} swap
         * @memberof browser.Trade
         * @instance
         */
        Trade.prototype.swap = 0;

        /**
         * Trade comment.
         * @member {string} comment
         * @memberof browser.Trade
         * @instance
         */
        Trade.prototype.comment = "";

        /**
         * Creates a new Trade instance using the specified properties.
         * @function create
         * @memberof browser.Trade
         * @static
         * @param {browser.ITrade=} [properties] Properties to set
         * @returns {browser.Trade} Trade instance
         */
        Trade.create = function create(properties) {
            return new Trade(properties);
        };

        /**
         * Encodes the specified Trade message. Does not implicitly {@link browser.Trade.verify|verify} messages.
         * @function encode
         * @memberof browser.Trade
         * @static
         * @param {browser.ITrade} message Trade message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        Trade.encode = function encode(message, writer) {
            if (!writer)
                writer = $Writer.create();
            if (message.ticket != null && Object.hasOwnProperty.call(message, "ticket"))
                writer.uint32(/* id 1, wireType 0 =*/8).int64(message.ticket);
            if (message.symbol != null && Object.hasOwnProperty.call(message, "symbol"))
                writer.uint32(/* id 2, wireType 2 =*/18).string(message.symbol);
            if (message.type != null && Object.hasOwnProperty.call(message, "type"))
                writer.uint32(/* id 3, wireType 2 =*/26).string(message.type);
            if (message.volume != null && Object.hasOwnProperty.call(message, "volume"))
                writer.uint32(/* id 4, wireType 1 =*/33).double(message.volume);
            if (message.openPrice != null && Object.hasOwnProperty.call(message, "openPrice"))
                writer.uint32(/* id 5, wireType 1 =*/41).double(message.openPrice);
            if (message.closePrice != null && Object.hasOwnProperty.call(message, "closePrice"))
                writer.uint32(/* id 6, wireType 1 =*/49).double(message.closePrice);
            if (message.openTime != null && Object.hasOwnProperty.call(message, "openTime"))
                writer.uint32(/* id 7, wireType 0 =*/56).int64(message.openTime);
            if (message.closeTime != null && Object.hasOwnProperty.call(message, "closeTime"))
                writer.uint32(/* id 8, wireType 0 =*/64).int64(message.closeTime);
            if (message.profit != null && Object.hasOwnProperty.call(message, "profit"))
                writer.uint32(/* id 9, wireType 1 =*/73).double(message.profit);
            if (message.commission != null && Object.hasOwnProperty.call(message, "commission"))
                writer.uint32(/* id 10, wireType 1 =*/81).double(message.commission);
            if (message.swap != null && Object.hasOwnProperty.call(message, "swap"))
                writer.uint32(/* id 11, wireType 1 =*/89).double(message.swap);
            if (message.comment != null && Object.hasOwnProperty.call(message, "comment"))
                writer.uint32(/* id 12, wireType 2 =*/98).string(message.comment);
            return writer;
        };

        /**
         * Encodes the specified Trade message, length delimited. Does not implicitly {@link browser.Trade.verify|verify} messages.
         * @function encodeDelimited
         * @memberof browser.Trade
         * @static
         * @param {browser.ITrade} message Trade message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        Trade.encodeDelimited = function encodeDelimited(message, writer) {
            return this.encode(message, writer).ldelim();
        };

        /**
         * Decodes a Trade message from the specified reader or buffer.
         * @function decode
         * @memberof browser.Trade
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @param {number} [length] Message length if known beforehand
         * @returns {browser.Trade} Trade
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        Trade.decode = function decode(reader, length, error) {
            if (!(reader instanceof $Reader))
                reader = $Reader.create(reader);
            let end = length === undefined ? reader.len : reader.pos + length, message = new $root.browser.Trade();
            while (reader.pos < end) {
                let tag = reader.uint32();
                if (tag === error)
                    break;
                switch (tag >>> 3) {
                case 1: {
                        message.ticket = reader.int64();
                        break;
                    }
                case 2: {
                        message.symbol = reader.string();
                        break;
                    }
                case 3: {
                        message.type = reader.string();
                        break;
                    }
                case 4: {
                        message.volume = reader.double();
                        break;
                    }
                case 5: {
                        message.openPrice = reader.double();
                        break;
                    }
                case 6: {
                        message.closePrice = reader.double();
                        break;
                    }
                case 7: {
                        message.openTime = reader.int64();
                        break;
                    }
                case 8: {
                        message.closeTime = reader.int64();
                        break;
                    }
                case 9: {
                        message.profit = reader.double();
                        break;
                    }
                case 10: {
                        message.commission = reader.double();
                        break;
                    }
                case 11: {
                        message.swap = reader.double();
                        break;
                    }
                case 12: {
                        message.comment = reader.string();
                        break;
                    }
                default:
                    reader.skipType(tag & 7);
                    break;
                }
            }
            return message;
        };

        /**
         * Decodes a Trade message from the specified reader or buffer, length delimited.
         * @function decodeDelimited
         * @memberof browser.Trade
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @returns {browser.Trade} Trade
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        Trade.decodeDelimited = function decodeDelimited(reader) {
            if (!(reader instanceof $Reader))
                reader = new $Reader(reader);
            return this.decode(reader, reader.uint32());
        };

        /**
         * Verifies a Trade message.
         * @function verify
         * @memberof browser.Trade
         * @static
         * @param {Object.<string,*>} message Plain object to verify
         * @returns {string|null} `null` if valid, otherwise the reason why it is not
         */
        Trade.verify = function verify(message) {
            if (typeof message !== "object" || message === null)
                return "object expected";
            if (message.ticket != null && message.hasOwnProperty("ticket"))
                if (!$util.isInteger(message.ticket) && !(message.ticket && $util.isInteger(message.ticket.low) && $util.isInteger(message.ticket.high)))
                    return "ticket: integer|Long expected";
            if (message.symbol != null && message.hasOwnProperty("symbol"))
                if (!$util.isString(message.symbol))
                    return "symbol: string expected";
            if (message.type != null && message.hasOwnProperty("type"))
                if (!$util.isString(message.type))
                    return "type: string expected";
            if (message.volume != null && message.hasOwnProperty("volume"))
                if (typeof message.volume !== "number")
                    return "volume: number expected";
            if (message.openPrice != null && message.hasOwnProperty("openPrice"))
                if (typeof message.openPrice !== "number")
                    return "openPrice: number expected";
            if (message.closePrice != null && message.hasOwnProperty("closePrice"))
                if (typeof message.closePrice !== "number")
                    return "closePrice: number expected";
            if (message.openTime != null && message.hasOwnProperty("openTime"))
                if (!$util.isInteger(message.openTime) && !(message.openTime && $util.isInteger(message.openTime.low) && $util.isInteger(message.openTime.high)))
                    return "openTime: integer|Long expected";
            if (message.closeTime != null && message.hasOwnProperty("closeTime"))
                if (!$util.isInteger(message.closeTime) && !(message.closeTime && $util.isInteger(message.closeTime.low) && $util.isInteger(message.closeTime.high)))
                    return "closeTime: integer|Long expected";
            if (message.profit != null && message.hasOwnProperty("profit"))
                if (typeof message.profit !== "number")
                    return "profit: number expected";
            if (message.commission != null && message.hasOwnProperty("commission"))
                if (typeof message.commission !== "number")
                    return "commission: number expected";
            if (message.swap != null && message.hasOwnProperty("swap"))
                if (typeof message.swap !== "number")
                    return "swap: number expected";
            if (message.comment != null && message.hasOwnProperty("comment"))
                if (!$util.isString(message.comment))
                    return "comment: string expected";
            return null;
        };

        /**
         * Creates a Trade message from a plain object. Also converts values to their respective internal types.
         * @function fromObject
         * @memberof browser.Trade
         * @static
         * @param {Object.<string,*>} object Plain object
         * @returns {browser.Trade} Trade
         */
        Trade.fromObject = function fromObject(object) {
            if (object instanceof $root.browser.Trade)
                return object;
            let message = new $root.browser.Trade();
            if (object.ticket != null)
                if ($util.Long)
                    (message.ticket = $util.Long.fromValue(object.ticket)).unsigned = false;
                else if (typeof object.ticket === "string")
                    message.ticket = parseInt(object.ticket, 10);
                else if (typeof object.ticket === "number")
                    message.ticket = object.ticket;
                else if (typeof object.ticket === "object")
                    message.ticket = new $util.LongBits(object.ticket.low >>> 0, object.ticket.high >>> 0).toNumber();
            if (object.symbol != null)
                message.symbol = String(object.symbol);
            if (object.type != null)
                message.type = String(object.type);
            if (object.volume != null)
                message.volume = Number(object.volume);
            if (object.openPrice != null)
                message.openPrice = Number(object.openPrice);
            if (object.closePrice != null)
                message.closePrice = Number(object.closePrice);
            if (object.openTime != null)
                if ($util.Long)
                    (message.openTime = $util.Long.fromValue(object.openTime)).unsigned = false;
                else if (typeof object.openTime === "string")
                    message.openTime = parseInt(object.openTime, 10);
                else if (typeof object.openTime === "number")
                    message.openTime = object.openTime;
                else if (typeof object.openTime === "object")
                    message.openTime = new $util.LongBits(object.openTime.low >>> 0, object.openTime.high >>> 0).toNumber();
            if (object.closeTime != null)
                if ($util.Long)
                    (message.closeTime = $util.Long.fromValue(object.closeTime)).unsigned = false;
                else if (typeof object.closeTime === "string")
                    message.closeTime = parseInt(object.closeTime, 10);
                else if (typeof object.closeTime === "number")
                    message.closeTime = object.closeTime;
                else if (typeof object.closeTime === "object")
                    message.closeTime = new $util.LongBits(object.closeTime.low >>> 0, object.closeTime.high >>> 0).toNumber();
            if (object.profit != null)
                message.profit = Number(object.profit);
            if (object.commission != null)
                message.commission = Number(object.commission);
            if (object.swap != null)
                message.swap = Number(object.swap);
            if (object.comment != null)
                message.comment = String(object.comment);
            return message;
        };

        /**
         * Creates a plain object from a Trade message. Also converts values to other types if specified.
         * @function toObject
         * @memberof browser.Trade
         * @static
         * @param {browser.Trade} message Trade
         * @param {$protobuf.IConversionOptions} [options] Conversion options
         * @returns {Object.<string,*>} Plain object
         */
        Trade.toObject = function toObject(message, options) {
            if (!options)
                options = {};
            let object = {};
            if (options.defaults) {
                if ($util.Long) {
                    let long = new $util.Long(0, 0, false);
                    object.ticket = options.longs === String ? long.toString() : options.longs === Number ? long.toNumber() : long;
                } else
                    object.ticket = options.longs === String ? "0" : 0;
                object.symbol = "";
                object.type = "";
                object.volume = 0;
                object.openPrice = 0;
                object.closePrice = 0;
                if ($util.Long) {
                    let long = new $util.Long(0, 0, false);
                    object.openTime = options.longs === String ? long.toString() : options.longs === Number ? long.toNumber() : long;
                } else
                    object.openTime = options.longs === String ? "0" : 0;
                if ($util.Long) {
                    let long = new $util.Long(0, 0, false);
                    object.closeTime = options.longs === String ? long.toString() : options.longs === Number ? long.toNumber() : long;
                } else
                    object.closeTime = options.longs === String ? "0" : 0;
                object.profit = 0;
                object.commission = 0;
                object.swap = 0;
                object.comment = "";
            }
            if (message.ticket != null && message.hasOwnProperty("ticket"))
                if (typeof message.ticket === "number")
                    object.ticket = options.longs === String ? String(message.ticket) : message.ticket;
                else
                    object.ticket = options.longs === String ? $util.Long.prototype.toString.call(message.ticket) : options.longs === Number ? new $util.LongBits(message.ticket.low >>> 0, message.ticket.high >>> 0).toNumber() : message.ticket;
            if (message.symbol != null && message.hasOwnProperty("symbol"))
                object.symbol = message.symbol;
            if (message.type != null && message.hasOwnProperty("type"))
                object.type = message.type;
            if (message.volume != null && message.hasOwnProperty("volume"))
                object.volume = options.json && !isFinite(message.volume) ? String(message.volume) : message.volume;
            if (message.openPrice != null && message.hasOwnProperty("openPrice"))
                object.openPrice = options.json && !isFinite(message.openPrice) ? String(message.openPrice) : message.openPrice;
            if (message.closePrice != null && message.hasOwnProperty("closePrice"))
                object.closePrice = options.json && !isFinite(message.closePrice) ? String(message.closePrice) : message.closePrice;
            if (message.openTime != null && message.hasOwnProperty("openTime"))
                if (typeof message.openTime === "number")
                    object.openTime = options.longs === String ? String(message.openTime) : message.openTime;
                else
                    object.openTime = options.longs === String ? $util.Long.prototype.toString.call(message.openTime) : options.longs === Number ? new $util.LongBits(message.openTime.low >>> 0, message.openTime.high >>> 0).toNumber() : message.openTime;
            if (message.closeTime != null && message.hasOwnProperty("closeTime"))
                if (typeof message.closeTime === "number")
                    object.closeTime = options.longs === String ? String(message.closeTime) : message.closeTime;
                else
                    object.closeTime = options.longs === String ? $util.Long.prototype.toString.call(message.closeTime) : options.longs === Number ? new $util.LongBits(message.closeTime.low >>> 0, message.closeTime.high >>> 0).toNumber() : message.closeTime;
            if (message.profit != null && message.hasOwnProperty("profit"))
                object.profit = options.json && !isFinite(message.profit) ? String(message.profit) : message.profit;
            if (message.commission != null && message.hasOwnProperty("commission"))
                object.commission = options.json && !isFinite(message.commission) ? String(message.commission) : message.commission;
            if (message.swap != null && message.hasOwnProperty("swap"))
                object.swap = options.json && !isFinite(message.swap) ? String(message.swap) : message.swap;
            if (message.comment != null && message.hasOwnProperty("comment"))
                object.comment = message.comment;
            return object;
        };

        /**
         * Converts this Trade to JSON.
         * @function toJSON
         * @memberof browser.Trade
         * @instance
         * @returns {Object.<string,*>} JSON object
         */
        Trade.prototype.toJSON = function toJSON() {
            return this.constructor.toObject(this, $protobuf.util.toJSONOptions);
        };

        /**
         * Gets the default type url for Trade
         * @function getTypeUrl
         * @memberof browser.Trade
         * @static
         * @param {string} [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns {string} The default type url
         */
        Trade.getTypeUrl = function getTypeUrl(typeUrlPrefix) {
            if (typeUrlPrefix === undefined) {
                typeUrlPrefix = "type.googleapis.com";
            }
            return typeUrlPrefix + "/browser.Trade";
        };

        return Trade;
    })();

    browser.ConnectionStatus = (function() {

        /**
         * Properties of a ConnectionStatus.
         * @memberof browser
         * @interface IConnectionStatus
         * @property {boolean|null} [isConnected] ConnectionStatus isConnected
         */

        /**
         * Constructs a new ConnectionStatus.
         * @memberof browser
         * @classdesc Represents a ConnectionStatus.
         * @implements IConnectionStatus
         * @constructor
         * @param {browser.IConnectionStatus=} [properties] Properties to set
         */
        function ConnectionStatus(properties) {
            if (properties)
                for (let keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                    if (properties[keys[i]] != null)
                        this[keys[i]] = properties[keys[i]];
        }

        /**
         * ConnectionStatus isConnected.
         * @member {boolean} isConnected
         * @memberof browser.ConnectionStatus
         * @instance
         */
        ConnectionStatus.prototype.isConnected = false;

        /**
         * Creates a new ConnectionStatus instance using the specified properties.
         * @function create
         * @memberof browser.ConnectionStatus
         * @static
         * @param {browser.IConnectionStatus=} [properties] Properties to set
         * @returns {browser.ConnectionStatus} ConnectionStatus instance
         */
        ConnectionStatus.create = function create(properties) {
            return new ConnectionStatus(properties);
        };

        /**
         * Encodes the specified ConnectionStatus message. Does not implicitly {@link browser.ConnectionStatus.verify|verify} messages.
         * @function encode
         * @memberof browser.ConnectionStatus
         * @static
         * @param {browser.IConnectionStatus} message ConnectionStatus message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        ConnectionStatus.encode = function encode(message, writer) {
            if (!writer)
                writer = $Writer.create();
            if (message.isConnected != null && Object.hasOwnProperty.call(message, "isConnected"))
                writer.uint32(/* id 1, wireType 0 =*/8).bool(message.isConnected);
            return writer;
        };

        /**
         * Encodes the specified ConnectionStatus message, length delimited. Does not implicitly {@link browser.ConnectionStatus.verify|verify} messages.
         * @function encodeDelimited
         * @memberof browser.ConnectionStatus
         * @static
         * @param {browser.IConnectionStatus} message ConnectionStatus message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        ConnectionStatus.encodeDelimited = function encodeDelimited(message, writer) {
            return this.encode(message, writer).ldelim();
        };

        /**
         * Decodes a ConnectionStatus message from the specified reader or buffer.
         * @function decode
         * @memberof browser.ConnectionStatus
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @param {number} [length] Message length if known beforehand
         * @returns {browser.ConnectionStatus} ConnectionStatus
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        ConnectionStatus.decode = function decode(reader, length, error) {
            if (!(reader instanceof $Reader))
                reader = $Reader.create(reader);
            let end = length === undefined ? reader.len : reader.pos + length, message = new $root.browser.ConnectionStatus();
            while (reader.pos < end) {
                let tag = reader.uint32();
                if (tag === error)
                    break;
                switch (tag >>> 3) {
                case 1: {
                        message.isConnected = reader.bool();
                        break;
                    }
                default:
                    reader.skipType(tag & 7);
                    break;
                }
            }
            return message;
        };

        /**
         * Decodes a ConnectionStatus message from the specified reader or buffer, length delimited.
         * @function decodeDelimited
         * @memberof browser.ConnectionStatus
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @returns {browser.ConnectionStatus} ConnectionStatus
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        ConnectionStatus.decodeDelimited = function decodeDelimited(reader) {
            if (!(reader instanceof $Reader))
                reader = new $Reader(reader);
            return this.decode(reader, reader.uint32());
        };

        /**
         * Verifies a ConnectionStatus message.
         * @function verify
         * @memberof browser.ConnectionStatus
         * @static
         * @param {Object.<string,*>} message Plain object to verify
         * @returns {string|null} `null` if valid, otherwise the reason why it is not
         */
        ConnectionStatus.verify = function verify(message) {
            if (typeof message !== "object" || message === null)
                return "object expected";
            if (message.isConnected != null && message.hasOwnProperty("isConnected"))
                if (typeof message.isConnected !== "boolean")
                    return "isConnected: boolean expected";
            return null;
        };

        /**
         * Creates a ConnectionStatus message from a plain object. Also converts values to their respective internal types.
         * @function fromObject
         * @memberof browser.ConnectionStatus
         * @static
         * @param {Object.<string,*>} object Plain object
         * @returns {browser.ConnectionStatus} ConnectionStatus
         */
        ConnectionStatus.fromObject = function fromObject(object) {
            if (object instanceof $root.browser.ConnectionStatus)
                return object;
            let message = new $root.browser.ConnectionStatus();
            if (object.isConnected != null)
                message.isConnected = Boolean(object.isConnected);
            return message;
        };

        /**
         * Creates a plain object from a ConnectionStatus message. Also converts values to other types if specified.
         * @function toObject
         * @memberof browser.ConnectionStatus
         * @static
         * @param {browser.ConnectionStatus} message ConnectionStatus
         * @param {$protobuf.IConversionOptions} [options] Conversion options
         * @returns {Object.<string,*>} Plain object
         */
        ConnectionStatus.toObject = function toObject(message, options) {
            if (!options)
                options = {};
            let object = {};
            if (options.defaults)
                object.isConnected = false;
            if (message.isConnected != null && message.hasOwnProperty("isConnected"))
                object.isConnected = message.isConnected;
            return object;
        };

        /**
         * Converts this ConnectionStatus to JSON.
         * @function toJSON
         * @memberof browser.ConnectionStatus
         * @instance
         * @returns {Object.<string,*>} JSON object
         */
        ConnectionStatus.prototype.toJSON = function toJSON() {
            return this.constructor.toObject(this, $protobuf.util.toJSONOptions);
        };

        /**
         * Gets the default type url for ConnectionStatus
         * @function getTypeUrl
         * @memberof browser.ConnectionStatus
         * @static
         * @param {string} [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns {string} The default type url
         */
        ConnectionStatus.getTypeUrl = function getTypeUrl(typeUrlPrefix) {
            if (typeUrlPrefix === undefined) {
                typeUrlPrefix = "type.googleapis.com";
            }
            return typeUrlPrefix + "/browser.ConnectionStatus";
        };

        return ConnectionStatus;
    })();

    return browser;
})();

export { $root as default };
