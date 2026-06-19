 (function(global){global.$protobuf = global.protobuf;
$protobuf.roots.default=global;})(typeof window !== "undefined" && window|| typeof global !== "undefined" && global|| typeof self   !== "undefined" && self|| this)
// Common aliases
var $Reader = $protobuf.Reader, $Writer = $protobuf.Writer, $util = $protobuf.util;

// Exported root namespace
var $root = $protobuf.roots["default"] || ($protobuf.roots["default"] = {});

$root.Topic = (function() {

    /**
     * Properties of a Topic.
     * @exports ITopic
     * @interface ITopic
     * @property {string|null} [moudleType] Topic moudleType
     * @property {string|null} [handler] Topic handler
     * @property {number|null} [msgId] Topic msgId
     */

    /**
     * Constructs a new Topic.
     * @exports Topic
     * @classdesc Represents a Topic.
     * @implements ITopic
     * @constructor
     * @param {ITopic=} [properties] Properties to set
     */
    function Topic(properties) {
        if (properties)
            for (var keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                if (properties[keys[i]] != null)
                    this[keys[i]] = properties[keys[i]];
    }

    /**
     * Topic moudleType.
     * @member {string} moudleType
     * @memberof Topic
     * @instance
     */
    Topic.prototype.moudleType = "";

    /**
     * Topic handler.
     * @member {string} handler
     * @memberof Topic
     * @instance
     */
    Topic.prototype.handler = "";

    /**
     * Topic msgId.
     * @member {number} msgId
     * @memberof Topic
     * @instance
     */
    Topic.prototype.msgId = 0;

    /**
     * Creates a new Topic instance using the specified properties.
     * @function create
     * @memberof Topic
     * @static
     * @param {ITopic=} [properties] Properties to set
     * @returns {Topic} Topic instance
     */
    Topic.create = function create(properties) {
        return new Topic(properties);
    };

    /**
     * Encodes the specified Topic message. Does not implicitly {@link Topic.verify|verify} messages.
     * @function encode
     * @memberof Topic
     * @static
     * @param {ITopic} message Topic message or plain object to encode
     * @param {$protobuf.Writer} [writer] Writer to encode to
     * @returns {$protobuf.Writer} Writer
     */
    Topic.encode = function encode(message, writer) {
        if (!writer)
            writer = $Writer.create();
        if (message.moudleType != null && message.hasOwnProperty("moudleType"))
            writer.uint32(/* id 1, wireType 2 =*/10).string(message.moudleType);
        if (message.handler != null && message.hasOwnProperty("handler"))
            writer.uint32(/* id 2, wireType 2 =*/18).string(message.handler);
        if (message.msgId != null && message.hasOwnProperty("msgId"))
            writer.uint32(/* id 3, wireType 0 =*/24).uint32(message.msgId);
        return writer;
    };

    /**
     * Encodes the specified Topic message, length delimited. Does not implicitly {@link Topic.verify|verify} messages.
     * @function encodeDelimited
     * @memberof Topic
     * @static
     * @param {ITopic} message Topic message or plain object to encode
     * @param {$protobuf.Writer} [writer] Writer to encode to
     * @returns {$protobuf.Writer} Writer
     */
    Topic.encodeDelimited = function encodeDelimited(message, writer) {
        return this.encode(message, writer).ldelim();
    };

    /**
     * Decodes a Topic message from the specified reader or buffer.
     * @function decode
     * @memberof Topic
     * @static
     * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
     * @param {number} [length] Message length if known beforehand
     * @returns {Topic} Topic
     * @throws {Error} If the payload is not a reader or valid buffer
     * @throws {$protobuf.util.ProtocolError} If required fields are missing
     */
    Topic.decode = function decode(reader, length) {
        if (!(reader instanceof $Reader))
            reader = $Reader.create(reader);
        var end = length === undefined ? reader.len : reader.pos + length, message = new $root.Topic();
        while (reader.pos < end) {
            var tag = reader.uint32();
            switch (tag >>> 3) {
            case 1:
                message.moudleType = reader.string();
                break;
            case 2:
                message.handler = reader.string();
                break;
            case 3:
                message.msgId = reader.uint32();
                break;
            default:
                reader.skipType(tag & 7);
                break;
            }
        }
        return message;
    };

    /**
     * Decodes a Topic message from the specified reader or buffer, length delimited.
     * @function decodeDelimited
     * @memberof Topic
     * @static
     * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
     * @returns {Topic} Topic
     * @throws {Error} If the payload is not a reader or valid buffer
     * @throws {$protobuf.util.ProtocolError} If required fields are missing
     */
    Topic.decodeDelimited = function decodeDelimited(reader) {
        if (!(reader instanceof $Reader))
            reader = new $Reader(reader);
        return this.decode(reader, reader.uint32());
    };

    /**
     * Verifies a Topic message.
     * @function verify
     * @memberof Topic
     * @static
     * @param {Object.<string,*>} message Plain object to verify
     * @returns {string|null} `null` if valid, otherwise the reason why it is not
     */
    Topic.verify = function verify(message) {
        if (typeof message !== "object" || message === null)
            return "object expected";
        if (message.moudleType != null && message.hasOwnProperty("moudleType"))
            if (!$util.isString(message.moudleType))
                return "moudleType: string expected";
        if (message.handler != null && message.hasOwnProperty("handler"))
            if (!$util.isString(message.handler))
                return "handler: string expected";
        if (message.msgId != null && message.hasOwnProperty("msgId"))
            if (!$util.isInteger(message.msgId))
                return "msgId: integer expected";
        return null;
    };

    return Topic;
})();