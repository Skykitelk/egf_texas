import { Broadcast } from "@ailhc/broadcast";

/**
 * 广播管理器
 */
export class BroadCastMgr implements egf.IModule {

    key = "broadCastMgr";

    private broadCastMap = new Map<string, Broadcast<IBroadCastKey, IBroadCastValueType, IBroadCastResultType>>();

    onInit(): void {
        console.log("BroadCastMgr onInit");
    };

    onStop(): void {
        console.log("BroadCastMgr onStop");
        const keys = [...this.broadCastMap.keys()];
        for (const key of keys) {
            this.destroyBroadCast(key);
        };   
        this.broadCastMap.clear();
    };

    /**
     * 创建广播实例
     * @param key 广播key
     * @returns 广播实例
     */
    createBroadCast(key: string): Broadcast<IBroadCastKey, IBroadCastValueType, IBroadCastResultType> {
        const broadCast = new Broadcast<IBroadCastKey, IBroadCastValueType, IBroadCastResultType>();
        if (this.broadCastMap.has(key)) {
            this.destroyBroadCast(key);
        }
        this.broadCastMap.set(key, broadCast);
        return broadCast;
    };

    /**
     * 获取广播实例
     * @param key 广播key
     * @returns 广播实例
     */
    getBroadCast(key: string): Broadcast<IBroadCastKey, IBroadCastValueType, IBroadCastResultType> {
        return this.broadCastMap.get(key);
    };

    /**
     * 销毁广播实例
     * @param key 广播key
     */
    destroyBroadCast(key: string): void {
        let broadCast = this.getBroadCast(key);
        if (broadCast) {
            broadCast.dispose();
            this.broadCastMap.delete(key);
            broadCast = null;
        };
    };
};

