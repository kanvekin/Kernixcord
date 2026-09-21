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

// ─── Constants ────────────────────────────────────────────────────────────────

const CUSTOM_STATUS_TYPE = 4;

// ─── Lazy stores ──────────────────────────────────────────────────────────────

const UserStore         = findByPropsLazy("getCurrentUser", "getUser");
const GuildStore        = findByPropsLazy("getGuilds", "getGuildCount");
const GuildFolderStore  = findByPropsLazy("getGuildsTree", "getFlattenedGuildIds");
const ChannelStore      = findByPropsLazy("getSortedPrivateChannels", "getMutablePrivateChannels");
const RelationshipStore = findByPropsLazy("getRelationshipType", "getFriendCount");
const AuthStore         = findByPropsLazy("getId", "getToken");

// ─── UserClass (resolved async by webpack) ───────────────────────────────────

let UserClass: any = null;
waitFor(
    (m: any) => m?.prototype?.getAvatarURL && m?.prototype?.hasAvatarForGuild,
    (m: any) => { UserClass = m; }
);

// ─── GuildsTree helper ────────────────────────────────────────────────────────

let _GuildsTreeClass: any = null;
function getGuildsTreeClass() {
    if (!_GuildsTreeClass) {
        try { _GuildsTreeClass = GuildFolderStore.getGuildsTree().constructor; }
        catch { return null; }
    }
    return _GuildsTreeClass;
}

// ─── Settings ─────────────────────────────────────────────────────────────────
//
// accountIds : user-editable CSV  (e.g. "123,456,789")
// cachedData : JSON blob we write ourselves — NOT user-edited

const settings = definePluginSettings({
    accountIds: {
        description: "User IDs to impersonate, comma-separated (e.g. 123456789,987654321)",
        type: OptionType.STRING,
        default: "",
        onChange: () => { void syncAccounts(); }
    },
    cachedData: {
        description: "Cached account data (do not edit manually)",
        type: OptionType.STRING,
        default: "{}",
        hidden: true,
    }
});

// ─── Types ────────────────────────────────────────────────────────────────────

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

// ─── Safe helpers ─────────────────────────────────────────────────────────────

/** BigInt tabanlı default avatar indexi — geçersiz ID'de crash vermez */
function safeDefaultAvatarIndex(id: string): number {
    try {
        if (!/^\d+$/.test(id)) return 0;
        return Number(BigInt(id) % 6n);
    } catch {
        return 0;
    }
}

function getAvatarUrl(acc: FakeAccount, size = 48): string {
    if (acc.avatar) return `https://cdn.discordapp.com/avatars/${acc.id}/${acc.avatar}.webp?size=${size}`;
    return `https://cdn.discordapp.com/embed/avatars/${safeDefaultAvatarIndex(acc.id)}.png`;
}

function getBannerBackground(acc: FakeAccount): React.CSSProperties {
    if (acc.banner)
        return { backgroundImage: `url(https://cdn.discordapp.com/banners/${acc.id}/${acc.banner}.webp?size=300)`, backgroundSize: "cover", backgroundPosition: "center" };
    if (acc.bannerColor)
        return { backgroundColor: acc.bannerColor };
    if (acc.accentColor != null) {
        try { return { backgroundColor: `#${acc.accentColor.toString(16).padStart(6, "0")}` }; }
        catch { /* fall through */ }
    }
    return { backgroundColor: "var(--background-secondary-alt)" };
}

function getStatusColor(status?: string) {
    switch (status) {
        case "online": return "var(--status-positive)";
        case "idle":   return "var(--status-warning)";
        case "dnd":    return "var(--status-danger)";
        default:       return "var(--status-offline)";
    }
}

// ─── Cache helpers ────────────────────────────────────────────────────────────

function loadCache(): Record<string, FakeAccount> {
    try { return JSON.parse(settings.store.cachedData) ?? {}; }
    catch { return {}; }
}

function saveCache(cache: Record<string, FakeAccount>) {
    try { settings.store.cachedData = JSON.stringify(cache); }
    catch { /* silently ignore */ }
}

function getIdsFromSettings(): string[] {
    return (settings.store.accountIds ?? "")
        .split(",")
        .map(s => s.trim())
        .filter(s => /^\d{17,20}$/.test(s));
}

function addIdToSettings(id: string) {
    const current = getIdsFromSettings();
    if (current.includes(id)) return;
    const raw = settings.store.accountIds ?? "";
    settings.store.accountIds = raw.trim()
        ? raw.trim() + "," + id
        : id;
}

// ─── Normalize ────────────────────────────────────────────────────────────────

function normalizeAccount(acc: FakeAccount): FakeAccount {
    return {
        ...acc,
        profile: {
            bio:         acc.profile?.bio         ?? "",
            pronouns:    acc.profile?.pronouns    ?? "",
            themeColors: acc.profile?.themeColors ?? null,
        },
        customStatus: acc.customStatus ?? null,
        clan:         acc.clan         ?? null,
    };
}

// ─── Fetch from Discord API ───────────────────────────────────────────────────

async function fetchAccount(id: string): Promise<FakeAccount | null> {
    try {
        const res = await RestAPI.get({
            url: `/users/${id}/profile`,
            query: { with_mutual_guilds: false, with_mutual_friends_count: false }
        });
        const body        = res.body ?? res;
        const user        = body.user ?? body;
        const userProfile = body.user_profile ?? {};

        // Presence from real store (best-effort, non-fatal)
        let status: string | undefined;
        let customStatus: FakeAccountCustomStatus | null = null;
        try {
            status = PresenceStore.getStatus(user.id) || undefined;
            const customAct = (PresenceStore.getActivities(user.id) ?? []).find((a: any) => a.type === CUSTOM_STATUS_TYPE);
            customStatus = customAct
                ? { text: customAct.state ?? "", emojiId: customAct.emoji?.id, emojiName: customAct.emoji?.name }
                : null;
        } catch { /* presence not critical */ }

        return normalizeAccount({
            id:            user.id,
            username:      user.username,
            discriminator: user.discriminator ?? "0",
            avatar:        user.avatar        ?? null,
            globalName:    user.global_name   ?? user.globalName ?? user.username,
            banner:        user.banner        ?? null,
            bannerColor:   user.banner_color  ?? user.bannerColor  ?? null,
            accentColor:   user.accent_color  ?? user.accentColor  ?? null,
            clan:          user.clan ?? user.primary_guild ?? null,
            premiumType:   body.premium_type  ?? user.premium_type ?? null,
            premiumSince:  body.premium_since ?? null,
            profile: {
                bio:         userProfile.bio        ?? user.bio ?? "",
                pronouns:    userProfile.pronouns   ?? "",
                themeColors: userProfile.theme_colors ?? userProfile.themeColors ?? null,
            },
            status,
            customStatus,
        });
    } catch {
        return null;
    }
}

// ─── Sync: fetch all IDs from settings, update cache ─────────────────────────

let _syncInProgress = false;
const _onSyncCallbacks = new Set<() => void>();

export async function syncAccounts() {
    if (_syncInProgress) return;
    _syncInProgress = true;

    const ids   = getIdsFromSettings();
    const cache = loadCache();
    let changed = false;

    // Remove IDs that were deleted from settings
    for (const cachedId of Object.keys(cache)) {
        if (!ids.includes(cachedId)) {
            delete cache[cachedId];
            changed = true;
        }
    }

    // Fetch IDs that are new (not yet cached)
    for (const id of ids) {
        if (!cache[id]) {
            const acc = await fetchAccount(id);
            if (acc) { cache[id] = acc; changed = true; }
        }
    }

    if (changed) saveCache(cache);
    _syncInProgress = false;
    _onSyncCallbacks.forEach(cb => { try { cb(); } catch { /* */ } });
}

export function getCachedAccounts(): FakeAccount[] {
    const cache = loadCache();
    return getIdsFromSettings()
        .map(id => cache[id])
        .filter(Boolean) as FakeAccount[];
}

// ─── Session state ────────────────────────────────────────────────────────────

const _originals: Record<string, any> = {};
let _fakeSessionActive = false;
let _fakeSessionUser:   FakeAccount | null = null;

// ─── Build Discord UserObject ─────────────────────────────────────────────────

function buildUserObject(acc: FakeAccount): any | null {
    if (!UserClass) return null;
    try {
        return new UserClass({
            id:                    acc.id,
            username:              acc.username,
            discriminator:         acc.discriminator ?? "0",
            avatar:                acc.avatar       ?? null,
            global_name:           acc.globalName   ?? acc.username,
            banner:                acc.banner       ?? null,
            banner_color:          acc.bannerColor  ?? null,
            accent_color:          acc.accentColor  ?? null,
            bio:                   acc.profile?.bio ?? "",
            clan:                  acc.clan         ?? null,
            primary_guild:         acc.clan         ?? null,
            verified:              true,
            email:                 "fake@fake.com",
            has_bounced_email:     false,
            bot:                   false,
            system:                false,
            mfa_enabled:           false,
            mobile:                false,
            desktop:               true,
            premium_type:          acc.premiumType  ?? null,
            flags:                 0,
            public_flags:          0,
            purchased_flags:       0,
            premium_usage_flags:   0,
            phone:                 null,
            nsfw_allowed:          true,
            personal_connection_id:null,
        });
    } catch (e) {
        console.error("[FakeAccounts] buildUserObject failed:", e);
        return null;
    }
}

// ─── Profile / presence builders ─────────────────────────────────────────────

function getStoredCustomStatus(acc: FakeAccount) {
    if (!acc.customStatus?.text && !acc.customStatus?.emojiName && !acc.customStatus?.emojiId) return null;
    const emoji = acc.customStatus.emojiId
        ? { id: acc.customStatus.emojiId, name: acc.customStatus.emojiName ?? "" }
        : acc.customStatus.emojiName
            ? { name: acc.customStatus.emojiName }
            : undefined;
    return { type: CUSTOM_STATUS_TYPE, state: acc.customStatus.text ?? "", emoji };
}

function buildProfileResponse(acc: FakeAccount, fakeUser: any) {
    return {
        body: {
            user: {
                id:           acc.id,
                username:     acc.username,
                discriminator:acc.discriminator ?? "0",
                avatar:       acc.avatar       ?? null,
                global_name:  acc.globalName   ?? acc.username,
                banner:       acc.banner       ?? null,
                banner_color: acc.bannerColor  ?? null,
                accent_color: acc.accentColor  ?? null,
                bio:          acc.profile?.bio ?? "",
                clan:         acc.clan         ?? null,
                primary_guild:acc.clan         ?? null,
            },
            user_profile: {
                bio:          acc.profile?.bio         ?? "",
                pronouns:     acc.profile?.pronouns    ?? "",
                theme_colors: acc.profile?.themeColors ?? null,
            },
            badges:              [],
            guild_badges:        [],
            connected_accounts:  [],
            mutual_guilds:       [],
            premium_since:       acc.premiumSince ?? null,
            premium_type:        acc.premiumType  ?? null,
            premium_guild_since: null,
        }
    };
}

function buildStoredUserProfile(acc: FakeAccount, fakeUser: any) {
    return {
        userId:            acc.id,
        user:              fakeUser,
        bio:               acc.profile?.bio         ?? "",
        pronouns:          acc.profile?.pronouns    ?? "",
        themeColors:       acc.profile?.themeColors ?? null,
        banner:            acc.banner      ?? null,
        bannerColor:       acc.bannerColor ?? null,
        accentColor:       acc.accentColor ?? null,
        premiumType:       acc.premiumType  ?? null,
        premiumSince:      acc.premiumSince ?? null,
        badges:            [],
        connectedAccounts: [],
        guildId:           undefined,
    };
}

function isFakeProfileRequest(url: string | undefined, userId: string) {
    if (!url) return false;
    return url === `/users/${userId}/profile`
        || url.startsWith(`/users/${userId}/profile?`)
        || url === "/users/@me/profile"
        || url.startsWith("/users/@me/profile?");
}

// ─── Activate / Deactivate ────────────────────────────────────────────────────

export function activateFakeSession(acc: FakeAccount) {
    if (_fakeSessionActive) deactivateFakeSession();

    if (!UserClass) {
        let tries = 0;
        const t = setInterval(() => {
            tries++;
            if (UserClass) { clearInterval(t); activateFakeSession(acc); }
            else if (tries >= 15) {
                clearInterval(t);
                Toasts.show({ message: "FakeAccounts: UserClass unavailable, try again.", id: "fa-noclass", type: Toasts.Type.FAILURE, options: { position: Toasts.Position.BOTTOM } });
            }
        }, 200);
        return;
    }

    const fakeUser = buildUserObject(acc);
    if (!fakeUser) {
        Toasts.show({ message: "FakeAccounts: failed to build user object.", id: "fa-noobj", type: Toasts.Type.FAILURE, options: { position: Toasts.Position.BOTTOM } });
        return;
    }

    _fakeSessionActive = true;
    _fakeSessionUser   = acc;

    const GuildsTreeClass = getGuildsTreeClass();

    // UserStore — kendi profil tıklaması dahil her getCurrentUser çağrısı fakeUser döner
    _originals.getCurrentUser = UserStore.getCurrentUser.bind(UserStore);
    UserStore.getCurrentUser  = () => fakeUser;

    // AuthStore (ID)
    _originals.getId = AuthStore.getId.bind(AuthStore);
    AuthStore.getId  = () => acc.id;

    // GuildFolderStore → boş sunucu listesi
    _originals.getGuildsTree = GuildFolderStore.getGuildsTree.bind(GuildFolderStore);
    if (GuildsTreeClass) GuildFolderStore.getGuildsTree = () => { try { return new GuildsTreeClass(); } catch { return _originals.getGuildsTree(); } };

    _originals.getFlattenedGuildIds = GuildFolderStore.getFlattenedGuildIds.bind(GuildFolderStore);
    GuildFolderStore.getFlattenedGuildIds = () => [];

    _originals.getFlattenedGuildFolderList = GuildFolderStore.getFlattenedGuildFolderList.bind(GuildFolderStore);
    GuildFolderStore.getFlattenedGuildFolderList = () => [];

    _originals.getGuildFolders = GuildFolderStore.getGuildFolders.bind(GuildFolderStore);
    GuildFolderStore.getGuildFolders = () => [];

    // GuildStore
    _originals.getGuildCount = GuildStore.getGuildCount.bind(GuildStore);
    GuildStore.getGuildCount = () => 0;

    // ChannelStore → boş DM listesi
    _originals.getSortedPrivateChannels = ChannelStore.getSortedPrivateChannels.bind(ChannelStore);
    ChannelStore.getSortedPrivateChannels = () => [];

    _originals.getMutablePrivateChannels = ChannelStore.getMutablePrivateChannels.bind(ChannelStore);
    ChannelStore.getMutablePrivateChannels = () => ({});

    // RelationshipStore → boş arkadaş listesi
    _originals.getFriendCount = RelationshipStore.getFriendCount.bind(RelationshipStore);
    RelationshipStore.getFriendCount = () => 0;

    _originals.getFriendIDs = RelationshipStore.getFriendIDs.bind(RelationshipStore);
    RelationshipStore.getFriendIDs = () => [];

    _originals.getMutableRelationships = RelationshipStore.getMutableRelationships.bind(RelationshipStore);
    RelationshipStore.getMutableRelationships = () => new Map();

    _originals.getRelationshipType = RelationshipStore.getRelationshipType.bind(RelationshipStore);
    RelationshipStore.getRelationshipType = () => 0;

    // UserProfileStore — profil modalı bu üzerinden çalışıyor
    // Sol alt profil tıklaması da buraya gelir: güvenli bir şekilde handle et
    _originals.getUserProfile = UserProfileStore.getUserProfile.bind(UserProfileStore);
    UserProfileStore.getUserProfile = function (userId: string) {
        try {
            if (userId === acc.id) return buildStoredUserProfile(acc, fakeUser);
            return _originals.getUserProfile.call(this, userId);
        } catch {
            return null;
        }
    };

    // PresenceStore
    _originals.getStatus = PresenceStore.getStatus.bind(PresenceStore);
    PresenceStore.getStatus = function (userId: string) {
        try {
            if (userId === acc.id && acc.status) return acc.status;
            return _originals.getStatus.call(this, userId);
        } catch { return "offline"; }
    };

    _originals.getActivities = PresenceStore.getActivities.bind(PresenceStore);
    PresenceStore.getActivities = function (userId: string) {
        try {
            if (userId === acc.id) {
                const cs   = getStoredCustomStatus(acc);
                const rest = (_originals.getActivities.call(this, userId) ?? []).filter((a: any) => a.type !== CUSTOM_STATUS_TYPE);
                return cs ? [cs, ...rest] : rest;
            }
            return _originals.getActivities.call(this, userId);
        } catch { return []; }
    };

    // RestAPI.get — profil endpoint'ini intercept et
    _originals.restGet = RestAPI.get.bind(RestAPI);
    RestAPI.get = async function (req: any, ...args: any[]) {
        try {
            if (isFakeProfileRequest(req?.url, acc.id)) return buildProfileResponse(acc, fakeUser);
            return _originals.restGet.call(this, req, ...args);
        } catch (e) {
            return _originals.restGet.call(this, req, ...args);
        }
    };

    Toasts.show({ message: `Switched to ${acc.globalName ?? acc.username}`, id: "fa-switch", type: Toasts.Type.SUCCESS, options: { position: Toasts.Position.BOTTOM } });
}

export function deactivateFakeSession() {
    if (!_fakeSessionActive) return;

    const restore = (store: any, key: string) => {
        try { if (_originals[key]) store[key] = _originals[key]; } catch { /* */ }
    };

    restore(UserStore,         "getCurrentUser");
    restore(AuthStore,         "getId");
    restore(GuildFolderStore,  "getGuildsTree");
    restore(GuildFolderStore,  "getFlattenedGuildIds");
    restore(GuildFolderStore,  "getFlattenedGuildFolderList");
    restore(GuildFolderStore,  "getGuildFolders");
    restore(GuildStore,        "getGuildCount");
    restore(ChannelStore,      "getSortedPrivateChannels");
    restore(ChannelStore,      "getMutablePrivateChannels");
    restore(RelationshipStore, "getFriendCount");
    restore(RelationshipStore, "getFriendIDs");
    restore(RelationshipStore, "getMutableRelationships");
    restore(RelationshipStore, "getRelationshipType");
    restore(UserProfileStore,  "getUserProfile");
    restore(PresenceStore,     "getStatus");
    restore(PresenceStore,     "getActivities");
    if (_originals.restGet) { try { RestAPI.get = _originals.restGet; } catch { /* */ } }

    Object.keys(_originals).forEach(k => delete _originals[k]);
    _fakeSessionActive = false;
    _fakeSessionUser   = null;

    Toasts.show({ message: "Switched back to real account", id: "fa-restore", type: Toasts.Type.SUCCESS, options: { position: Toasts.Position.BOTTOM } });
}

// ─── Modal ────────────────────────────────────────────────────────────────────

function FakeAccountModal({ modalProps }: { modalProps: ModalProps; }) {
    const [accounts, setAccounts] = React.useState<FakeAccount[]>(getCachedAccounts);
    const [activeId, setActiveId] = React.useState<string | null>(_fakeSessionUser?.id ?? null);
    const [syncing,  setSyncing]  = React.useState(false);
    const [addId,    setAddId]    = React.useState("");
    const [adding,   setAdding]   = React.useState(false);

    // Re-render when background sync finishes
    React.useEffect(() => {
        const cb = () => setAccounts(getCachedAccounts());
        _onSyncCallbacks.add(cb);
        return () => { _onSyncCallbacks.delete(cb); };
    }, []);

    const handleAdd = async () => {
        const id = addId.trim();
        if (!/^\d{17,20}$/.test(id)) {
            Toasts.show({ message: "Invalid ID format.", id: "fa-badid", type: Toasts.Type.FAILURE, options: { position: Toasts.Position.BOTTOM } });
            return;
        }
        if (getCachedAccounts().some(a => a.id === id)) {
            Toasts.show({ message: "Already added.", id: "fa-dup", type: Toasts.Type.FAILURE, options: { position: Toasts.Position.BOTTOM } });
            return;
        }
        setAdding(true);
        const acc = await fetchAccount(id);
        if (!acc) {
            Toasts.show({ message: "Could not fetch user. Check the ID.", id: "fa-fetchfail", type: Toasts.Type.FAILURE, options: { position: Toasts.Position.BOTTOM } });
            setAdding(false);
            return;
        }
        // Add to settings CSV and cache
        addIdToSettings(id);
        const cache = loadCache();
        cache[id] = acc;
        saveCache(cache);
        setAccounts(getCachedAccounts());
        setAddId("");
        setAdding(false);
        Toasts.show({ message: `Added ${acc.globalName ?? acc.username}`, id: "fa-added", type: Toasts.Type.SUCCESS, options: { position: Toasts.Position.BOTTOM } });
    };

    const handleRefresh = async () => {
        setSyncing(true);
        const ids   = getIdsFromSettings();
        const fresh: Record<string, FakeAccount> = {};
        for (const id of ids) {
            const acc = await fetchAccount(id);
            if (acc) fresh[id] = acc;
        }
        saveCache(fresh);
        setAccounts(getCachedAccounts());
        setSyncing(false);
        Toasts.show({ message: `Refreshed ${Object.keys(fresh).length} account(s)`, id: "fa-refresh", type: Toasts.Type.SUCCESS, options: { position: Toasts.Position.BOTTOM } });
    };

    const handleRemove = (id: string) => {
        // Remove from settings CSV
        const newIds = getIdsFromSettings().filter(i => i !== id);
        settings.store.accountIds = newIds.join(",");
        // Remove from cache
        const cache = loadCache();
        delete cache[id];
        saveCache(cache);
        // If active, exit session
        if (activeId === id) { deactivateFakeSession(); setActiveId(null); }
        setAccounts(getCachedAccounts());
    };

    return (
        <ModalRoot {...modalProps} size={ModalSize.MEDIUM}>

            {/* Header */}
            <ModalHeader separator>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"
                    style={{ marginRight: 8, flexShrink: 0, color: "var(--interactive-normal)" }}>
                    <path d="M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10zm0 2c-5.33 0-8 2.67-8 4v1h16v-1c0-1.33-2.67-4-8-4z" />
                </svg>
                <Forms.FormTitle tag="h4" style={{ margin: 0, flex: 1 }}>
                    Fake Accounts
                    {_fakeSessionActive && (
                        <span style={{ color: "var(--status-danger)", fontSize: 12, marginLeft: 8 }}>
                            ● {_fakeSessionUser?.globalName ?? _fakeSessionUser?.username}
                        </span>
                    )}
                </Forms.FormTitle>
                <ModalCloseButton onClick={modalProps.onClose} />
            </ModalHeader>

            {/* Body */}
            <ModalContent>
                <div style={{ padding: 16 }}>

                    {/* Add by ID row */}
                    <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
                        <div style={{ flex: 1 }}>
                            <TextInput
                                value={addId}
                                placeholder="Add by User ID (e.g. 123456789012345678)"
                                onChange={(v: string) => setAddId(v)}
                                onKeyDown={(e: React.KeyboardEvent) => { if (e.key === "Enter") handleAdd(); }}
                            />
                        </div>
                        <Button
                            size={Button.Sizes.MEDIUM}
                            color={Button.Colors.GREEN}
                            disabled={adding || !addId.trim()}
                            onClick={handleAdd}
                        >
                            {adding ? "Adding…" : "Add"}
                        </Button>
                        <Button
                            size={Button.Sizes.MEDIUM}
                            color={Button.Colors.PRIMARY}
                            disabled={syncing}
                            onClick={handleRefresh}
                        >
                            {syncing ? "…" : "↺"}
                        </Button>
                        {_fakeSessionActive && (
                            <Button
                                size={Button.Sizes.MEDIUM}
                                color={Button.Colors.RED}
                                onClick={() => { deactivateFakeSession(); setActiveId(null); }}
                            >
                                ✕ Exit
                            </Button>
                        )}
                    </div>

                    {/* Account list */}
                    {accounts.length === 0
                        ? (
                            <div style={{ padding: "32px 16px", textAlign: "center", color: "var(--text-muted)", backgroundColor: "var(--background-secondary)", borderRadius: 8 }}>
                                <div style={{ fontSize: 32, marginBottom: 8 }}>👤</div>
                                <Forms.FormText>No accounts yet. Enter a User ID above or add IDs in plugin settings.</Forms.FormText>
                            </div>
                        )
                        : (
                            <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 340, overflowY: "auto" }}>
                                {accounts.map(acc => {
                                    const isActive         = activeId === acc.id;
                                    const customStatusText = acc.customStatus?.text || acc.customStatus?.emojiName;
                                    return (
                                        <div key={acc.id} style={{
                                            overflow: "hidden", borderRadius: 8,
                                            border: `1px solid ${isActive ? "var(--brand-500)" : "var(--background-modifier-accent)"}`,
                                            backgroundColor: isActive ? "var(--background-modifier-selected)" : "var(--background-secondary)",
                                        }}>
                                            {/* Banner */}
                                            <div style={{ height: 52, ...getBannerBackground(acc) }} />

                                            {/* Content */}
                                            <div style={{ display: "flex", alignItems: "center", padding: "8px 12px 10px", gap: 12 }}>

                                                {/* Avatar */}
                                                <div style={{ position: "relative", marginTop: -24, flexShrink: 0 }}>
                                                    <img
                                                        src={getAvatarUrl(acc)}
                                                        style={{ width: 44, height: 44, borderRadius: "50%", border: "3px solid var(--background-secondary)", display: "block" }}
                                                        onError={(e: any) => { e.currentTarget.src = "https://cdn.discordapp.com/embed/avatars/0.png"; }}
                                                    />
                                                    {acc.status && (
                                                        <span title={acc.status} style={{
                                                            position: "absolute", right: 1, bottom: 1,
                                                            width: 12, height: 12, borderRadius: "50%",
                                                            backgroundColor: getStatusColor(acc.status),
                                                            border: "2px solid var(--background-secondary)",
                                                        }} />
                                                    )}
                                                </div>

                                                {/* Text */}
                                                <div style={{ flex: 1, minWidth: 0 }}>
                                                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                                        <span style={{ fontWeight: 600, fontSize: 14, color: "var(--header-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                                            {acc.globalName || acc.username}
                                                        </span>
                                                        {acc.clan?.tag && (
                                                            <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", backgroundColor: "var(--background-modifier-accent)", borderRadius: 4, padding: "1px 5px", flexShrink: 0 }}>
                                                                {acc.clan.tag}
                                                            </span>
                                                        )}
                                                    </div>
                                                    <div style={{ fontSize: 12, color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                                        @{acc.username} · {acc.id}
                                                    </div>
                                                    {(acc.profile?.pronouns || customStatusText) && (
                                                        <div style={{ fontSize: 12, color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: 1 }}>
                                                            {acc.profile?.pronouns}
                                                            {acc.profile?.pronouns && customStatusText ? " · " : ""}
                                                            {customStatusText}
                                                        </div>
                                                    )}
                                                </div>

                                                {/* Buttons */}
                                                <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                                                    <Button
                                                        size={Button.Sizes.SMALL}
                                                        color={isActive ? Button.Colors.RED : Button.Colors.BRAND}
                                                        onClick={() => {
                                                            if (isActive) { deactivateFakeSession(); setActiveId(null); }
                                                            else          { activateFakeSession(acc); setActiveId(acc.id); }
                                                        }}
                                                    >
                                                        {isActive ? "Exit" : "Switch"}
                                                    </Button>
                                                    <Button
                                                        size={Button.Sizes.SMALL}
                                                        color={Button.Colors.RED}
                                                        onClick={() => handleRemove(acc.id)}
                                                    >
                                                        ✕
                                                    </Button>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )
                    }
                </div>
            </ModalContent>

            {/* Footer */}
            <ModalFooter>
                <Button color={Button.Colors.TRANSPARENT} look={Button.Looks.FILLED} onClick={modalProps.onClose}>
                    Close
                </Button>
            </ModalFooter>
        </ModalRoot>
    );
}

// ─── Keyboard shortcut ────────────────────────────────────────────────────────

function handleKeyDown(e: KeyboardEvent) {
    if (e.altKey && e.key.toLowerCase() === "c") {
        openModal(props => <FakeAccountModal modalProps={props} />);
    }
}

// ─── Plugin ───────────────────────────────────────────────────────────────────

export default definePlugin({
    name: "Fake Accounts",
    description: "Impersonate other accounts locally. Add IDs in settings or via Alt+C panel.",
    authors: [Devs.feelslove],
    settings,

    patches: [
        {
            // Inject fake users into the multi-account switcher list
            find: "getIsValidatingUsers",
            replacement: {
                match: /getUsers\(\)\{return (\i)\}/,
                replace: "getUsers(){return $self.injectFakes($1)}"
            }
        },
        {
            // Intercept the switch call; keep analytics, redirect Mx to our handler
            find: "multiAccountUsers",
            replacement: {
                match: /(\w+)\.default\.track\((\w+)\.HAw\.MULTI_ACCOUNT_SWITCH_ATTEMPT[^)]+\),(\w+)\.Mx\((\w+)\)/,
                replace: "$1.default.track($2.HAw.MULTI_ACCOUNT_SWITCH_ATTEMPT,{location:{section:$2.JJy.USER_PROFILE}}),$self.handleSwitch($3.Mx.bind($3),$4)"
            }
        }
    ],

    start() {
        document.addEventListener("keydown", handleKeyDown);
        void syncAccounts();
    },

    stop() {
        document.removeEventListener("keydown", handleKeyDown);
        if (_fakeSessionActive) deactivateFakeSession();
    },

    // getUsers() returns an ARRAY — spread fakes into it
    injectFakes(realUsers: any): any {
        if (!UserClass) return realUsers ?? [];
        const accounts = getCachedAccounts();
        if (!accounts.length) return realUsers ?? [];

        const fakeObjects = accounts.map(acc => {
            try {
                const u = buildUserObject(acc);
                if (!u) return null;
                u.tokenStatus   = 2;    // "logged in" slot in switcher
                u.pushSyncToken = null; // required field shape
                return u;
            } catch { return null; }
        }).filter(Boolean);

        return [...(Array.isArray(realUsers) ? realUsers : []), ...fakeObjects];
    },

    // Route fake IDs to our session handler
    handleSwitch(originalFn: (id: string) => void, userId: string) {
        const accounts = getCachedAccounts();
        const acc      = accounts.find(a => a.id === userId);

        if (acc) {
            activateFakeSession(acc);
        } else {
            if (_fakeSessionActive) deactivateFakeSession();
            originalFn(userId);
        }
    }
});
