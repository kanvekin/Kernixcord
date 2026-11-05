/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./fixDiscordBadgePadding.css";

import { _getBadges, BadgePosition, BadgeRarity, BadgeUserArgs, DirectoryBadge, ProfileBadge } from "@api/Badges";
import ErrorBoundary from "@components/ErrorBoundary";
import { CopyIcon, LinkIcon } from "@components/Icons";
import { openContributorModal } from "@components/settings/tabs";
import { isEquicordDonor, isKernixcordDonor } from "@components/settings/tabs/vencord";
import { Devs } from "@utils/constants";
import { copyWithToast } from "@utils/discord";
import { Logger } from "@utils/Logger";
import { shouldShowContributorBadge, shouldShowEquicordContributorBadge, shouldShowKernixcordContributorBadge } from "@utils/misc";
import definePlugin from "@utils/types";
import { ContextMenuApi, Menu, showToast, UserStore } from "@webpack/common";

import { EquicordDonorModal, EquicordTranslatorModal, KernixcordDonorModal, VencordDonorModal } from "./modals";

const CONTRIBUTOR_BADGE = "https://cdn.discordapp.com/emojis/1092089799109775453.png?size=64";
const EQUICORD_CONTRIBUTOR_BADGE = "https://equicord.org/assets/favicon.png";
const KERNIXCORD_CONTRIBUTOR_BADGE = "https://cdn.discordapp.com/emojis/1349141323705352222.webp?size=64";
const EQUICORD_DONOR_BADGE = "https://images.equicord.org/api/v1/files/raw/0199e71a-5555-7000-aafb-a07a355d9b28";
const KERNIXCORD_DONOR_BADGE = "https://cdn.discordapp.com/emojis/1422406660281995264.webp?size=64";
const ContributorBadge: ProfileBadge = {
    id: "vencord_contributor_badge",
    description: "Vencord Contributor",
    infoLabel: "Vencord",
    rarity: BadgeRarity.MYTHIC,
    iconSrc: "https://cdn.discordapp.com/emojis/1562267648857997356.webp?size=128",
    largeIconSrc: "https://cdn.discordapp.com/emojis/1562267648857997356.webp?size=512",
    position: BadgePosition.START,
    shouldShow: ({ userId }) => shouldShowContributorBadge(userId),
    onClick: (_, { userId }) => openContributorModal(UserStore.getUser(userId))
};

const EquicordContributorBadge: ProfileBadge = {
    id: "equicord_contributor_badge",
    description: "Equicord Contributor",
    infoLabel: "Equicord",
    rarity: BadgeRarity.MYTHIC,
    iconSrc: "https://cdn.discordapp.com/emojis/1563740725726683167.webp?size=128",
    largeIconSrc: "https://cdn.discordapp.com/emojis/1563740725726683167.webp?size=512",
    position: BadgePosition.START,
    shouldShow: ({ userId }) => shouldShowEquicordContributorBadge(userId),
    onClick: (_, { userId }) => openContributorModal(UserStore.getUser(userId)),
    props: {
        style: {
            borderRadius: "50%",
            transform: "scale(0.9)"
        }
    },
};

const KernixcordContributorBadge: ProfileBadge = {
    id: "kernixcord_contributor_badge",
    description: "Kernixcord Contributor",
    iconSrc: KERNIXCORD_CONTRIBUTOR_BADGE,
    position: BadgePosition.START,
    shouldShow: ({ userId }) => shouldShowKernixcordContributorBadge(userId),
    onClick: (_, { userId }) => openContributorModal(UserStore.getUser(userId)),
    props: {
        style: {
            borderRadius: "50%",
            transform: "scale(0.9)"
        }
    },
};

const EquicordDonorBadge: ProfileBadge = {
    id: "equicord_donor_badge",
    description: "Equicord Donor",
    iconSrc: EQUICORD_DONOR_BADGE,
    position: BadgePosition.START,
    shouldShow: ({ userId }) => {
        const donorBadges = EquicordDonorBadges[userId]?.map(badge => badge.badge);
        const hasDonorBadge = donorBadges?.includes(EQUICORD_DONOR_BADGE);
        return isEquicordDonor(userId) && !hasDonorBadge;
    },
    onClick: () => EquicordDonorModal()
};

const KernixcordDonorBadge: ProfileBadge = {
    id: "kernixcord_donor_badge",
    description: "Kernixcord Donor",
    iconSrc: KERNIXCORD_DONOR_BADGE,
    position: BadgePosition.START,
    shouldShow: ({ userId }) => {
        const donorBadges = KernixcordDonorBadges[userId]?.map(badge => badge.badge);
        const hasDonorBadge = donorBadges?.includes(KERNIXCORD_DONOR_BADGE);
        return isKernixcordDonor(userId) && !hasDonorBadge;
    },
    onClick: () => KernixcordDonorModal()
};
let DonorBadges = {} as Record<string, Array<Record<"tooltip" | "badge", string>>>;
let EquicordDonorBadges = {} as Record<string, Array<Record<"tooltip" | "badge", string>>>;
let KernixcordDonorBadges = {} as Record<string, Array<Record<"tooltip" | "badge", string>>>;
let DirectoryBadges = {} as Record<string, DirectoryBadge>;

async function loadBadges(url: string, noCache = false) {
    const init = {} as RequestInit;
    if (noCache) init.cache = "no-cache";
    try {
        const response = await fetch(url, init);
        if (!response.ok) throw new Error(`Failed to fetch badges: ${response.status} ${response.statusText} (${url})`);
        const json = await response.json();
        if (!json || typeof json !== "object") {
            throw new Error(`Badges JSON is invalid (${url})`);
        }
        return json;
    } catch (err) {
        new Logger("BadgeAPI#loadBadges").error(err);
        return {};
    }
}

async function loadAllBadges(noCache = false) {
    const vencordBadges = await loadBadges("https://badges.vencord.dev/badges.json", noCache);
    const equicordBadges = await loadBadges("https://badge.equicord.org/badges.json", noCache);
    const kernixcordBadges = await loadBadges("https://raw.githubusercontent.com/kanvekin/Donors/main/badges.json", noCache);

    DonorBadges = vencordBadges || {};
    EquicordDonorBadges = equicordBadges || {};
    KernixcordDonorBadges = kernixcordBadges || {};
}

let intervalId: any;

function toDirectoryBadge(b: ProfileBadge, userId: string): DirectoryBadge {
    const id = `vc-${userId}-${b.id}`;

    return DirectoryBadges[id] ??= {
        badge_id: id,
        name: b.name ?? b.description ?? "",
        description: b.detail ?? b.description ?? b.name ?? "",
        info_label: b.infoLabel ?? "Equicord",
        rarity: b.rarity ?? BadgeRarity.COMMON,
        simple_icon_url: b.iconSrc!,
        complex_icon_static_url: b.largeIconSrc ?? b.iconSrc!,
        obtained_at: b.obtainedAt,
        is_earnable: false,
        owned: true,
        hidden: false,
        tiers: []
    };
}

export function BadgeContextMenu({ badge }: { badge: Omit<ProfileBadge, "id"> & BadgeUserArgs; }) {
    return (
        <Menu.Menu navId="vc-badge-context" onClose={ContextMenuApi.closeContextMenu} aria-label="Badge Options">
            {badge.description && (
                <Menu.MenuItem
                    id="vc-badge-copy-name"
                    label="Copy Badge Name"
                    action={() => copyWithToast(badge.description!)}
                    leadingAccessory={{ type: "icon", icon: CopyIcon }}
                />
            )}
            {badge.iconSrc && (
                <Menu.MenuItem
                    id="vc-badge-copy-link"
                    label="Copy Badge Image Link"
                    action={() => copyWithToast(badge.iconSrc!)}
                    leadingAccessory={{ type: "icon", icon: LinkIcon }}
                />
            )}
        </Menu.Menu>
    );
}

export default definePlugin({
    name: "BadgeAPI",
    description: "API to add badges to users",
    authors: [Devs.Megu, Devs.Ven, Devs.TheSun, Devs.feelslove],
    required: true,
    patches: [
        {
            find: "#{intl::PROFILE_USER_BADGES}",
            replacement: [
                {
                    match: /alt:" ","aria-hidden":!0,src:.{0,50}(\i).iconSrc/,
                    replace: "...$1.props,$&"
                },
                // Path with 2026-04-badge-discovery OFF
                {
                    match: /(?<=forceOpen:.{0,40}?ariaHidden:!0,)children:(?=.{0,50}?(\i)\.id)/,
                    replace: "children:$1.component?$self.renderBadgeComponent({...$1}):"
                },
                // Path with 2026-04-badge-discovery ON
                {
                    match: /(?<=fallbackIconSrc:.{0,50}?)children:(?=.{0,50}?(\i)\.id)/,
                    replace: "children:$1.component?$self.renderBadgeComponent({...$1}):"
                },
                {
                    match: /href:(\i)\.link/,
                    replace: "...$self.getBadgeMouseEventHandlers($1),$&"
                },
                {
                    match: /legacyBadgeId:(\i),userId:(\i),.{0,100}?=\i,\i=\(0,\i\.\i\)\(\1\)/,
                    replace: "$&??$self.getDirectoryBadgeId($1,$2)"
                }
            ]
        },
        {
            find: "getLegacyUsername(){",
            replacement: {
                match: /getBadges\(\)\{.{0,100}?return\[/,
                replace: "$&...$self.getBadges(this),"
            }
        },
        {
            find: '"BadgeDirectoryStore"',
            replacement: {
                match: /getBadgeById\((\i),(\i)\)\{/,
                replace: "$&const vencordBadge=$self.getDirectoryBadge($1);if(vencordBadge)return vencordBadge;"
            }
        },
        {
            find: "badge_directory_closed",
            replacement: {
                match: /(\i\.\i\.getBadges\((\i)\))(?=:\[\],\[\2\]\))/,
                replace: "[...$1,...$self.getDirectoryBadges($2)]"
            }
        }
    ],

    get DonorBadges() {
        return DonorBadges;
    },
    get EquicordDonorBadges() {
        return EquicordDonorBadges;
    },
    get KernixcordDonorBadges() {
        return KernixcordDonorBadges;
    },

    toolboxActions: {
        async "Refetch Badges"() {
            await loadAllBadges(true);
            showToast({ text: "Successfully refetched badges!", variant: "success" });
        }
    },
    userProfileBadges: [ContributorBadge, EquicordContributorBadge, KernixcordContributorBadge, EquicordDonorBadge, KernixcordDonorBadge],

    async start() {
        await loadAllBadges();
        clearInterval(intervalId);
        intervalId = setInterval(loadAllBadges, 1000 * 60 * 30);
    },

    async stop() {
        clearInterval(intervalId);
        DirectoryBadges = {};
    },

    getBadges(profile: { userId: string; guildId: string; }) {
        if (!profile) return [];

        try {
            return _getBadges(profile);
        } catch (e) {
            new Logger("BadgeAPI#getBadges").error(e);
            return [];
        }
    },

    getDirectoryBadge(id: string) {
        return DirectoryBadges[id];
    },

    getDirectoryBadges(userId: string) {
        return this.getBadges({ userId, guildId: "" })
            .filter(b => b.iconSrc)
            .map(b => toDirectoryBadge(b, userId));
    },

    getDirectoryBadgeId(badgeId: string, userId?: string) {
        if (!userId) return;

        const badge = this.getBadges({ userId, guildId: "" })
            .find(b => b.id === badgeId && b.iconSrc);

        if (badge) return toDirectoryBadge(badge, userId).badge_id;
    },

    renderBadgeComponent: ErrorBoundary.wrap((badge: ProfileBadge & BadgeUserArgs) => {
        const Component = badge.component!;
        return <Component {...badge} />;
    }, { noop: true }),

    getBadgeMouseEventHandlers(badge: ProfileBadge & BadgeUserArgs) {
        const handlers = {} as Record<string, (e: React.MouseEvent) => void>;
        if (!badge) return handlers;

        const { onClick, onContextMenu } = badge;
        if (onClick) handlers.onClick = e => onClick(e, badge);
        if (onContextMenu) handlers.onContextMenu = e => onContextMenu(e, badge);
        return handlers;
    },

    getDonorBadges(userId: string) {
        return DonorBadges[userId]?.map((badge, idx) => ({
            id: `vencord_donor_badge_${idx}`,
            iconSrc: badge.badge,
            description: badge.tooltip,
            position: BadgePosition.START,
            props: { style: { borderRadius: "50%", transform: "scale(0.9)" } },
            onContextMenu(event, badge) {
                ContextMenuApi.openContextMenu(event, () => <BadgeContextMenu badge={badge} />);
            },
            onClick: () => VencordDonorModal()
        } satisfies ProfileBadge));
    },

    getEquicordDonorBadges(userId: string) {
        return EquicordDonorBadges[userId]?.map((badge, idx) => ({
            id: `equicord_donor_badge_${idx}`,
            iconSrc: badge.badge,
            description: badge.tooltip,
            name: badge.tooltip,
            infoLabel: "Equicord Donor",
            rarity: BadgeRarity.MYTHIC,
            position: BadgePosition.START,
            props: { style: { borderRadius: "50%", transform: "scale(0.9)" } },
            onContextMenu(event, badge) {
                ContextMenuApi.openContextMenu(event, () => <BadgeContextMenu badge={badge} />);
            },
            onClick() {
                return badge.tooltip === "Equicord Translator" ? EquicordTranslatorModal() : EquicordDonorModal();
            }
        } satisfies ProfileBadge));
    },

    getKernixcordDonorBadges(userId: string) {
        return KernixcordDonorBadges[userId]?.map((badge, idx) => ({
            id: `kernixcord_donor_badge_${idx}`,
            iconSrc: badge.badge,
            description: badge.tooltip,
            position: BadgePosition.START,
            props: { style: { borderRadius: "50%", transform: "scale(0.9)" } },
            onContextMenu(event, badge) {
                ContextMenuApi.openContextMenu(event, () => <BadgeContextMenu badge={badge} />);
            },
            onClick: () => KernixcordDonorModal()
        } satisfies ProfileBadge));
    }
});
