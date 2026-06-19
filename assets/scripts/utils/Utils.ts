import { resources, Prefab, instantiate, Node } from "cc";

/**
 * 根据路径获取预制体节点
 * @param path 路径
 * @returns 预制体节点
 */
export function getPrefabNodeByPath(path: string): Node {
    const prefab = resources.get(path, Prefab)!;
    return instantiate(prefab);
};



