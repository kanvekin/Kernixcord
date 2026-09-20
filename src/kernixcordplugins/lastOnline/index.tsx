/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";
import { User } from "@vencord/discord-types";
import { moment, React } from "@webpack/common";
import * as DataStore from "@api/DataStore";

interface PresenceStatus {
    hasBeenOnline: boolean;
    lastOffline: number | null;
}

let recentlyOnlineList: Map<string, PresenceStatus> = new Map();

async function loadData() {
    const data = await DataStore.get<Record<string, PresenceStatus>>("LastOnlineData");
    if (data) {
        recentlyOnlineList = new Map(Object.entries(data));
    }
}

function saveData() {
    DataStore.set("LastOnlineData", Object.fromEntries(recentlyOnlineList));
}

function handlePresenceUpdate(status: string, userId: string) {
    if (recentlyOnlineList.has(userId)) {
        const presenceStatus = recentlyOnlineList.get(userId)!;
        if (status !== "offline") {
            presenceStatus.hasBeenOnline = true;
            presenceStatus.lastOffline = null;
        } else if (presenceStatus.hasBeenOnline && presenceStatus.lastOffline == null) {
            presenceStatus.lastOffline = Date.now();
            saveData();
        }
    } else {
        recentlyOnlineList.set(userId, {
            hasBeenOnline: status !== "offline",
            lastOffline: status === "offline" ? Date.now() : null
        });
        saveData();
    }
}

function formatTime(time: number) {
    const diff = moment.duration(moment().diff(time));
    const d = Math.floor(diff.asDays());
    const h = Math.floor(diff.asHours());
    const m = Math.floor(diff.asMinutes());

    if (d > 0) return `${d}d`;
    if (h > 0) return `${h}h`;
    if (m > 0) return `${m}m`;
    return "1m";
}

export default definePlugin({
    name: "LastOnline",
    description: "Adds a last online indicator under usernames in your DM list and guild and GDM member list",
    authors: [Devs.feelslove],
    dependencies: ["MemberListDecoratorsAPI"],
    start() {
        loadData();
    },
    flux: {
        PRESENCE_UPDATES({ updates }) {
            updates.forEach(update => {
                handlePresenceUpdate(update.status, update.user.id);
            });
        }
    },
    renderMemberListDecorator({ user }) {
        if (!user || recentlyOnlineList.get(user.id)?.hasBeenOnline !== true) return null;
        
        const presenceStatus = recentlyOnlineList.get(user.id);
        if (!presenceStatus || presenceStatus.lastOffline === null) return null;

        const formattedTime = formatTime(presenceStatus.lastOffline);
        return (
            <span style={{ fontSize: "12px", color: "var(--text-muted)", marginLeft: "6px" }}>
                Last seen {formattedTime} ago
            </span>
        );
    }
});
