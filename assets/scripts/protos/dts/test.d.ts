type Long = protobuf.Long;
// DO NOT EDIT! This is a generated file. Edit the JSDoc in src/*.js instead and run 'npm run types'.

/** Properties of a Topic. */
export interface ITopic {

    /** Topic moudleType */
    moudleType?: (string|null);

    /** Topic handler */
    handler?: (string|null);

    /** Topic msgId */
    msgId?: (number|null);
}

/** Represents a Topic. */
export class Topic implements ITopic {

    /**
     * Constructs a new Topic.
     * @param [properties] Properties to set
     */
    constructor(properties?: ITopic);

    /** Topic moudleType. */
    public moudleType: string;

    /** Topic handler. */
    public handler: string;

    /** Topic msgId. */
    public msgId: number;

    /**
     * Creates a new Topic instance using the specified properties.
     * @param [properties] Properties to set
     * @returns Topic instance
     */
    public static create(properties?: ITopic): Topic;

    /**
     * Encodes the specified Topic message. Does not implicitly {@link Topic.verify|verify} messages.
     * @param message Topic message or plain object to encode
     * @param [writer] Writer to encode to
     * @returns Writer
     */
    public static encode(message: ITopic, writer?: protobuf.Writer): protobuf.Writer;

    /**
     * Encodes the specified Topic message, length delimited. Does not implicitly {@link Topic.verify|verify} messages.
     * @param message Topic message or plain object to encode
     * @param [writer] Writer to encode to
     * @returns Writer
     */
    public static encodeDelimited(message: ITopic, writer?: protobuf.Writer): protobuf.Writer;

    /**
     * Decodes a Topic message from the specified reader or buffer.
     * @param reader Reader or buffer to decode from
     * @param [length] Message length if known beforehand
     * @returns Topic
     * @throws {Error} If the payload is not a reader or valid buffer
     * @throws {protobuf.util.ProtocolError} If required fields are missing
     */
    public static decode(reader: (protobuf.Reader|Uint8Array), length?: number): Topic;

    /**
     * Decodes a Topic message from the specified reader or buffer, length delimited.
     * @param reader Reader or buffer to decode from
     * @returns Topic
     * @throws {Error} If the payload is not a reader or valid buffer
     * @throws {protobuf.util.ProtocolError} If required fields are missing
     */
    public static decodeDelimited(reader: (protobuf.Reader|Uint8Array)): Topic;

    /**
     * Verifies a Topic message.
     * @param message Plain object to verify
     * @returns `null` if valid, otherwise the reason why it is not
     */
    public static verify(message: { [k: string]: any }): (string|null);
}
