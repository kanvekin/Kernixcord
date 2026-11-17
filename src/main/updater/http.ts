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

import { fetchBuffer, fetchJson } from "@main/utils/http";
import { VENCORD_USER_AGENT } from "@shared/vencordUserAgent";
import { existsSync, mkdirSync, statSync, writeFileSync } from "original-fs";
import { join } from "path";

import gitHash from "~git-hash";
import gitRemote from "~git-remote";

import { Updater } from ".";
import { ASAR_FILE } from "./common";

const API_BASE = `https://api.github.com/repos/${gitRemote}`;
let PendingUpdate: string | null = null;

async function githubGet<T = any>(endpoint: string) {
    return fetchJson<T>(API_BASE + endpoint, {
        headers: {
            Accept: "application/vnd.github+json",
            // "All API requests MUST include a valid User-Agent header.
            // Requests with no User-Agent header will be rejected."
            "User-Agent": VENCORD_USER_AGENT
        }
    });
}

async function listUpdates() {
    const isOutdated = await fetchUpdate();
    if (!isOutdated) return [];

    const data = await githubGet(`/compare/${gitHash}...HEAD`);

    return data.commits.map((c: any) => ({
        hash: c.sha,
        author: c.author?.login ?? c.commit?.author?.name ?? "Unknown Author",
        message: c.commit.message.split("\n")[0]
    }));
}

async function fetchUpdate() {
    const data = await githubGet("/releases/latest");

    const hash = data.name.slice(data.name.lastIndexOf(" ") + 1);
    if (hash === gitHash)
        return false;

    const asset = data.assets.find(a => a.name === ASAR_FILE);
    if (!asset) return false;
    PendingUpdate = asset.browser_download_url;

    return true;
}

function extractAsar(buffer: Buffer, targetDir: string) {
    const headerSize = buffer.readUInt32LE(4);
    const strLen = buffer.readUInt32LE(12);
    const jsonStr = buffer.subarray(16, 16 + strLen).toString("utf8");
    const { files } = JSON.parse(jsonStr);
    const dataStart = 8 + headerSize;

    function extractEntry(dir: string, entries: Record<string, any>) {
        for (const [name, entry] of Object.entries(entries)) {
            const entryPath = join(dir, name);
            if (entry.files) {
                if (!existsSync(entryPath)) mkdirSync(entryPath, { recursive: true });
                extractEntry(entryPath, entry.files);
            } else if (typeof entry.offset === "string" && typeof entry.size === "number") {
                const offset = parseInt(entry.offset, 10);
                const fileBuf = buffer.subarray(dataStart + offset, dataStart + offset + entry.size);
                writeFileSync(entryPath, fileBuf, { flush: true });
            }
        }
    }

    extractEntry(targetDir, files);
}

async function applyUpdate() {
    if (!PendingUpdate) return true;

    const data = await fetchBuffer(PendingUpdate);

    let isDirectory = false;
    try {
        isDirectory = statSync(__dirname).isDirectory();
    } catch {}

    if (isDirectory) {
        extractAsar(data, __dirname);
        const parentAsar = join(__dirname, "..", ASAR_FILE);
        if (existsSync(parentAsar)) {
            try {
                writeFileSync(parentAsar, data, { flush: true });
            } catch (err) {
                console.error("[Kernixcord] Failed to update parent asar", err);
            }
        }
    } else {
        writeFileSync(__dirname, data, { flush: true });
    }

    PendingUpdate = null;

    return true;
}

const HttpUpdater: Updater = {
    getRepo: async () => `https://github.com/${gitRemote}`,
    listUpdates,
    fetchUpdate,
    applyUpdate
};

export default HttpUpdater;
