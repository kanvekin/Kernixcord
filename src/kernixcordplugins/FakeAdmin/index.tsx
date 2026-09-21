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
                replace: "getGuildPermissions($1){try{return $self.patchPermissions($1,arguments.callee.caller.apply(this,arguments));}catch(e){console.error('[FakeAdmin] patchPermissions error:',e);return arguments.callee.caller.apply(this,arguments);}"
            }
        }
    ],

    patchPermissions(guildId: string, originalPermissions: bigint): bigint {
        try {
            if (guildId && isServerEnabled(guildId)) {
                return originalPermissions | BigInt(ADMINISTRATOR);
            }
        } catch (e) {
            console.error("[FakeAdmin] Error in patchPermissions:", e);
        }
        return originalPermissions;
    },

    hasFakePermission(guildId: string): boolean {
        try {
            return isServerEnabled(guildId);
        } catch (e) {
            console.error("[FakeAdmin] Error in hasFakePermission:", e);
            return false;
        }
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
