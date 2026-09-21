/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { Devs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { findByPropsLazy } from "@webpack";
import { Menu, Toasts } from "@webpack/common";

const PermissionStore = findByPropsLazy("getGuildPermissions");
const GuildMemberStore = findByPropsLazy("getMember");

export const settings = definePluginSettings({
    enabledServers: {
        type: OptionType.STRING,
        description: "Comma-separated list of server IDs where fake admin is enabled",
        default: "",
        hidden: true
    }
});

function getEnabledServers(): Set<string> {
    const ids = settings.store.enabledServers || "";
    return new Set(ids.split(",").filter(id => id.trim()));
}

function isServerEnabled(guildId: string): boolean {
    return getEnabledServers().has(guildId);
}

function toggleServer(guildId: string) {
    const enabled = getEnabledServers();
    if (enabled.has(guildId)) {
        enabled.delete(guildId);
        Toasts.show({
            message: "Fake admin disabled for this server",
            id: "dev-feelslove-off",
            type: Toasts.Type.SUCCESS,
            options: { position: Toasts.Position.BOTTOM }
        });
    } else {
        enabled.add(guildId);
        Toasts.show({
            message: "Fake admin enabled for this server",
            id: "dev-feelslove-on",
            type: Toasts.Type.SUCCESS,
            options: { position: Toasts.Position.BOTTOM }
        });
    }
    settings.store.enabledServers = Array.from(enabled).join(",");
}

// Permission bit flags (Discord)
const ADMINISTRATOR = 0x0000000000000008;

export default definePlugin({
    name: "FakeAdmin",
    description: "Show fake admin privileges in servers (visual only - no actual permissions)",
    authors: [Devs.feelslove],
    settings,

    patches: [
        {
            // Patch getGuildPermissions to include ADMINISTRATOR when enabled
            find: "getGuildPermissions(",
            replacement: {
                match: /getGuildPermissions\((\w+)\){/,
                replace: "getGuildPermissions($1){return $self.patchPermissions($1,arguments.callee.caller.apply(this,arguments));"
            }
        },
        {
            // Patch can function to return true for admin permissions when enabled
            find: "can(",
            replacement: {
                match: /can\((\w+),\w+\){/,
                replace: "can($1,userId){return $self.patchCan($1,userId,arguments.callee.caller.apply(this,arguments));"
            }
        },
        {
            // Patch permission checks in channel settings
            find: "MANAGE_CHANNELS",
            replacement: {
                match: /MANAGE_CHANNELS:\(\i,\i\)=>\i/,
                replace: "MANAGE_CHANNELS:(guildId,channelId)=>$self.hasFakePermission(guildId)||$&"
            }
        },
        {
            // Patch permission checks in server settings
            find: "MANAGE_GUILD",
            replacement: {
                match: /MANAGE_GUILD:\(\i\)=>\i/,
                replace: "MANAGE_GUILD:(guildId)=>$self.hasFakePermission(guildId)||$&"
            }
        }
    ],

    patchPermissions(guildId: string, originalPermissions: bigint): bigint {
        if (isServerEnabled(guildId)) {
            return originalPermissions | BigInt(ADMINISTRATOR);
        }
        return originalPermissions;
    },

    patchCan(permission: bigint, userId: string, originalResult: boolean): boolean {
        // Get current guild from context if possible
        const member = GuildMemberStore.getMember(userId);
        if (member && isServerEnabled(member.guildId)) {
            // If it's an admin permission, return true
            if ((permission & BigInt(ADMINISTRATOR)) === BigInt(ADMINISTRATOR)) {
                return true;
            }
        }
        return originalResult;
    },

    hasFakePermission(guildId: string): boolean {
        return isServerEnabled(guildId);
    },

    contextMenus: {
        "guild-context"(children: any[], { guild }: any) {
            if (!guild?.id) return;

            children.push(
                <Menu.MenuSeparator />,
                <Menu.MenuCheckboxItem
                    id="dev-feelslove-toggle"
                    label="Fake Admin"
                    checked={isServerEnabled(guild.id)}
                    action={() => toggleServer(guild.id)}
                />
            );
        },
        "guild-header-popout"(children: any[], { guild }: any) {
            if (!guild?.id) return;

            children.push(
                <Menu.MenuSeparator />,
                <Menu.MenuCheckboxItem
                    id="dev-feelslove-toggle-header"
                    label="Fake Admin"
                    checked={isServerEnabled(guild.id)}
                    action={() => toggleServer(guild.id)}
                />
            );
        }
    }
});
