/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

type UnionToIntersection<U> = (U extends unknown ? (k: U) => void : never) extends ((k: infer I) => void) ? I : never;
type ExtractObjectType<O extends object[]> = O extends Array<infer T> ? UnionToIntersection<T> : never;

export default function virtualMerge<O extends object[]>(...objects: O): ExtractObjectType<O> {
    const fallback: Record<string | symbol, unknown> = {};
    function findObjectByProp(prop: string | symbol): object {
        for (let i = objects.length - 1; i >= 0; i--) {
            const obj = objects[i];
            if (obj && prop in obj)
                return obj;
        }
        return fallback;
    }
    const handler: ProxyHandler<object> = {
        ownKeys() {
            return objects.reduce<Array<string | symbol>>((acc, obj) => {
                acc.push(...Reflect.ownKeys(obj));
                return acc;
            }, Reflect.ownKeys(fallback));
        },
        defineProperty(_, prop, descriptor) {
            return Reflect.defineProperty(findObjectByProp(prop), prop, descriptor);
        },
        deleteProperty(_, prop) {
            return Reflect.deleteProperty(findObjectByProp(prop), prop);
        },
        get(_, prop, receiver) {
            return Reflect.get(findObjectByProp(prop), prop, receiver);
        },
        getOwnPropertyDescriptor(_, prop) {
            return Reflect.getOwnPropertyDescriptor(findObjectByProp(prop), prop);
        },
        has(_, prop) {
            return Reflect.has(findObjectByProp(prop), prop);
        },
        set(_, prop, value, receiver) {
            return Reflect.set(findObjectByProp(prop), prop, value, receiver);
        }
    };
    return new Proxy(fallback, handler) as ExtractObjectType<O>;
}
