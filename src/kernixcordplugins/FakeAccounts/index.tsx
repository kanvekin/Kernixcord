/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import {
    ModalCloseButton, ModalContent, ModalFooter, ModalHeader,
    ModalRoot, ModalSize, ModalProps, openModal
} from "@utils/modal";
import definePlugin, { OptionType } from "@utils/types";
import { findByPropsLazy, waitFor } from "@webpack";
import {
    Button, Forms, React, RestAPI, TextInput,
    Toasts, PresenceStore, UserProfileStore
} from "@webpack/common";
import { Devs } from "@utils/constants";

// ─── Constants ────────────────────────────────────────────────────────────────

const CUSTOM_STATUS_TYPE = 4;

// ─── Lazy stores ──────────────────────────────────────────────────────────────

const UserStore = findByPropsLazy("getCurrentUser", "getUser");
const GuildStore = findByPropsLazy("getGuilds", "getGuildCount");
const GuildFolderStore = findByPropsLazy("getGuildsTree", "getFlattenedGuildIds");
const ChannelStore = findByPropsLazy("getSortedPrivateChannels", "getMutablePrivateChannels");
const RelationshipStore = findByPropsLazy("getRelationshipType", "getFriendCount");
const AuthStore = findByPropsLazy("getId", "getToken");

const FluxDispatcher = findByPropsLazy("dispatch", "subscribe", "unsubscribe");


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
// accountIds : user-editable, comma-separated IDs
// cachedData : JSON blob we manage — hidden from user

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

// ─── Safe utilities ───────────────────────────────────────────────────────────

function safeAvatarIndex(id: string): number {
    try {
        if (!/^\d+$/.test(id)) return 0;
        return Number(BigInt(id) % 6n);
    } catch { return 0; }
}

function getAvatarUrl(acc: FakeAccount, size = 48): string {
    if (acc.avatar)
        return `https://cdn.discordapp.com/avatars/${acc.id}/${acc.avatar}.webp?size=${size}`;
    return `https://cdn.discordapp.com/embed/avatars/${safeAvatarIndex(acc.id)}.png`;
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
        case "idle": return "var(--status-warning)";
        case "dnd": return "var(--status-danger)";
        default: return "var(--status-offline)";
    }
}

// ─── Cache helpers ────────────────────────────────────────────────────────────

function loadCache(): Record<string, FakeAccount> {
    try { return JSON.parse(settings.store.cachedData) ?? {}; }
    catch { return {}; }
}

function saveCache(cache: Record<string, FakeAccount>) {
    try { settings.store.cachedData = JSON.stringify(cache); } catch { /* */ }
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
    const raw = (settings.store.accountIds ?? "").trim();
    settings.store.accountIds = raw ? raw + "," + id : id;
}

export function getCachedAccounts(): FakeAccount[] {
    const cache = loadCache();
    return getIdsFromSettings().map(id => cache[id]).filter(Boolean) as FakeAccount[];
}

// ─── Normalize ────────────────────────────────────────────────────────────────

function normalize(acc: FakeAccount): FakeAccount {
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

// ─── Fetch from API ───────────────────────────────────────────────────────────

async function fetchAccount(id: string): Promise<FakeAccount | null> {
    try {
        const res = await RestAPI.get({ url: `/users/${id}/profile`, query: { with_mutual_guilds: false, with_mutual_friends_count: false } });
        const body = res.body ?? res;
        const user = body.user ?? body;
        const prof = body.user_profile ?? {};

        let status: string | undefined;
        let customStatus: FakeAccountCustomStatus | null = null;
        try {
            status = PresenceStore.getStatus(user.id) || undefined;
            const cAct = (PresenceStore.getActivities(user.id) ?? []).find((a: any) => a.type === CUSTOM_STATUS_TYPE);
            customStatus = cAct ? { text: cAct.state ?? "", emojiId: cAct.emoji?.id, emojiName: cAct.emoji?.name } : null;
        } catch { /* presence optional */ }

        return normalize({
            id: user.id,
            username: user.username,
            discriminator: user.discriminator ?? "0",
            avatar: user.avatar ?? null,
            globalName: user.global_name ?? user.globalName ?? user.username,
            banner: user.banner ?? null,
            bannerColor: user.banner_color ?? user.bannerColor ?? null,
            accentColor: user.accent_color ?? user.accentColor ?? null,
            clan: user.clan ?? user.primary_guild ?? null,
            premiumType: body.premium_type ?? user.premium_type ?? null,
            premiumSince: body.premium_since ?? null,
            profile: {
                bio: prof.bio ?? user.bio ?? "",
                pronouns: prof.pronouns ?? "",
                themeColors: prof.theme_colors ?? prof.themeColors ?? null,
            },
            status,
            customStatus,
        });
    } catch { return null; }
}

// ─── Sync ─────────────────────────────────────────────────────────────────────

let _syncInProgress = false;
const _onSyncCallbacks = new Set<() => void>();

export async function syncAccounts() {
    if (_syncInProgress) return;
    _syncInProgress = true;

    const ids = getIdsFromSettings();
    const cache = loadCache();
    let changed = false;

    for (const cachedId of Object.keys(cache)) {
        if (!ids.includes(cachedId)) { delete cache[cachedId]; changed = true; }
    }
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

// ─── Session state ────────────────────────────────────────────────────────────

const _orig: Record<string, any> = {};
let _active = false;
let _activeAcc: FakeAccount | null = null;
let _activeFakeUser: any = null;  // keep for profile response building

// ─── Build UserClass instance ─────────────────────────────────────────────────

function buildUserObject(acc: FakeAccount): any | null {
    if (!UserClass) return null;
    try {
        const user = new UserClass({
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
            primary_guild: acc.clan ?? null,
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
        });

        // Ensure critical methods exist - wrap them safely
        const originalGetAvatarURL = user.getAvatarURL;
        user.getAvatarURL = function (...args: any[]) {
            try { return originalGetAvatarURL.apply(this, args); }
            catch { return getAvatarUrl(acc, args[1] || 80); }
        };

        const originalHasAvatarForGuild = user.hasAvatarForGuild;
        user.hasAvatarForGuild = function (...args: any[]) {
            try { return originalHasAvatarForGuild.apply(this, args); }
            catch { return false; }
        };

        return user;
    } catch (e) {
        console.error("[FakeAccounts] buildUserObject failed:", e);
        return null;
    }
}

// ─── Profile/presence builders ────────────────────────────────────────────────

function getStoredCustomStatus(acc: FakeAccount) {
    if (!acc.customStatus?.text && !acc.customStatus?.emojiName && !acc.customStatus?.emojiId) return null;
    const emoji = acc.customStatus.emojiId
        ? { id: acc.customStatus.emojiId, name: acc.customStatus.emojiName ?? "" }
        : acc.customStatus.emojiName ? { name: acc.customStatus.emojiName } : undefined;
    return { type: CUSTOM_STATUS_TYPE, state: acc.customStatus.text ?? "", emoji };
}

/**
 * Builds the REST API profile response.
 * CRITICAL: body.user MUST be a UserClass instance (not a plain object),
 * because Discord code calls .getAvatarURL() etc. on it when opening profile modals.
 */
function buildProfileResponse(acc: FakeAccount, fakeUser: any) {
    return {
        body: {
            // fakeUser is a UserClass instance — Discord can call methods on it safely
            user: fakeUser,
            user_profile: {
                bio: acc.profile?.bio ?? "",
                pronouns: acc.profile?.pronouns ?? "",
                theme_colors: acc.profile?.themeColors ?? null,
                accent_color: acc.accentColor ?? null,
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

/**
 * Builds the UserProfileStore profile object.
 * FakeProfile plugin's profileDecodeHook will also run on this — it must
 * be a valid profile shape with no undefined method calls.
 */
function buildStoredProfile(acc: FakeAccount, fakeUser: any) {
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
        premiumGuildSince: null,
        profileEffectId: undefined,
        badges: [],
        guildBadges: [],
        connectedAccounts: [],
        mutualGuilds: [],
        guildId: undefined,
        // Methods that FakeProfile/Discord might call — return safe defaults
        application: null,
        legacyUsername: null,
    };
}

function isFakeProfileRequest(url: string | undefined, userId: string) {
    if (!url) return false;
    return url === `/users/${userId}/profile`
        || url.startsWith(`/users/${userId}/profile?`)
        || url === "/users/@me/profile"
        || url.startsWith("/users/@me/profile?");
}

// ─── Activate ─────────────────────────────────────────────────────────────────

export function activateFakeSession(acc: FakeAccount) {
    if (_active) deactivateFakeSession();

    if (!UserClass) {
        let tries = 0;
        const t = setInterval(() => {
            tries++;
            if (UserClass) { clearInterval(t); activateFakeSession(acc); }
            else if (tries >= 20) {
                clearInterval(t);
                Toasts.show({ message: "FakeAccounts: UserClass not ready, try again.", id: "fa-noclass", type: Toasts.Type.FAILURE, options: { position: Toasts.Position.BOTTOM } });
            }
        }, 200);
        return;
    }

    const fakeUser = buildUserObject(acc);
    if (!fakeUser) {
        Toasts.show({ message: "FakeAccounts: failed to build user object.", id: "fa-noobj", type: Toasts.Type.FAILURE, options: { position: Toasts.Position.BOTTOM } });
        return;
    }

    _active = true;
    _activeAcc = acc;
    _activeFakeUser = fakeUser;

    const GuildsTreeClass = getGuildsTreeClass();

    // ── UserStore ─────────────────────────────────────────────────────────────
    // getCurrentUser() returns the fake UserClass instance.
    // Settings modal, AccountPanel, everything that calls getCurrentUser() gets fakeUser.
    // fakeUser has all UserClass methods (getAvatarURL, hasAvatarForGuild, etc.) — no crash.
    _orig.getCurrentUser = UserStore.getCurrentUser.bind(UserStore);
    UserStore.getCurrentUser = () => fakeUser;

    // ── AuthStore ─────────────────────────────────────────────────────────────
    _orig.getId = AuthStore.getId.bind(AuthStore);
    AuthStore.getId = () => acc.id;

    // ── GuildFolderStore → empty ──────────────────────────────────────────────
    _orig.getGuildsTree = GuildFolderStore.getGuildsTree.bind(GuildFolderStore);
    if (GuildsTreeClass) {
        GuildFolderStore.getGuildsTree = () => {
            try { return new GuildsTreeClass(); } catch { return _orig.getGuildsTree(); }
        };
    }
    _orig.getFlattenedGuildIds = GuildFolderStore.getFlattenedGuildIds.bind(GuildFolderStore);
    GuildFolderStore.getFlattenedGuildIds = () => [];

    _orig.getFlattenedGuildFolderList = GuildFolderStore.getFlattenedGuildFolderList.bind(GuildFolderStore);
    GuildFolderStore.getFlattenedGuildFolderList = () => [];

    _orig.getGuildFolders = GuildFolderStore.getGuildFolders.bind(GuildFolderStore);
    GuildFolderStore.getGuildFolders = () => [];

    // ── GuildStore ────────────────────────────────────────────────────────────
    _orig.getGuildCount = GuildStore.getGuildCount.bind(GuildStore);
    GuildStore.getGuildCount = () => 0;

    // ── ChannelStore → empty DMs ─────────────────────────────────────────────
    _orig.getSortedPrivateChannels = ChannelStore.getSortedPrivateChannels.bind(ChannelStore);
    ChannelStore.getSortedPrivateChannels = () => [];

    _orig.getMutablePrivateChannels = ChannelStore.getMutablePrivateChannels.bind(ChannelStore);
    ChannelStore.getMutablePrivateChannels = () => ({});

    // ── RelationshipStore → empty ─────────────────────────────────────────────
    _orig.getFriendCount = RelationshipStore.getFriendCount.bind(RelationshipStore);
    RelationshipStore.getFriendCount = () => 0;

    _orig.getFriendIDs = RelationshipStore.getFriendIDs.bind(RelationshipStore);
    RelationshipStore.getFriendIDs = () => [];

    _orig.getMutableRelationships = RelationshipStore.getMutableRelationships.bind(RelationshipStore);
    RelationshipStore.getMutableRelationships = () => new Map();

    _orig.getRelationshipType = RelationshipStore.getRelationshipType.bind(RelationshipStore);
    RelationshipStore.getRelationshipType = () => 0;

    // ── UserProfileStore ──────────────────────────────────────────────────────
    // NOTE: FakeProfile plugin also patches getUserProfile via webpack.
    // We monkey-patch AFTER FakeProfile's webpack patch has already replaced the function,
    // so our wrapper runs first at call time and intercepts the fake user's profile.
    // For other users we call through to FakeProfile's patched version (which calls original).
    _orig.getUserProfile = UserProfileStore.getUserProfile.bind(UserProfileStore);
    UserProfileStore.getUserProfile = function (userId: string) {
        try {
            if (userId === acc.id) return buildStoredProfile(acc, fakeUser);
            // For other users, delegate to whatever is currently the "real" function.
            // This correctly routes through FakeProfile's profileDecodeHook if active.
            return _orig.getUserProfile.call(this, userId);
        } catch (e) {
            console.error("[FakeAccounts] getUserProfile error:", e);
            return null;
        }
    };

    // ── PresenceStore ─────────────────────────────────────────────────────────
    _orig.getStatus = PresenceStore.getStatus.bind(PresenceStore);
    PresenceStore.getStatus = function (userId: string) {
        try {
            if (userId === acc.id && acc.status) return acc.status;
            return _orig.getStatus.call(this, userId);
        } catch { return "offline"; }
    };

    _orig.getActivities = PresenceStore.getActivities.bind(PresenceStore);
    PresenceStore.getActivities = function (userId: string) {
        try {
            if (userId === acc.id) {
                const cs = getStoredCustomStatus(acc);
                const rest = (_orig.getActivities.call(this, userId) ?? []).filter((a: any) => a.type !== CUSTOM_STATUS_TYPE);
                return cs ? [cs, ...rest] : rest;
            }
            return _orig.getActivities.call(this, userId);
        } catch { return []; }
    };

    // ── RestAPI.get — intercept profile requests ──────────────────────────────
    // CRITICAL FIX: body.user must be fakeUser (UserClass instance), NOT a plain object.
    // Discord's profile modal calls user.getAvatarURL(), user.hasAvatarForGuild() etc.
    // If body.user is a plain object those calls throw and crash Discord.
    _orig.restGet = RestAPI.get.bind(RestAPI);
    RestAPI.get = async function (req: any, ...args: any[]) {
        try {
            if (isFakeProfileRequest(req?.url, acc.id))
                return buildProfileResponse(acc, fakeUser);
            return _orig.restGet.call(this, req, ...args);
        } catch (e) {
            console.error("[FakeAccounts] RestAPI.get error:", e);
            return _orig.restGet.call(this, req, ...args);
        }
    };

    // ── FluxDispatcher — intercept USER_PROFILE_FETCH_SUCCESS ─────────────────
    // When the profile modal opens, Discord dispatches USER_PROFILE_FETCH_SUCCESS
    // with the fetched profile body. If our RestAPI intercept ran, this dispatch
    // carries our fake data — but if anything slips through Discord's own fetcher
    // we guard here too, ensuring body.user is always a UserClass instance.
    _orig.fluxDispatch = FluxDispatcher.dispatch.bind(FluxDispatcher);
    FluxDispatcher.dispatch = function (action: any) {
        try {
            if (_active) {
                if (action?.type === "USER_PROFILE_FETCH_SUCCESS" && action?.user?.id === acc.id) {
                    // Replace whatever user object came in with our safe UserClass instance
                    action = { ...action, user: fakeUser };
                }
                // Also intercept USER_PROFILE_MODAL_OPEN to force it to use fake user ID
                if (action?.type === "USER_PROFILE_MODAL_OPEN") {
                    action = { ...action, userId: acc.id };
                }
            }
        } catch (e) {
            console.error("[FakeAccounts] FluxDispatcher error:", e);
        }
        return _orig.fluxDispatch.call(this, action);
    };

    Toasts.show({ message: `Switched to ${acc.globalName ?? acc.username}`, id: "fa-switch", type: Toasts.Type.SUCCESS, options: { position: Toasts.Position.BOTTOM } });
}

// ─── Deactivate ───────────────────────────────────────────────────────────────

export function deactivateFakeSession() {
    if (!_active) return;

    const restore = (store: any, key: string) => {
        try { if (_orig[key]) store[key] = _orig[key]; } catch { /* */ }
    };

    restore(UserStore, "getCurrentUser");
    restore(AuthStore, "getId");
    restore(GuildFolderStore, "getGuildsTree");
    restore(GuildFolderStore, "getFlattenedGuildIds");
    restore(GuildFolderStore, "getFlattenedGuildFolderList");
    restore(GuildFolderStore, "getGuildFolders");
    restore(GuildStore, "getGuildCount");
    restore(ChannelStore, "getSortedPrivateChannels");
    restore(ChannelStore, "getMutablePrivateChannels");
    restore(RelationshipStore, "getFriendCount");
    restore(RelationshipStore, "getFriendIDs");
    restore(RelationshipStore, "getMutableRelationships");
    restore(RelationshipStore, "getRelationshipType");
    restore(UserProfileStore, "getUserProfile");
    restore(PresenceStore, "getStatus");
    restore(PresenceStore, "getActivities");

    if (_orig.restGet) { try { RestAPI.get = _orig.restGet; } catch { /* */ } }
    if (_orig.fluxDispatch) { try { FluxDispatcher.dispatch = _orig.fluxDispatch; } catch { /* */ } }

    Object.keys(_orig).forEach(k => delete _orig[k]);
    _active = false;
    _activeAcc = null;
    _activeFakeUser = null;

    Toasts.show({ message: "Switched back to real account", id: "fa-restore", type: Toasts.Type.SUCCESS, options: { position: Toasts.Position.BOTTOM } });
}

// ─── Modal ────────────────────────────────────────────────────────────────────

function FakeAccountModal({ modalProps }: { modalProps: ModalProps; }) {
    const [accounts, setAccounts] = React.useState<FakeAccount[]>(getCachedAccounts);
    const [activeId, setActiveId] = React.useState<string | null>(_activeAcc?.id ?? null);
    const [syncing, setSyncing] = React.useState(false);
    const [addId, setAddId] = React.useState("");
    const [adding, setAdding] = React.useState(false);

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
        const ids = getIdsFromSettings();
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
        const newIds = getIdsFromSettings().filter(i => i !== id);
        settings.store.accountIds = newIds.join(",");
        const cache = loadCache();
        delete cache[id];
        saveCache(cache);
        if (activeId === id) { deactivateFakeSession(); setActiveId(null); }
        setAccounts(getCachedAccounts());
    };

    const handleSwitch = (acc: FakeAccount) => {
        activateFakeSession(acc);
        setActiveId(acc.id);
    };

    const handleExit = () => {
        deactivateFakeSession();
        setActiveId(null);
    };

    return (
        <ModalRoot {...modalProps} size={ModalSize.MEDIUM}>
            <ModalHeader separator>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"
                    style={{ marginRight: 8, flexShrink: 0, color: "var(--interactive-normal)" }}>
                    <path d="M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10zm0 2c-5.33 0-8 2.67-8 4v1h16v-1c0-1.33-2.67-4-8-4z" />
                </svg>
                <Forms.FormTitle tag="h4" style={{ margin: 0, flex: 1 }}>
                    Fake Accounts
                    {_active && (
                        <span style={{ color: "var(--status-danger)", fontSize: 12, marginLeft: 8 }}>
                            ● {_activeAcc?.globalName ?? _activeAcc?.username}
                        </span>
                    )}
                </Forms.FormTitle>
                <ModalCloseButton onClick={modalProps.onClose} />
            </ModalHeader>

            <ModalContent>
                <div style={{ padding: 16 }}>
                    {/* ── Add + action row ─────────────────────────────────── */}
                    <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
                        <div style={{ flex: 1 }}>
                            <TextInput
                                value={addId}
                                placeholder="Add by User ID (e.g. 123456789012345678)"
                                onChange={(v: string) => setAddId(v)}
                                onKeyDown={(e: React.KeyboardEvent) => { if (e.key === "Enter") handleAdd(); }}
                            />
                        </div>
                        <Button size={Button.Sizes.MEDIUM} color={Button.Colors.GREEN}
                            disabled={adding || !addId.trim()} onClick={handleAdd}>
                            {adding ? "Adding…" : "Add"}
                        </Button>
                        <Button size={Button.Sizes.MEDIUM} color={Button.Colors.PRIMARY}
                            disabled={syncing} onClick={handleRefresh}>
                            {syncing ? "…" : "↺"}
                        </Button>
                        {_active && (
                            <Button size={Button.Sizes.MEDIUM} color={Button.Colors.RED} onClick={handleExit}>
                                ✕ Exit
                            </Button>
                        )}
                    </div>

                    {/* ── Account list ─────────────────────────────────────── */}
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
                                    const isActive = activeId === acc.id;
                                    const cst = acc.customStatus?.text || acc.customStatus?.emojiName;
                                    return (
                                        <div key={acc.id} style={{
                                            overflow: "hidden", borderRadius: 8,
                                            border: `1px solid ${isActive ? "var(--brand-500)" : "var(--background-modifier-accent)"}`,
                                            backgroundColor: isActive ? "var(--background-modifier-selected)" : "var(--background-secondary)",
                                        }}>
                                            {/* Banner */}
                                            <div style={{ height: 52, ...getBannerBackground(acc) }} />

                                            {/* Content row */}
                                            <div style={{ display: "flex", alignItems: "center", padding: "8px 12px 10px", gap: 12 }}>
                                                {/* Avatar + status dot */}
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
                                                    {(acc.profile?.pronouns || cst) && (
                                                        <div style={{ fontSize: 12, color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: 1 }}>
                                                            {acc.profile?.pronouns}
                                                            {acc.profile?.pronouns && cst ? " · " : ""}
                                                            {cst}
                                                        </div>
                                                    )}
                                                </div>

                                                {/* Buttons */}
                                                <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                                                    <Button
                                                        size={Button.Sizes.SMALL}
                                                        color={isActive ? Button.Colors.RED : Button.Colors.BRAND}
                                                        onClick={() => isActive ? handleExit() : handleSwitch(acc)}
                                                    >
                                                        {isActive ? "Exit" : "Switch"}
                                                    </Button>
                                                    <Button size={Button.Sizes.SMALL} color={Button.Colors.RED}
                                                        onClick={() => handleRemove(acc.id)}>
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
    if (e.altKey && e.key.toLowerCase() === "c")
        openModal(props => <FakeAccountModal modalProps={props} />);
}

// ─── Plugin ───────────────────────────────────────────────────────────────────

export default definePlugin({
    name: "Fake Accounts",
    description: "Impersonate other accounts locally. Add IDs in settings or via Alt+C panel.",
    authors: [Devs.feelslove],
    settings,

    patches: [
        {
            // Inject fake users into Discord's multi-account switcher list.
            // getUsers() returns an ARRAY of User objects — we spread our fakes in.
            find: "getIsValidatingUsers",
            replacement: {
                match: /getUsers\(\)\{return (\i)\}/,
                replace: "getUsers(){return $self.injectFakes($1)}"
            }
        },
        {
            // Intercept the account switch call inside the multiAccountUsers component.
            // Pattern A: full analytics+Mx — most specific
            // Pattern B: just Mx inside a function that contains MULTI_ACCOUNT_SWITCH_ATTEMPT
            find: "multiAccountUsers",
            replacement: [
                {
                    // Pattern A: analytics track call immediately followed by Mx(userId)
                    match: /(\w+)\.default\.track\((\w+)\.HAw\.MULTI_ACCOUNT_SWITCH_ATTEMPT[^)]+\),(\w+)\.Mx\((\w+)\)/,
                    replace: "$1.default.track($2.HAw.MULTI_ACCOUNT_SWITCH_ATTEMPT,{location:{section:$2.JJy.USER_PROFILE}}),$self.handleSwitch($3.Mx.bind($3),$4)",
                },
                {
                    // Pattern B: simpler — matches Mx(userId) anywhere in the module
                    // Only runs if Pattern A didn't match (Vencord tries replacements in order)
                    match: /\b(\w+)\.Mx\((\w+)\)/,
                    replace: "$self.handleSwitch($1.Mx.bind($1),$2)",
                },
            ]
        },
        {
            // Intercept profile modal opening to use fake user ID when active
            find: "USER_PROFILE_MODAL_OPEN",
            replacement: {
                match: /type:"USER_PROFILE_MODAL_OPEN",userId:(\i)/,
                replace: "type:\"USER_PROFILE_MODAL_OPEN\",userId:$self.getProfileUserId($1)"
            }
        },
    ],

    start() {
        document.addEventListener("keydown", handleKeyDown);
        void syncAccounts();
    },

    stop() {
        document.removeEventListener("keydown", handleKeyDown);
        if (_active) deactivateFakeSession();
    },

    // ── getSafeCurrentUser: returns fake user when active, real otherwise ────────
    getSafeCurrentUser() {
        try { return UserStore.getCurrentUser(); } catch { return null; }
    },

    // ── Patch handler: inject fake users into getUsers() array ────────────────
    injectFakes(realUsers: any): any {
        if (!UserClass) return realUsers ?? [];
        const accounts = getCachedAccounts();
        if (!accounts.length) return realUsers ?? [];

        const fakeObjects = accounts.map(acc => {
            try {
                const u = buildUserObject(acc);
                if (!u) return null;
                u.tokenStatus = 2;    // marks as "logged in" in the switcher UI
                u.pushSyncToken = null; // required field shape for Discord switcher
                return u;
            } catch { return null; }
        }).filter(Boolean);

        const base = Array.isArray(realUsers) ? realUsers : [];
        return [...base, ...fakeObjects];
    },

    // ── Patch handler: intercept Mx(userId) call ──────────────────────────────
    handleSwitch(originalFn: (id: string) => void, userId: string) {
        const acc = getCachedAccounts().find(a => a.id === userId);
        if (acc) {
            // Fake account: activate our local session instead of real Discord switch
            activateFakeSession(acc);
        } else {
            // Real account: deactivate any fake session, then let Discord switch normally
            if (_active) deactivateFakeSession();
            try { originalFn(userId); } catch { /* */ }
        }
    },

    // ── Patch handler: get profile user ID (use fake ID when active) ───────────
    getProfileUserId(originalId: string) {
        if (_active && _activeAcc) return _activeAcc.id;
        return originalId;
    }
});
