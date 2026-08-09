/*
 * Vencord, a modification for Discord's desktop app
 * Copyright (c) 2022 Vendicated and contributors
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

import { debounce } from "@shared/debounce";
import { IpcEvents } from "@shared/IpcEvents";
import { contextBridge, webFrame } from "electron/renderer";

import VencordNative, { invoke, sendSync } from "./VencordNative";

contextBridge.exposeInMainWorld("VencordNative", VencordNative);

// Discord
if (location.protocol !== "data:") {
    invoke(IpcEvents.INIT_FILE_WATCHERS);

    if (IS_DISCORD_DESKTOP) {
        const rendererJs = sendSync<string>(IpcEvents.PRELOAD_GET_RENDERER_JS);
        if (rendererJs) {
            webFrame.executeJavaScript(rendererJs);
        } else {
            console.error("[Kernixcord] Failed to load renderer JS from preload");
        }

        // Not supported in sandboxed preload scripts but Discord doesn't support it either so who cares
        const originalPreload = process.env.DISCORD_PRELOAD;
        if (typeof originalPreload === "string" && originalPreload.length > 0) {
            try {
                require(originalPreload);
            } catch (err) {
                console.error("[Kernixcord] Failed to require original Discord preload", err);
            }
        } else {
            console.warn("[Kernixcord] DISCORD_PRELOAD is missing or invalid");
        }
    }
} // Monaco popout
else {
    contextBridge.exposeInMainWorld("setCss", debounce(VencordNative.quickCss.set));
    contextBridge.exposeInMainWorld("getCurrentCss", VencordNative.quickCss.get);
    contextBridge.exposeInMainWorld("getTheme", VencordNative.quickCss.getEditorTheme);
}
