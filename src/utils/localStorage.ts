/*
 * Vencord, a modification for Discord's desktop app
 * Copyright (c) 2023 Vendicated and contributors
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

const memoryStorage: Record<string, string> = {};

const safeLocalStorage = {
    getItem(key: string): string | null {
        try {
            return window.localStorage?.getItem(key) ?? memoryStorage[key] ?? null;
        } catch {
            return memoryStorage[key] ?? null;
        }
    },
    setItem(key: string, value: string): void {
        try {
            window.localStorage?.setItem(key, value);
        } catch {
            // Fall back to memory storage
        }
        memoryStorage[key] = value;
    },
    removeItem(key: string): void {
        try {
            window.localStorage?.removeItem(key);
        } catch {
            // Fall back to memory storage
        }
        delete memoryStorage[key];
    },
    clear(): void {
        try {
            window.localStorage?.clear();
        } catch {
            // Fall back to memory storage
        }
        Object.keys(memoryStorage).forEach(key => delete memoryStorage[key]);
    },
    get length(): number {
        try {
            return window.localStorage?.length ?? Object.keys(memoryStorage).length;
        } catch {
            return Object.keys(memoryStorage).length;
        }
    },
    key(index: number): string | null {
        try {
            return window.localStorage?.key(index) ?? Object.keys(memoryStorage)[index] ?? null;
        } catch {
            return Object.keys(memoryStorage)[index] ?? null;
        }
    }
};

// Support for direct property access (e.g., localStorage.Vencord_settingsDirty)
const localStorageProxy = new Proxy(safeLocalStorage, {
    get(target, prop: string) {
        if (prop in target) {
            return (target as any)[prop];
        }
        return target.getItem(prop) ?? null;
    },
    set(target, prop: string, value: any) {
        target.setItem(prop, String(value));
        return true;
    },
    deleteProperty(target, prop: string) {
        target.removeItem(prop);
        return true;
    },
    has(target, prop: string) {
        return prop in target || target.getItem(prop) !== null;
    }
});

export const localStorage = localStorageProxy as Storage;
