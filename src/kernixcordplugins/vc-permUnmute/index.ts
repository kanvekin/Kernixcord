/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import definePlugin from "@utils/types";
import { Devs } from "@utils/constants";
import { findByPropsLazy } from "@webpack";
import {
    ChannelStore,
    Menu,
    PermissionsBits,
    PermissionStore,
    React,
    RestAPI,
    SelectedChannelStore,
    Toasts,
    UserStore,
    VoiceStateStore
} from "@webpack/common";

interface UserSettings {
    unmute: boolean;
    undeafen: boolean;
    rejoinOnDisconnect: boolean;
}

interface ManagedUserEntry extends UserSettings {
    guildId: string;
}

const managedUsers = new Map<string, ManagedUserEntry>();

/** Last voice channel for self rejoin. */
let lastChannelIdSelf: string | null = null;
let rejoinTimeout: number | null = null;

const ChannelActions = findByPropsLazy("selectVoiceChannel", "disconnect");

function makeKey(guildId: string, userId: string) {
    return `${guildId}:${userId}`;
}

function showToast(message: string, type = Toasts.Type.SUCCESS) {
    Toasts.show({
        message,
        id: Toasts.genId(),
        type
    });
}

function getUserSettings(guildId: string, userId: string): ManagedUserEntry {
    const key = makeKey(guildId, userId);

    if (!managedUsers.has(key)) {
        managedUsers.set(key, {
            guildId,
            unmute: false,
            undeafen: false,
            rejoinOnDisconnect: false
        });
    }

    return managedUsers.get(key)!;
}

function setUserSettings(guildId: string, userId: string, settings: UserSettings) {
    const key = makeKey(guildId, userId);

    if (!settings.unmute && !settings.undeafen && !settings.rejoinOnDisconnect) {
        managedUsers.delete(key);
        return;
    }

    managedUsers.set(key, {
        guildId,
        ...settings
    });
}

function clearUserSettings(guildId: string, userId: string) {
    managedUsers.delete(makeKey(guildId, userId));
}

function getUsersWithPermanentOperations(guildId?: string) {
    const users: Array<{ userId: string; guildId: string; settings: ManagedUserEntry; }> = [];

    for (const [key, settings] of managedUsers.entries()) {
        if (!settings.unmute && !settings.undeafen && !settings.rejoinOnDisconnect) continue;
        if (guildId && settings.guildId !== guildId) continue;

        const [, userId] = key.split(":");
        users.push({
            userId,
            guildId: settings.guildId,
            settings
        });
    }

    return users;
}

function getUserDisplayName(userId: string): string {
    const user = UserStore.getUser(userId);
    if (!user) return `Unknown User (${userId})`;

    return user.globalName || user.username || `User ${userId}`;
}

function getGuildIdFromChannel(channelId: string): string | undefined {
    const channel = ChannelStore.getChannel(channelId);
    if (!channel) return undefined;

    return (channel as any).guild_id ?? (channel as any).guildId ?? undefined;
}

function getRelevantGuildId(channelId?: string, oldChannelId?: string) {
    return (channelId && getGuildIdFromChannel(channelId))
        || (oldChannelId && getGuildIdFromChannel(oldChannelId))
        || undefined;
}

async function muteGuildMember(guildId: string, userId: string, mute: boolean) {
    try {
        const response = await RestAPI.patch({
            url: `/guilds/${guildId}/members/${userId}`,
            body: { mute }
        });

        return response.ok !== false;
    } catch {
        return false;
    }
}

async function deafenGuildMember(guildId: string, userId: string, deaf: boolean) {
    try {
        const response = await RestAPI.patch({
            url: `/guilds/${guildId}/members/${userId}`,
            body: { deaf }
        });

        return response.ok !== false;
    } catch {
        return false;
    }
}

function joinVoiceChannel(channelId: string) {
    try {
        ChannelActions.selectVoiceChannel(channelId);
        return true;
    } catch {
        return false;
    }
}

function scheduleRejoin(channelId: string) {
    if (rejoinTimeout) {
        clearTimeout(rejoinTimeout);
    }

    rejoinTimeout = window.setTimeout(() => {
        rejoinTimeout = null;

        if (SelectedChannelStore.getVoiceChannelId()) return;
        joinVoiceChannel(channelId);
    }, 500);
}

function clearUserPermanentOperations(guildId: string, userId: string) {
    clearUserSettings(guildId, userId);

    const currentUser = UserStore.getCurrentUser();
    if (currentUser && userId === currentUser.id) {
        lastChannelIdSelf = null;

        if (rejoinTimeout) {
            clearTimeout(rejoinTimeout);
            rejoinTimeout = null;
        }
    }

    showToast(`Cleared permanent controls for ${getUserDisplayName(userId)}`);
}

interface UserContextProps {
    user: any;
    guildId?: string;
}

const UserContext: NavContextMenuPatchCallback = (children, { user, guildId }: UserContextProps) => {
    const currentUser = UserStore.getCurrentUser();
    if (!user || !currentUser || !guildId) return;

    const isSelf = user.id === currentUser.id;
    const settings = getUserSettings(guildId, user.id);
    const usersWithOperations = getUsersWithPermanentOperations(guildId);

    const toggleSetting = async (kind: keyof UserSettings) => {
        const newSettings: UserSettings = {
            unmute: settings.unmute,
            undeafen: settings.undeafen,
            rejoinOnDisconnect: settings.rejoinOnDisconnect,
            [kind]: !settings[kind]
        };

        setUserSettings(guildId, user.id, newSettings);

        const vs = VoiceStateStore.getVoiceStateForUser(user.id);
        const activeGuildId = vs?.channelId ? getGuildIdFromChannel(vs.channelId) ?? guildId : guildId;

        if (kind === "unmute") {
            if (newSettings.unmute) {
                if (vs?.channelId && vs.mute) {
                    await muteGuildMember(activeGuildId, user.id, false);
                }
                showToast(`Permanent unmute enabled for ${getUserDisplayName(user.id)}`);
            } else {
                showToast(`Permanent unmute disabled for ${getUserDisplayName(user.id)}`);
            }
        }

        if (kind === "undeafen") {
            if (newSettings.undeafen) {
                if (vs?.channelId && vs.deaf) {
                    await deafenGuildMember(activeGuildId, user.id, false);
                }
                showToast(`Permanent undeafen enabled for ${getUserDisplayName(user.id)}`);
            } else {
                showToast(`Permanent undeafen disabled for ${getUserDisplayName(user.id)}`);
            }
        }

        if (kind === "rejoinOnDisconnect") {
            if (newSettings.rejoinOnDisconnect) {
                if (vs?.channelId) {
                    lastChannelIdSelf = vs.channelId;
                }
                showToast("Rejoin on disconnect enabled");
            } else {
                lastChannelIdSelf = null;

                if (rejoinTimeout) {
                    clearTimeout(rejoinTimeout);
                    rejoinTimeout = null;
                }

                showToast("Rejoin on disconnect disabled");
            }
        }
    };

    const menuItems: any[] = [
        React.createElement(Menu.MenuItem, {
            id: "perm-unmute-header",
            label: "Permanent Unmute Controls",
            disabled: true,
            key: "perm-unmute-header"
        }),
        React.createElement(Menu.MenuCheckboxItem, {
            id: "perm-unmute",
            label: "Permanent Unmute",
            checked: settings.unmute,
            action: () => void toggleSetting("unmute"),
            key: "perm-unmute"
        }),
        React.createElement(Menu.MenuCheckboxItem, {
            id: "perm-undeafen",
            label: "Permanent Undeafen",
            checked: settings.undeafen,
            action: () => void toggleSetting("undeafen"),
            key: "perm-undeafen"
        })
    ];

    if (isSelf) {
        menuItems.push(
            React.createElement(Menu.MenuCheckboxItem, {
                id: "perm-rejoin-disconnect",
                label: "Rejoin on Disconnect",
                checked: settings.rejoinOnDisconnect,
                action: () => void toggleSetting("rejoinOnDisconnect"),
                key: "perm-rejoin-disconnect"
            })
        );
    }

    if (usersWithOperations.length > 0) {
        menuItems.push(
            React.createElement(Menu.MenuSeparator, { key: "perm-unmute-list-sep" }),
            React.createElement(
                Menu.MenuItem,
                {
                    id: "perm-unmute-managed-users",
                    label: `Managed Users (${usersWithOperations.length})`,
                    key: "perm-unmute-managed-header"
                },
                usersWithOperations.map(({ userId, guildId: trackedGuildId, settings: s }) => {
                    const displayName = getUserDisplayName(userId);
                    const ops: string[] = [];

                    if (s.unmute) ops.push("Unmute");
                    if (s.undeafen) ops.push("Undeafen");
                    if (s.rejoinOnDisconnect) ops.push("Rejoin");

                    return React.createElement(Menu.MenuItem, {
                        id: `perm-unmute-clear-${userId}`,
                        key: `perm-unmute-clear-${trackedGuildId}-${userId}`,
                        label: `${displayName} (${ops.join(", ")})`,
                        action: () => clearUserPermanentOperations(trackedGuildId, userId)
                    });
                })
            )
        );
    }

    children.splice(-1, 0,
        React.createElement(Menu.MenuGroup, {
            key: "perm-unmute-controls-group"
        }, menuItems)
    );
};

export default definePlugin({
    name: "PermanentUnmute",
    description: "Continuously unmute/undeafen against forced mute/deafen, with optional self rejoin on disconnect.",
    authors: [Devs.feelslove],

    flux: {
        VOICE_STATE_UPDATES({ voiceStates }: { voiceStates: any[]; }) {
            try {
                const currentUser = UserStore.getCurrentUser();
                if (!currentUser) return;

                const selfId = currentUser.id;

                for (const { userId, channelId, oldChannelId, mute, deaf } of voiceStates) {
                    const guildId = getRelevantGuildId(channelId, oldChannelId);
                    if (!guildId) continue;

                    const settings = managedUsers.get(makeKey(guildId, userId));
                    if (!settings) continue;
                    if (!settings.unmute && !settings.undeafen && !settings.rejoinOnDisconnect) continue;

                    if (userId === selfId && settings.rejoinOnDisconnect) {
                        if (channelId) {
                            lastChannelIdSelf = channelId;
                        } else if (oldChannelId && !channelId) {
                            const channelToRejoin = lastChannelIdSelf || oldChannelId;
                            if (channelToRejoin) {
                                scheduleRejoin(channelToRejoin);
                            }
                        }
                    }

                    if (!channelId) continue;

                    const channel = ChannelStore.getChannel(channelId);
                    if (!channel) continue;

                    const canMute = PermissionStore.can(PermissionsBits.MUTE_MEMBERS, channel);
                    const canDeafen = PermissionStore.can(PermissionsBits.DEAFEN_MEMBERS, channel);

                    if (settings.unmute && canMute && mute) {
                        void muteGuildMember(guildId, userId, false);
                    }

                    if (settings.undeafen && canDeafen && deaf) {
                        void deafenGuildMember(guildId, userId, false);
                    }
                }
            } catch (error) {
                console.error("PermanentUnmute: VOICE_STATE_UPDATES error:", error);
            }
        }
    },

    contextMenus: {
        "user-context": UserContext
    },

    stop() {
        if (rejoinTimeout) {
            clearTimeout(rejoinTimeout);
            rejoinTimeout = null;
        }
    }
});