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

import { IpcEvents } from "@shared/IpcEvents";
import { execFile as cpExecFile } from "child_process";
import { ipcMain } from "electron";
import { join } from "path";
import { promisify } from "util";

import { serializeErrors } from "./common";

const VENCORD_SRC_DIR = join(__dirname, "..");
const KERNIXCORD_DIR = join(__dirname, "../../");

const execFile = promisify(cpExecFile);

const isFlatpak = process.platform === "linux" && !!process.env.FLATPAK_ID;

if (process.platform === "darwin") process.env.PATH = `/usr/local/bin:${process.env.PATH}`;

function git(...args: string[]) {
    const opts = { cwd: KERNIXCORD_DIR };

    if (isFlatpak) return execFile("flatpak-spawn", ["--host", "git", ...args], opts);
    else return execFile("git", args, opts);
}

async function getRepo() {
    try {
        const res = await git("remote", "get-url", "origin");
        return res.stdout.trim()
            .replace(/git@(.+):/, "https://$1/")
            .replace(/\.git$/, "");
    } catch (err: any) {
        const error = err as { stderr?: string; stdout?: string; message?: string; code?: string; };
        throw new Error(`Failed to get git remote: ${error.message || error.stderr || error.stdout || error.code || "Unknown error"}`);
    }
}

async function calculateGitChanges() {
    try {
        await git("fetch");

        const branch = (await git("branch", "--show-current")).stdout.trim();

        const existsOnOrigin = (await git("ls-remote", "origin", branch)).stdout.length > 0;
        if (!existsOnOrigin) return [];

        const res = await git("log", `HEAD...origin/${branch}`, "--pretty=format:%an/%h/%s");

        const commits = res.stdout.trim();
        return commits ? commits.split("\n").map(line => {
            const [author, hash, ...rest] = line.split("/");
            return {
                hash, author,
                message: rest.join("/").split("\n")[0]
            };
        }) : [];
    } catch (err: any) {
        const error = err as { stderr?: string; stdout?: string; message?: string; code?: string; };
        throw new Error(`Failed to calculate git changes: ${error.message || error.stderr || error.stdout || error.code || "Unknown error"}`);
    }
}

async function pull() {
    const res = await git("pull");
    return res.stdout.includes("Fast-forward");
}

async function build() {
    const opts = { cwd: KERNIXCORD_DIR };

    const command = isFlatpak ? "flatpak-spawn" : "node";
    const args = isFlatpak ? ["--host", "node", "scripts/build/build.mjs"] : ["scripts/build/build.mjs"];

    if (IS_DEV) args.push("--dev");

    const res = await execFile(command, args, opts);

    if (!res.stderr.includes("Build failed")) {
        // After successful build, re-inject to update Discord with new files
        console.log("[Kernixcord Updater] Build completed, re-injecting...");
        try {
            const injectArgs = isFlatpak ? ["--host", "node", "scripts/runInstaller.mjs", "--", "--install"] : ["scripts/runInstaller.mjs", "--", "--install"];
            await execFile(isFlatpak ? "flatpak-spawn" : "node", injectArgs, opts);
            console.log("[Kernixcord Updater] Re-injection completed successfully");
        } catch (injectErr) {
            console.error("[Kernixcord Updater] Re-injection failed:", injectErr);
            // Don't fail the build if injection fails, user can manually inject
        }
    }

    return !res.stderr.includes("Build failed");
}

ipcMain.handle(IpcEvents.GET_REPO, serializeErrors(getRepo));
ipcMain.handle(IpcEvents.GET_UPDATES, serializeErrors(calculateGitChanges));
ipcMain.handle(IpcEvents.UPDATE, serializeErrors(pull));
ipcMain.handle(IpcEvents.BUILD, serializeErrors(build));
