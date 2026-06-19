import { Broadcast} from "@ailhc/broadcast";

declare global {
    /**
     * 广播消息类型key
     */
    interface IBroadCastKey extends broadcast.IMsgKey {

    }
    /**
     * 广播消息类型value
     */
    interface IBroadCastValueType extends broadcast.IMsgValueType {

    }
    /**
     * 广播消息类型result
     */
    interface IBroadCastResultType extends broadcast.IResultType {
        
    }
};

