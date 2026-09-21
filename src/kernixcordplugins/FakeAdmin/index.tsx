/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { Devs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { Menu, Toasts } from "@webpack/common";

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
    if (!guildId) return false;
    return getEnabledServers().has(guildId);
}

function toggleServer(guildId: string) {
    const enabled = getEnabledServers();
    if (enabled.has(guildId)) {
        enabled.delete(guildId);
        Toasts.show({
            message: "Fake admin disabled for this server",
            id: "fakeadmin-off",
            type: Toasts.Type.SUCCESS,
            options: { position: Toasts.Position.BOTTOM }
        });
    } else {
        enabled.add(guildId);
        Toasts.show({
            message: "Fake admin enabled for this server",
            id: "fakeadmin-on",
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
            // Patch channel list permission check to show all channels
            find: "canAccessChannel",
            replacement: {
                match: /canAccessChannel\(\i,\i\){/,
                replace: "canAccessChannel(channel,userId){try{if($self.isServerEnabled(channel?.guild_id))return true}catch(e){}return $&"
            }
        },
        {
            // Patch guild settings permission check
            find: "canAccessGuildSettings",
            replacement: {
                match: /canAccessGuildSettings\(\i\){/,
                replace: "canAccessGuildSettings(guild){try{if($self.isServerEnabled(guild?.id))return true}catch(e){}return $&"
            }
        },
        {
            // Patch channel settings permission check
            find: "canAccessChannelSettings",
            replacement: {
                match: /canAccessChannelSettings\(\i\){/,
                replace: "canAccessChannelSettings(channel){try{if($self.isServerEnabled(channel?.guild_id))return true}catch(e){}return $&"
            }
        }
    ],

    contextMenus: {
        "guild-context"(children: any[], { guild }: any) {
            if (!guild?.id) return;

            children.push(
                <Menu.MenuSeparator />,
                <Menu.MenuCheckboxItem
                    id="fakeadmin-toggle"
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
                    id="fakeadmin-toggle-header"
                    label="Fake Admin"
                    checked={isServerEnabled(guild.id)}
                    action={() => toggleServer(guild.id)}
                />
            );
        }
    }
});
