/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";
import {
    ChannelStore,
    Menu,
    PermissionsBits,
    PermissionStore,
    React,
    RestAPI,
    Toasts,
    UserStore,
    VoiceStateStore
} from "@webpack/common";

interface UserSettings {
    mute: boolean;
    deaf: boolean;
    disconnect: boolean;
}

interface ManagedUserEntry extends UserSettings {
    guildId: string;
}

const managedUsers = new Map<string, ManagedUserEntry>();

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
            mute: false,
            deaf: false,
            disconnect: false
        });
    }

    return managedUsers.get(key)!;
}

function setUserSettings(guildId: string, userId: string, settings: UserSettings) {
    const key = makeKey(guildId, userId);

    if (!settings.mute && !settings.deaf && !settings.disconnect) {
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
        if (!settings.mute && !settings.deaf && !settings.disconnect) continue;
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

async function disconnectGuildMember(guildId: string, userId: string) {
    try {
        const response = await RestAPI.patch({
            url: `/guilds/${guildId}/members/${userId}`,
            body: { channel_id: null }
        });

        return response.ok !== false;
    } catch {
        return false;
    }
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

function getGuildIdFromChannel(channelId: string): string | undefined {
    const channel = ChannelStore.getChannel(channelId);
    if (!channel) return undefined;

    return (channel as any).guild_id ?? (channel as any).guildId ?? undefined;
}

async function clearUserPermanentOperations(guildId: string, userId: string) {
    const settings = managedUsers.get(makeKey(guildId, userId));
    if (!settings) return;

    const voiceState = VoiceStateStore.getVoiceStateForUser(userId);
    const activeGuildId = voiceState?.channelId
        ? getGuildIdFromChannel(voiceState.channelId) ?? guildId
        : guildId;

    if (settings.mute) {
        await muteGuildMember(activeGuildId, userId, false);
    }

    if (settings.deaf) {
        await deafenGuildMember(activeGuildId, userId, false);
    }

    clearUserSettings(guildId, userId);
    showToast(`Cleared permanent voice controls for ${getUserDisplayName(userId)}`);
}

function getUserDisplayName(userId: string): string {
    const user = UserStore.getUser(userId);
    if (!user) return `Unknown User (${userId})`;

    return user.globalName || user.username || `User ${userId}`;
}

interface UserContextProps {
    user: any;
    guildId?: string;
}

const UserContext: NavContextMenuPatchCallback = (children, { user, guildId }: UserContextProps) => {
    const currentUser = UserStore.getCurrentUser();
    if (!user || !currentUser || user.id === currentUser.id) return;
    if (!guildId) return;

    const settings = getUserSettings(guildId, user.id);
    const usersWithOperations = getUsersWithPermanentOperations(guildId);

    const toggleSetting = async (kind: keyof UserSettings) => {
        const newSettings: UserSettings = {
            mute: settings.mute,
            deaf: settings.deaf,
            disconnect: settings.disconnect,
            [kind]: !settings[kind]
        };

        setUserSettings(guildId, user.id, newSettings);

        const channelId = VoiceStateStore.getVoiceStateForUser(user.id)?.channelId;
        const activeGuildId = channelId ? getGuildIdFromChannel(channelId) ?? guildId : guildId;

        if (kind === "mute") {
            if (newSettings.mute) {
                if (channelId) await muteGuildMember(activeGuildId, user.id, true);
                showToast(`Permanent mute enabled for ${getUserDisplayName(user.id)}`);
            } else {
                await muteGuildMember(activeGuildId, user.id, false);
                showToast(`Permanent mute disabled for ${getUserDisplayName(user.id)}`);
            }
        }

        if (kind === "deaf") {
            if (newSettings.deaf) {
                if (channelId) await deafenGuildMember(activeGuildId, user.id, true);
                showToast(`Permanent deaf enabled for ${getUserDisplayName(user.id)}`);
            } else {
                await deafenGuildMember(activeGuildId, user.id, false);
                showToast(`Permanent deaf disabled for ${getUserDisplayName(user.id)}`);
            }
        }

        if (kind === "disconnect") {
            if (newSettings.disconnect) {
                if (channelId) await disconnectGuildMember(activeGuildId, user.id);
                showToast(`Permanent disconnect enabled for ${getUserDisplayName(user.id)}`);
            } else {
                showToast(`Permanent disconnect disabled for ${getUserDisplayName(user.id)}`);
            }
        }
    };

    const menuItems: any[] = [
        React.createElement(Menu.MenuItem, {
            id: "perm-voice-controls-header",
            label: "Permanent Voice Controls",
            disabled: true,
            key: "perm-voice-controls-header"
        }),
        React.createElement(Menu.MenuCheckboxItem, {
            id: "perm-mute",
            label: "Permanent Mute",
            checked: settings.mute,
            action: () => void toggleSetting("mute"),
            key: "perm-mute"
        }),
        React.createElement(Menu.MenuCheckboxItem, {
            id: "perm-deaf",
            label: "Permanent Deaf",
            checked: settings.deaf,
            action: () => void toggleSetting("deaf"),
            key: "perm-deaf"
        }),
        React.createElement(Menu.MenuCheckboxItem, {
            id: "perm-disconnect",
            label: "Permanent Disconnect",
            checked: settings.disconnect,
            action: () => void toggleSetting("disconnect"),
            key: "perm-disconnect"
        })
    ];

    if (usersWithOperations.length > 0) {
        menuItems.push(
            React.createElement(Menu.MenuSeparator, { key: "perm-list-separator" }),
            React.createElement(
                Menu.MenuItem,
                {
                    id: "perm-managed-users",
                    label: `Managed Users (${usersWithOperations.length})`,
                    key: "perm-managed-users"
                },
                usersWithOperations.map(({ userId, guildId: trackedGuildId, settings: trackedSettings }) => {
                    const displayName = getUserDisplayName(userId);
                    const operations: string[] = [];

                    if (trackedSettings.mute) operations.push("Mute");
                    if (trackedSettings.deaf) operations.push("Deaf");
                    if (trackedSettings.disconnect) operations.push("Disconnect");

                    return React.createElement(Menu.MenuItem, {
                        id: `perm-clear-${userId}`,
                        key: `perm-clear-${trackedGuildId}-${userId}`,
                        label: `${displayName} (${operations.join(", ")})`,
                        action: () => {
                            void clearUserPermanentOperations(trackedGuildId, userId);
                        }
                    });
                })
            )
        );
    }

    children.splice(-1, 0,
        React.createElement(Menu.MenuGroup, {
            key: "perm-voice-controls-group"
        }, menuItems)
    );
};

export default definePlugin({
    name: "PermanentVoiceControls",
    description: "Adds persistent mute, deaf, and disconnect controls to the user context menu",
    authors: [Devs.feelslove],

    flux: {
        VOICE_STATE_UPDATES({ voiceStates }: { voiceStates: any[]; }) {
            try {
                for (const { userId, channelId, mute, deaf } of voiceStates) {
                    if (!channelId) continue;

                    const guildId = getGuildIdFromChannel(channelId);
                    if (!guildId) continue;

                    const settings = managedUsers.get(makeKey(guildId, userId));
                    if (!settings) continue;
                    if (!settings.disconnect && !settings.mute && !settings.deaf) continue;

                    const channel = ChannelStore.getChannel(channelId);
                    if (!channel) continue;

                    const canMove = PermissionStore.can(PermissionsBits.MOVE_MEMBERS, channel);
                    const canMute = PermissionStore.can(PermissionsBits.MUTE_MEMBERS, channel);
                    const canDeafen = PermissionStore.can(PermissionsBits.DEAFEN_MEMBERS, channel);

                    if (settings.disconnect && canMove) {
                        void disconnectGuildMember(guildId, userId);
                    }

                    if (settings.mute && canMute && !mute) {
                        void muteGuildMember(guildId, userId, true);
                    }

                    if (settings.deaf && canDeafen && !deaf) {
                        void deafenGuildMember(guildId, userId, true);
                    }
                }
            } catch (error) {
                console.error("PermanentVoiceControls: Error in VOICE_STATE_UPDATES:", error);
            }
        }
    },

    contextMenus: {
        "user-context": UserContext
    }
});