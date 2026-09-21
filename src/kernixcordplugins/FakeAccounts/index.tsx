/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { ModalCloseButton, ModalContent, ModalFooter, ModalHeader, ModalRoot, ModalSize, openModal, ModalProps } from "@utils/modal";
import definePlugin, { OptionType } from "@utils/types";
import { findByPropsLazy, waitFor } from "@webpack";
import { Button, Forms, React, RestAPI, TextInput, Toasts, PresenceStore, UserProfileStore } from "@webpack/common";
import { Devs } from "@utils/constants";

const CUSTOM_STATUS_TYPE = 4;

const UserStore = findByPropsLazy("getCurrentUser", "getUser");
const GuildStore = findByPropsLazy("getGuilds", "getGuildCount");
const GuildFolderStore = findByPropsLazy("getGuildsTree", "getFlattenedGuildIds");
const ChannelStore = findByPropsLazy("getSortedPrivateChannels", "getMutablePrivateChannels");
const RelationshipStore = findByPropsLazy("getRelationshipType", "getFriendCount");
const AuthStore = findByPropsLazy("getId", "getToken");
const TabBar = findByPropsLazy("Header", "Item", "Separator", "Panel");

let UserClass: any = null;

let _GuildsTreeClass: any = null;
function getGuildsTreeClass() {
    if (!_GuildsTreeClass) {
        try {
            _GuildsTreeClass = GuildFolderStore.getGuildsTree().constructor;
        } catch {
            return null;
        }
    }
    return _GuildsTreeClass;
}

waitFor(
    (m: any) => m?.prototype?.getAvatarURL && m?.prototype?.hasAvatarForGuild,
    (m: any) => { UserClass = m; }
);

const settings = definePluginSettings({
    fakeAccounts: {
        description: "Stored fake accounts (do not edit manually)",
        type: OptionType.STRING,
        default: "[]",
    }
});

interface FakeAccountProfile {
    bio: string;
    pronouns: string;
    themeColors: number[] | null;
}

interface FakeAccountClan {
    identity_guild_id?: string;
    identity_enabled?: boolean;
    tag?: string;
    badge?: string;
}

interface FakeAccountCustomStatus {
    text: string;
    emojiId?: string;
    emojiName?: string;
}

interface FakeAccount {
    id: string;
    username: string;
    discriminator: string;
    avatar: string | null;
    globalName: string | null;
    banner?: string | null;
    bannerColor?: string | null;
    accentColor?: number | null;
    clan?: FakeAccountClan | null;
    premiumType?: number | null;
    premiumSince?: string | null;
    profile?: FakeAccountProfile;
    status?: string;
    customStatus?: FakeAccountCustomStatus | null;
}

function normalizeAccount(acc: FakeAccount): FakeAccount {
    return {
        ...acc,
        profile: {
            bio: acc.profile?.bio ?? "",
            pronouns: acc.profile?.pronouns ?? "",
            themeColors: acc.profile?.themeColors ?? null,
        },
        customStatus: acc.customStatus ?? null,
        clan: acc.clan ?? null,
    };
}

function parseFakeAccounts(): FakeAccount[] {
    try { return JSON.parse(settings.store.fakeAccounts).map(normalizeAccount); }
    catch { return []; }
}

function saveFakeAccounts(accounts: FakeAccount[]) {
    settings.store.fakeAccounts = JSON.stringify(accounts);
}

function parseAvatar(input: string): string | null {
    if (!input) return null;
    const match = input.match(/avatars\/\d+\/([a-f0-9_]+)(?:\.webp|\.png|\.gif)?/i);
    if (match) return match[1];
    if (/^[a-f0-9_]{32,}$/i.test(input)) return input;
    return null;
}

function getStoredCustomStatus(acc: FakeAccount) {
    if (!acc.customStatus?.text && !acc.customStatus?.emojiName && !acc.customStatus?.emojiId) return null;
    const emoji = acc.customStatus.emojiId
        ? { id: acc.customStatus.emojiId, name: acc.customStatus.emojiName ?? "" }
        : acc.customStatus.emojiName
            ? { name: acc.customStatus.emojiName }
            : undefined;
    return {
        type: CUSTOM_STATUS_TYPE,
        state: acc.customStatus.text ?? "",
        emoji,
    };
}

function extractPresenceData(userId: string) {
    const status = PresenceStore.getStatus(userId) || undefined;
    const customActivity = (PresenceStore.getActivities(userId) ?? []).find(a => a.type === CUSTOM_STATUS_TYPE);
    const customStatus = customActivity
        ? {
            text: customActivity.state ?? "",
            emojiId: customActivity.emoji?.id,
            emojiName: customActivity.emoji?.name,
        }
        : null;
    return { status, customStatus };
}

function accountFromProfileBody(body: any): FakeAccount {
    const user = body.user ?? body;
    const userProfile = body.user_profile ?? {};
    const { status, customStatus } = extractPresenceData(user.id);

    return normalizeAccount({
        id: user.id,
        username: user.username,
        discriminator: user.discriminator ?? "0",
        avatar: user.avatar ?? null,
        globalName: user.global_name ?? user.globalName ?? user.username,
        banner: user.banner ?? null,
        bannerColor: user.banner_color ?? user.bannerColor ?? null,
        accentColor: user.accent_color ?? user.accentColor ?? null,
        clan: user.clan ?? user.primary_guild ?? user.primaryGuild ?? null,
        premiumType: body.premium_type ?? user.premium_type ?? null,
        premiumSince: body.premium_since ?? null,
        profile: {
            bio: userProfile.bio ?? user.bio ?? "",
            pronouns: userProfile.pronouns ?? "",
            themeColors: userProfile.theme_colors ?? userProfile.themeColors ?? null,
        },
        status,
        customStatus,
    });
}

function isFakeProfileRequest(url: string | undefined, userId: string) {
    if (!url) return false;
    return url === `/users/${userId}/profile`
        || url.startsWith(`/users/${userId}/profile?`)
        || url === "/users/@me/profile"
        || url.startsWith("/users/@me/profile?");
}

function buildProfileResponse(acc: FakeAccount, fakeUser: any) {
    return {
        body: {
            user: {
                ...fakeUser,
                banner: acc.banner ?? null,
                banner_color: acc.bannerColor ?? null,
                accent_color: acc.accentColor ?? null,
                bio: acc.profile?.bio ?? "",
                clan: acc.clan ?? null,
                primary_guild: acc.clan ?? null,
            },
            user_profile: {
                bio: acc.profile?.bio ?? "",
                pronouns: acc.profile?.pronouns ?? "",
                theme_colors: acc.profile?.themeColors ?? null,
            },
            badges: [],
            guild_badges: [],
            connected_accounts: [],
            mutual_guilds: [],
            premium_since: acc.premiumSince ?? null,
            premium_type: acc.premiumType ?? null,
            premium_guild_since: null,
        }
    };
}

function buildStoredUserProfile(acc: FakeAccount, fakeUser: any) {
    return {
        userId: acc.id,
        user: fakeUser,
        bio: acc.profile?.bio ?? "",
        pronouns: acc.profile?.pronouns ?? "",
        themeColors: acc.profile?.themeColors ?? null,
        banner: acc.banner ?? null,
        bannerColor: acc.bannerColor ?? null,
        accentColor: acc.accentColor ?? null,
        premiumType: acc.premiumType ?? null,
        premiumSince: acc.premiumSince ?? null,
        badges: [],
        connectedAccounts: [],
        guildId: undefined,
    };
}

function getStatusColor(status?: string) {
    switch (status) {
        case "online": return "var(--status-positive)";
        case "idle": return "var(--status-warning)";
        case "dnd": return "var(--status-danger)";
        default: return "var(--status-offline)";
    }
}

function getAvatarUrl(acc: FakeAccount, size = 40) {
    if (acc.avatar) return `https://cdn.discordapp.com/avatars/${acc.id}/${acc.avatar}.webp?size=${size}`;
    return `https://cdn.discordapp.com/embed/avatars/${Number(BigInt(acc.id) % 6n)}.png`;
}

function getBannerUrl(acc: FakeAccount) {
    if (acc.banner) return `https://cdn.discordapp.com/banners/${acc.id}/${acc.banner}.webp?size=300`;
    if (acc.bannerColor) return acc.bannerColor;
    if (acc.accentColor != null) return `#${acc.accentColor.toString(16).padStart(6, "0")}`;
    return "var(--background-secondary-alt)";
}

const _originals: Record<string, any> = {};
let _fakeSessionActive = false;
let _fakeSessionUser: FakeAccount | null = null;

function buildUserObject(acc: FakeAccount): any {
    if (!UserClass) {
        console.warn("[FakeAccount] UserClass not available");
        return null;
    }
    return new UserClass({
        id: acc.id,
        username: acc.username,
        discriminator: acc.discriminator ?? "0",
        avatar: acc.avatar ?? null,
        global_name: acc.globalName ?? acc.username,
        banner: acc.banner ?? null,
        banner_color: acc.bannerColor ?? null,
        accent_color: acc.accentColor ?? null,
        bio: acc.profile?.bio ?? "",
        clan: acc.clan ?? null,
        verified: true,
        email: "fake@fake.com",
        has_bounced_email: false,
        bot: false,
        system: false,
        mfa_enabled: false,
        mobile: false,
        desktop: true,
        premium_type: acc.premiumType ?? null,
        flags: 0,
        public_flags: 0,
        purchased_flags: 0,
        premium_usage_flags: 0,
        phone: null,
        nsfw_allowed: true,
        personal_connection_id: null,
        primary_guild: acc.clan ?? null,
    });
}

export function activateFakeSession(acc: FakeAccount) {
    if (_fakeSessionActive) deactivateFakeSession();

    // UserClass henüz yüklenmemişse kısa bir gecikmeyle tekrar dene
    if (!UserClass) {
        let attempts = 0;
        const retry = setInterval(() => {
            attempts++;
            if (UserClass) {
                clearInterval(retry);
                activateFakeSession(acc);
            } else if (attempts >= 10) {
                clearInterval(retry);
                Toasts.show({
                    message: "Failed to build user object (UserClass unavailable). Try again.",
                    id: "fakeaccount-notready",
                    type: Toasts.Type.FAILURE,
                    options: { position: Toasts.Position.BOTTOM }
                });
            }
        }, 300);
        return;
    }

    const fakeUser = buildUserObject(acc);
    if (!fakeUser) {
        Toasts.show({
            message: "Failed to build user object, try again.",
            id: "fakeaccount-notready",
            type: Toasts.Type.FAILURE,
            options: { position: Toasts.Position.BOTTOM }
        });
        return;
    }

    _fakeSessionActive = true;
    _fakeSessionUser = acc;

    const GuildsTreeClass = getGuildsTreeClass();

    _originals.getCurrentUser = UserStore.getCurrentUser.bind(UserStore);
    UserStore.getCurrentUser = () => fakeUser;

    _originals.getId = AuthStore.getId.bind(AuthStore);
    AuthStore.getId = () => acc.id;

    _originals.getGuildsTree = GuildFolderStore.getGuildsTree.bind(GuildFolderStore);
    if (GuildsTreeClass) {
        GuildFolderStore.getGuildsTree = () => new GuildsTreeClass();
    }

    _originals.getFlattenedGuildIds = GuildFolderStore.getFlattenedGuildIds.bind(GuildFolderStore);
    GuildFolderStore.getFlattenedGuildIds = () => [];

    _originals.getFlattenedGuildFolderList = GuildFolderStore.getFlattenedGuildFolderList.bind(GuildFolderStore);
    GuildFolderStore.getFlattenedGuildFolderList = () => [];

    _originals.getGuildFolders = GuildFolderStore.getGuildFolders.bind(GuildFolderStore);
    GuildFolderStore.getGuildFolders = () => [];

    _originals.getGuildCount = GuildStore.getGuildCount.bind(GuildStore);
    GuildStore.getGuildCount = () => 0;

    _originals.getSortedPrivateChannels = ChannelStore.getSortedPrivateChannels.bind(ChannelStore);
    ChannelStore.getSortedPrivateChannels = () => [];

    _originals.getMutablePrivateChannels = ChannelStore.getMutablePrivateChannels.bind(ChannelStore);
    ChannelStore.getMutablePrivateChannels = () => ({});

    _originals.getFriendCount = RelationshipStore.getFriendCount.bind(RelationshipStore);
    RelationshipStore.getFriendCount = () => 0;

    _originals.getFriendIDs = RelationshipStore.getFriendIDs.bind(RelationshipStore);
    RelationshipStore.getFriendIDs = () => [];

    _originals.getMutableRelationships = RelationshipStore.getMutableRelationships.bind(RelationshipStore);
    RelationshipStore.getMutableRelationships = () => new Map();

    _originals.getRelationshipType = RelationshipStore.getRelationshipType.bind(RelationshipStore);
    RelationshipStore.getRelationshipType = () => 0;

    _originals.getUserProfile = UserProfileStore.getUserProfile.bind(UserProfileStore);
    UserProfileStore.getUserProfile = function (userId: string) {
        if (userId === acc.id) return buildStoredUserProfile(acc, fakeUser);
        return _originals.getUserProfile.call(this, userId);
    };

    _originals.getStatus = PresenceStore.getStatus.bind(PresenceStore);
    PresenceStore.getStatus = function (userId: string) {
        if (userId === acc.id && acc.status) return acc.status;
        return _originals.getStatus.call(this, userId);
    };

    _originals.getActivities = PresenceStore.getActivities.bind(PresenceStore);
    PresenceStore.getActivities = function (userId: string) {
        if (userId === acc.id) {
            const customStatus = getStoredCustomStatus(acc);
            const otherActivities = (_originals.getActivities.call(this, userId) ?? []).filter(a => a.type !== CUSTOM_STATUS_TYPE);
            return customStatus ? [customStatus, ...otherActivities] : otherActivities;
        }
        return _originals.getActivities.call(this, userId);
    };

    _originals.restGet = RestAPI.get.bind(RestAPI);
    RestAPI.get = async function (req: any, ...args: any[]) {
        if (isFakeProfileRequest(req.url, acc.id)) {
            return buildProfileResponse(acc, fakeUser);
        }
        return _originals.restGet.call(this, req, ...args);
    };

    Toasts.show({
        message: `Switched to ${acc.username}`,
        id: "fakeaccount-switch",
        type: Toasts.Type.SUCCESS,
        options: { position: Toasts.Position.BOTTOM }
    });
}

export function deactivateFakeSession() {
    if (!_fakeSessionActive) return;

    const restoreOn = (store: any, key: string) => {
        if (_originals[key]) store[key] = _originals[key];
    };

    restoreOn(UserStore, "getCurrentUser");
    restoreOn(AuthStore, "getId");
    restoreOn(GuildFolderStore, "getGuildsTree");
    restoreOn(GuildFolderStore, "getFlattenedGuildIds");
    restoreOn(GuildFolderStore, "getFlattenedGuildFolderList");
    restoreOn(GuildFolderStore, "getGuildFolders");
    restoreOn(GuildStore, "getGuildCount");
    restoreOn(ChannelStore, "getSortedPrivateChannels");
    restoreOn(ChannelStore, "getMutablePrivateChannels");
    restoreOn(RelationshipStore, "getFriendCount");
    restoreOn(RelationshipStore, "getFriendIDs");
    restoreOn(RelationshipStore, "getMutableRelationships");
    restoreOn(RelationshipStore, "getRelationshipType");
    restoreOn(UserProfileStore, "getUserProfile");
    restoreOn(PresenceStore, "getStatus");
    restoreOn(PresenceStore, "getActivities");

    if (_originals.restGet) {
        RestAPI.get = _originals.restGet;
    }

    Object.keys(_originals).forEach(k => delete _originals[k]);
    _fakeSessionActive = false;
    _fakeSessionUser = null;

    Toasts.show({
        message: "Switched back to real account",
        id: "fakeaccount-restore",
        type: Toasts.Type.SUCCESS,
        options: { position: Toasts.Position.BOTTOM }
    });
}

function FakeAccountModal({ modalProps }: { modalProps: ModalProps; }) {
    const [accounts, setAccounts] = React.useState<FakeAccount[]>(parseFakeAccounts());
    const [userId, setUserId] = React.useState("");
    const [manualUsername, setManualUsername] = React.useState("");
    const [manualAvatar, setManualAvatar] = React.useState("");
    const [loading, setLoading] = React.useState(false);
    const [tab, setTab] = React.useState<"id" | "manual">("id");
    const [activeId, setActiveId] = React.useState<string | null>(_fakeSessionUser?.id ?? null);

    const updateAccounts = (newAccounts: FakeAccount[]) => {
        setAccounts(newAccounts);
        saveFakeAccounts(newAccounts);
    };

    const fetchAndAdd = async () => {
        if (!userId.trim()) return;
        if (accounts.some(a => a.id === userId.trim())) {
            Toasts.show({ message: "Already added!", id: "fa-dupe", type: Toasts.Type.FAILURE, options: { position: Toasts.Position.BOTTOM } });
            return;
        }
        setLoading(true);
        try {
            const res = await RestAPI.get({
                url: `/users/${userId.trim()}/profile`,
                query: {
                    with_mutual_guilds: true,
                    with_mutual_friends_count: true,
                }
            });
            const account = accountFromProfileBody(res.body);
            updateAccounts([...accounts, account]);
            setUserId("");
            Toasts.show({ message: `Added ${account.username}!`, id: "fa-add", type: Toasts.Type.SUCCESS, options: { position: Toasts.Position.BOTTOM } });
        } catch {
            Toasts.show({ message: "Failed to fetch user. Check the ID.", id: "fa-fail", type: Toasts.Type.FAILURE, options: { position: Toasts.Position.BOTTOM } });
        }
        setLoading(false);
    };

    const addManual = () => {
        if (!manualUsername.trim()) return;
        const id = (BigInt(Date.now()) - 1420070400000n).toString().slice(0, 18);
        updateAccounts([...accounts, normalizeAccount({
            id,
            username: manualUsername.trim(),
            discriminator: "0",
            avatar: parseAvatar(manualAvatar),
            globalName: manualUsername.trim(),
            profile: { bio: "", pronouns: "", themeColors: null },
        })]);
        setManualUsername("");
        setManualAvatar("");
    };

    return (
        <ModalRoot {...modalProps} size={ModalSize.MEDIUM}>

            {/* ── Header ── */}
            <ModalHeader separator>
                <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    style={{ marginRight: "8px", flexShrink: 0, color: "var(--interactive-normal)" }}
                >
                    <path d="M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10zm0 2c-5.33 0-8 2.67-8 4v1h16v-1c0-1.33-2.67-4-8-4z" />
                </svg>
                <Forms.FormTitle tag="h4" style={{ margin: 0, flex: 1 }}>
                    Fake Accounts
                    {_fakeSessionActive && (
                        <span style={{ color: "var(--status-danger)", fontSize: "12px", marginLeft: "8px" }}>
                            ● Active as {_fakeSessionUser?.username}
                        </span>
                    )}
                </Forms.FormTitle>
                <ModalCloseButton onClick={modalProps.onClose} />
            </ModalHeader>
            {/* ── Body ── */}
            <ModalContent>
                <div style={{ padding: "16px" }}>

                    {/* Tab bar row */}
                    <div style={{ display: "flex", alignItems: "center", marginBottom: "16px" }}>
                        <TabBar
                            type="top"
                            look="brand"
                            selectedItem={tab}
                            onItemSelect={(id: "id" | "manual") => setTab(id)}
                            style={{ flex: 1 }}
                        >
                            <TabBar.Item id="id">Fetch by User ID</TabBar.Item>
                            <TabBar.Item id="manual">Manual</TabBar.Item>
                        </TabBar>

                        {_fakeSessionActive && (
                            <Button
                                size={Button.Sizes.SMALL}
                                color={Button.Colors.RED}
                                style={{ marginLeft: "12px", flexShrink: 0 }}
                                onClick={() => { deactivateFakeSession(); setActiveId(null); }}
                            >
                                ✕ Exit Fake Session
                            </Button>
                        )}
                    </div>

                    {/* Fetch-by-ID input row */}
                    {tab === "id" && (
                        <div style={{ display: "flex", gap: "8px", alignItems: "center", marginBottom: "16px" }}>
                            <div style={{ flex: 1 }}>
                                <TextInput
                                    value={userId}
                                    placeholder="User ID (e.g. 1460553978973655155)"
                                    onChange={(v: string) => setUserId(v)}
                                />
                            </div>
                            <Button
                                size={Button.Sizes.MEDIUM}
                                color={Button.Colors.GREEN}
                                disabled={loading || !userId.trim()}
                                onClick={fetchAndAdd}
                            >
                                {loading ? "Fetching…" : "Add"}
                            </Button>
                        </div>
                    )}

                    {/* Manual input row */}
                    {tab === "manual" && (
                        <div style={{ display: "flex", gap: "8px", alignItems: "center", marginBottom: "16px" }}>
                            <div style={{ flex: 1 }}>
                                <TextInput
                                    value={manualUsername}
                                    placeholder="Username"
                                    onChange={(v: string) => setManualUsername(v)}
                                />
                            </div>
                            <div style={{ flex: 2 }}>
                                <TextInput
                                    value={manualAvatar}
                                    placeholder="Avatar URL or hash (optional)"
                                    onChange={(v: string) => setManualAvatar(v)}
                                />
                            </div>
                            <Button
                                size={Button.Sizes.MEDIUM}
                                color={Button.Colors.GREEN}
                                disabled={!manualUsername.trim()}
                                onClick={addManual}
                            >
                                Add
                            </Button>
                        </div>
                    )}

                    {/* Account list */}
                    <Forms.FormTitle tag="h5">Fake Accounts ({accounts.length})</Forms.FormTitle>
                    <div style={{ display: "flex", flexDirection: "column", gap: "8px", maxHeight: "300px", overflowY: "auto" }}>
                        {accounts.length === 0 && (
                            <Forms.FormText style={{ padding: "8px 0" }}>
                                No fake accounts added yet.
                            </Forms.FormText>
                        )}
                        {accounts.map(acc => {
                            const isActive = activeId === acc.id;
                            const statusLabel = acc.status ?? "unknown";
                            const customStatusText = acc.customStatus?.text || acc.customStatus?.emojiName;
                            return (
                                <div
                                    key={acc.id}
                                    style={{
                                        overflow: "hidden",
                                        backgroundColor: isActive
                                            ? "var(--background-modifier-selected)"
                                            : "var(--background-secondary)",
                                        borderRadius: "8px",
                                        border: `1px solid ${isActive
                                            ? "var(--brand-500)"
                                            : "var(--background-modifier-accent)"}`,
                                    }}
                                >
                                    <div
                                        style={{
                                            height: 56,
                                            backgroundImage: acc.banner ? `url(${getBannerUrl(acc)})` : undefined,
                                            backgroundColor: !acc.banner ? getBannerUrl(acc) : undefined,
                                            backgroundSize: "cover",
                                            backgroundPosition: "center",
                                        }}
                                    />
                                    <div style={{ display: "flex", alignItems: "center", padding: "10px 14px 12px", gap: "12px" }}>
                                        <div style={{ position: "relative", marginTop: -28, flexShrink: 0 }}>
                                            <img
                                                src={getAvatarUrl(acc, 48)}
                                                style={{ width: 48, height: 48, borderRadius: "50%", border: "4px solid var(--background-secondary)" }}
                                                onError={(e: any) => { e.target.src = "https://cdn.discordapp.com/embed/avatars/0.png"; }}
                                            />
                                            {acc.status && (
                                                <span
                                                    title={statusLabel}
                                                    style={{
                                                        position: "absolute",
                                                        right: 2,
                                                        bottom: 2,
                                                        width: 14,
                                                        height: 14,
                                                        borderRadius: "50%",
                                                        backgroundColor: getStatusColor(acc.status),
                                                        border: "3px solid var(--background-secondary)",
                                                    }}
                                                />
                                            )}
                                        </div>
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                            <div style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0 }}>
                                                <div style={{ fontWeight: 600, fontSize: "14px", color: "var(--header-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                                    {acc.globalName || acc.username}
                                                </div>
                                                {acc.clan?.tag && (
                                                    <span style={{
                                                        fontSize: "11px",
                                                        fontWeight: 700,
                                                        color: "var(--text-muted)",
                                                        backgroundColor: "var(--background-modifier-accent)",
                                                        borderRadius: "4px",
                                                        padding: "2px 6px",
                                                        flexShrink: 0,
                                                    }}>
                                                        {acc.clan.tag}
                                                    </span>
                                                )}
                                            </div>
                                            <div style={{ fontSize: "12px", color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                                @{acc.username} · {acc.id}
                                            </div>
                                            {(acc.profile?.pronouns || customStatusText) && (
                                                <div style={{ fontSize: "12px", color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: "2px" }}>
                                                    {acc.profile?.pronouns && <span>{acc.profile.pronouns}</span>}
                                                    {acc.profile?.pronouns && customStatusText && <span> · </span>}
                                                    {customStatusText && <span>{customStatusText}</span>}
                                                </div>
                                            )}
                                        </div>
                                        <Button
                                            size={Button.Sizes.SMALL}
                                            color={isActive ? Button.Colors.RED : Button.Colors.BRAND}
                                            onClick={() => {
                                                if (isActive) {
                                                    deactivateFakeSession();
                                                    setActiveId(null);
                                                } else {
                                                    activateFakeSession(acc);
                                                    setActiveId(acc.id);
                                                }
                                            }}
                                        >
                                            {isActive ? "Exit" : "Switch"}
                                        </Button>
                                        <Button
                                            size={Button.Sizes.SMALL}
                                            color={Button.Colors.RED}
                                            onClick={() => {
                                                if (isActive) { deactivateFakeSession(); setActiveId(null); }
                                                updateAccounts(accounts.filter(a => a.id !== acc.id));
                                            }}
                                        >
                                            Remove
                                        </Button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </ModalContent>

            {/* ── Footer ── */}
            <ModalFooter>
                <Button
                    color={Button.Colors.TRANSPARENT}
                    look={Button.Looks.FILLED}
                    onClick={modalProps.onClose}
                >
                    Close
                </Button>
            </ModalFooter>
        </ModalRoot>
    );
}

function handleKeyDown(e: KeyboardEvent) {
    if (e.altKey && e.key.toLowerCase() === "c") {
        openModal(modalProps => <FakeAccountModal modalProps={modalProps} />);
    }
}

export default definePlugin({
    name: "Fake Accounts",
    description: "Fake accounts to kaanseas",
    authors: [Devs.feelslove],
    settings,

    patches: [
        {
            find: "getIsValidatingUsers",
            replacement: {
                match: /getUsers\(\)\{return (\i)\}/,
                replace: "getUsers(){return $self.injectFakes($1)}"
            }
        },
        {
            // multiAccountUsers switch — userId ile geçiş yapılan yere hook at
            find: "multiAccountUsers",
            replacement: {
                match: /(\i)\.Mx\((\i)\)/,
                replace: "$self.handleSwitch($1.Mx.bind($1),$2)"
            }
        }
    ],

    start() {
        document.addEventListener("keydown", handleKeyDown);
    },

    stop() {
        document.removeEventListener("keydown", handleKeyDown);
        if (_fakeSessionActive) deactivateFakeSession();
    },

    injectFakes(realUsers: any): any {
        const fakes = parseFakeAccounts();
        if (!fakes.length || !UserClass) return realUsers ?? {};

        // getUsers() bir obje map ({id: UserObject}) döndürür, array değil
        const result = { ...(realUsers ?? {}) };
        for (const f of fakes) {
            const u = buildUserObject(f);
            if (!u) continue;
            u.tokenStatus = 2;
            u.pushSyncToken = null;
            result[f.id] = u;
        }
        return result;
    },

    handleSwitch(originalFn: (id: string) => void, userId: string) {
        const fakes = parseFakeAccounts();
        const acc = fakes.find(a => a.id === userId);
        if (acc) {
            // Fake hesap — kendi session yönetimimizi kullan
            activateFakeSession(acc);
        } else if (fakes.some(a => _fakeSessionActive && _fakeSessionUser?.id === userId)) {
            // Zaten aktif olan fake hesaba geçmeye çalışıyor
            Toasts.show({
                message: "Already active as this account.",
                id: "fakeaccount-alreadyactive",
                type: Toasts.Type.MESSAGE,
                options: { position: Toasts.Position.BOTTOM }
            });
        } else {
            // Gerçek hesap — fake session varsa kapat, sonra normal geçiş
            if (_fakeSessionActive) deactivateFakeSession();
            originalFn(userId);
        }
    }
});
