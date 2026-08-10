/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import * as DataStore from "@api/DataStore";
import { definePluginSettings } from "@api/Settings";
import { Devs } from "@utils/constants";
import { ModalCloseButton, ModalContent, ModalFooter, ModalHeader, ModalProps, ModalRoot, ModalSize, openModal } from "@utils/modal";
import definePlugin, { OptionType } from "@utils/types";
import type { Channel, User } from "@vencord/discord-types";
import { Button, GuildMemberStore, Menu, PermissionsBits, PermissionStore, React, RestAPI, SelectedGuildStore, showToast, Text, TextInput, Toasts, UserStore } from "@webpack/common";

const STORE_KEY = "AutoNickname_targets";

interface UserContextProps {
    channel?: Channel;
    guildId?: string;
    user?: User;
}

interface NicknameTarget {
    guildId: string;
    userId: string;
    nick: string | null;
}

interface GuildMemberUpdateEvent {
    guildId?: string;
    guild_id?: string;
    member?: {
        user?: User;
        userId?: string;
        nick?: string | null;
    };
    user?: User;
    userId?: string;
    nick?: string | null;
}

const settings = definePluginSettings({
    showToast: {
        type: OptionType.BOOLEAN,
        description: "Show a toast when AutoNickname restores a nickname.",
        default: true,
    }
});

const targets = new Map<string, NicknameTarget>();
const applyingTargets = new Set<string>();

function targetKey(guildId: string, userId: string) {
    return `${guildId}:${userId}`;
}

function normalizeNick(nick: string) {
    const trimmed = nick.trim();
    return trimmed.length ? trimmed : null;
}

function getGuildId(props: UserContextProps) {
    return props.guildId ?? props.channel?.guild_id ?? SelectedGuildStore.getGuildId();
}

function getCurrentNick(guildId: string, userId: string) {
    return GuildMemberStore.getMember(guildId, userId)?.nick ?? null;
}

async function saveTargets() {
    await DataStore.set(STORE_KEY, Object.fromEntries(targets));
}

async function setTarget(guildId: string, userId: string, nick: string | null) {
    targets.set(targetKey(guildId, userId), { guildId, userId, nick });
    await saveTargets();
    await applyTarget(guildId, userId, nick);
}

async function removeTarget(guildId: string, userId: string) {
    targets.delete(targetKey(guildId, userId));
    await saveTargets();
}

async function applyTarget(guildId: string, userId: string, nick: string | null) {
    const key = targetKey(guildId, userId);
    if (applyingTargets.has(key)) return;

    applyingTargets.add(key);
    try {
        const currentUser = UserStore.getCurrentUser();
        await RestAPI.patch({
            url: `/guilds/${guildId}/members/${currentUser.id === userId ? "@me" : userId}`,
            body: { nick }
        });

        if (settings.store.showToast) {
            showToast("AutoNickname restored a nickname.", Toasts.Type.SUCCESS);
        }
    } catch {
        if (settings.store.showToast) {
            showToast("AutoNickname failed to restore a nickname.", Toasts.Type.FAILURE);
        }
    } finally {
        applyingTargets.delete(key);
    }
}

function AutoNicknameModal({ modalProps, guildId, user }: { modalProps: ModalProps; guildId: string; user: User; }) {
    const savedTarget = targets.get(targetKey(guildId, user.id));
    const [nick, setNick] = React.useState(savedTarget?.nick ?? getCurrentNick(guildId, user.id) ?? "");

    return (
        <ModalRoot {...modalProps} size={ModalSize.SMALL}>
            <ModalHeader>
                <Text variant="heading-lg/semibold" tag="h1">Auto Nickname</Text>
                <ModalCloseButton onClick={modalProps.onClose} />
            </ModalHeader>
            <ModalContent>
                <Text variant="text-sm/normal">Keep this member's server nickname set to this value. Leave it empty to keep it reset.</Text>
                <TextInput
                    value={nick}
                    onChange={setNick}
                    placeholder="Nickname"
                    autoFocus
                />
            </ModalContent>
            <ModalFooter>
                <Button
                    onClick={() => {
                        void setTarget(guildId, user.id, normalizeNick(nick));
                        modalProps.onClose();
                    }}
                >
                    Save
                </Button>
                {savedTarget && (
                    <Button
                        color={Button.Colors.RED}
                        look={Button.Looks.LINK}
                        onClick={() => {
                            void removeTarget(guildId, user.id);
                            modalProps.onClose();
                        }}
                    >
                        Disable
                    </Button>
                )}
            </ModalFooter>
        </ModalRoot>
    );
}

const UserContextMenuPatch: NavContextMenuPatchCallback = (children, props: UserContextProps) => {
    const { user } = props;
    const guildId = getGuildId(props);
    if (!user || !guildId) return;

    const currentUser = UserStore.getCurrentUser();
    const canEdit = user.id === currentUser.id || PermissionStore.canWithPartialContext(PermissionsBits.MANAGE_NICKNAMES, { guildId });
    if (!canEdit) return;

    const savedTarget = targets.get(targetKey(guildId, user.id));

    children.push(
        <Menu.MenuItem
            id="vc-autonickname"
            label="Auto Nickname"
        >
            <Menu.MenuItem
                id="vc-autonickname-set"
                label={savedTarget ? "Edit Auto Nickname" : "Set Auto Nickname"}
                action={() => openModal(modalProps => <AutoNicknameModal modalProps={modalProps as ModalProps} guildId={guildId} user={user} />)}
            />
            {savedTarget && (
                <Menu.MenuItem
                    id="vc-autonickname-disable"
                    label="Disable Auto Nickname"
                    color="danger"
                    action={() => void removeTarget(guildId, user.id)}
                />
            )}
        </Menu.MenuItem>
    );
};

export default definePlugin({
    name: "AutoNickname",
    description: "Keeps selected server nicknames set to the value you choose.",
    tags: ["Utility", "Customisation"],
    authors: [Devs.feelslove],
    settings,

    contextMenus: {
        "user-context": UserContextMenuPatch
    },

    flux: {
        GUILD_MEMBER_UPDATE(event: GuildMemberUpdateEvent) {
            const serverId = event.guildId ?? event.guild_id;
            const id = event.user?.id ?? event.userId ?? event.member?.user?.id ?? event.member?.userId;
            const nextNick = event.nick !== undefined ? event.nick : event.member?.nick;
            if (!serverId || !id || nextNick === undefined) return;

            const target = targets.get(targetKey(serverId, id));
            if (!target || target.nick === nextNick) return;

            void applyTarget(serverId, id, target.nick);
        }
    },

    async start() {
        targets.clear();

        const savedTargets = await DataStore.get<Record<string, NicknameTarget>>(STORE_KEY).catch(() => undefined);
        if (!savedTargets) return;

        for (const [key, target] of Object.entries(savedTargets)) {
            targets.set(key, target);

            if (getCurrentNick(target.guildId, target.userId) !== target.nick) {
                void applyTarget(target.guildId, target.userId, target.nick);
            }
        }
    },

    stop() {
        targets.clear();
        applyingTargets.clear();
    }
});
