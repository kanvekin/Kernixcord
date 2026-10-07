/*
 * StalkerPlus - Real-time Voice, Profile, and Presence Surveillance
 * Author: xen (https://github.com/xenover1991)
 * License: MIT
 */

import "./styles.css";

import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { showNotification } from "@api/Notifications";
import { definePluginSettings } from "@api/Settings";
import { Devs } from "@utils/constants";
import { openUserProfile } from "@utils/discord";
import definePlugin, { OptionType } from "@utils/types";
import { findByPropsLazy, findStoreLazy } from "@webpack";
import { ChannelStore, GuildStore, Menu, PresenceStore, React, RestAPI, Toasts, UserStore } from "@webpack/common";
import type { User } from "@vencord/discord-types";

import { StalkerSettings } from "./SettingsUI";
import {
    PresenceUpdateItem,
    StalkerEventType,
    StalkerLog,
    UserSnapshot,
    VoiceStateUpdate
} from "./types";

// --- WEBPACK ACTIONS & STORES ---
const GuildActions: {
    transitionToGuildSync?: (guildId: string) => void;
} = findByPropsLazy("transitionToGuildSync");

const ChannelActions: {
    selectVoiceChannel?: (channelId: string | null) => void;
    selectChannel?: (opts: { guildId?: string; channelId: string; messageId?: string; }) => void;
} = findByPropsLazy("selectVoiceChannel", "selectChannel");

const VoiceStateStore: any = findStoreLazy("VoiceStateStore");

export function switchToMessage(guildId?: string, channelId?: string, messageId?: string) {
    try {
        if (guildId && GuildActions?.transitionToGuildSync) {
            GuildActions.transitionToGuildSync(guildId);
        }
        if (channelId && ChannelActions?.selectChannel) {
            ChannelActions.selectChannel({
                guildId: guildId || "@me",
                channelId,
                messageId
            });
        }
    } catch (e) {
        console.error("[StalkerPlus] Mesaja geçiş yapılamadı:", e);
    }
}

export function formatDuration(ms: number): string {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (hours > 0) {
        return `${hours} sa ${minutes} dk ${seconds} sn`;
    }
    if (minutes > 0) {
        return `${minutes} dk ${seconds} sn`;
    }
    return `${seconds} sn`;
}

// --- SETTINGS DEFINITION ---
export const settings = definePluginSettings({
    hud: {
        type: OptionType.COMPONENT,
        component: () => <StalkerSettings />,
    },
    enabled: {
        type: OptionType.BOOLEAN,
        description: "StalkerPlus takip protokolünü etkinleştir",
        default: true,
        hidden: true,
        restartNeeded: false
    },
    trackVoiceJoin: {
        type: OptionType.BOOLEAN,
        description: "Sese giriş bildirimleri",
        default: true,
        hidden: true,
        restartNeeded: false
    },
    trackVoiceLeave: {
        type: OptionType.BOOLEAN,
        description: "Sesten çıkış bildirimleri",
        default: true,
        hidden: true,
        restartNeeded: false
    },
    trackVoiceMove: {
        type: OptionType.BOOLEAN,
        description: "Oda değiştirme bildirimleri",
        default: true,
        hidden: true,
        restartNeeded: false
    },
    trackVoiceState: {
        type: OptionType.BOOLEAN,
        description: "Mikrofon ve Kulaklık (Mute/Deaf) durum değişimleri",
        default: true,
        hidden: true,
        restartNeeded: false
    },
    trackVoiceMedia: {
        type: OptionType.BOOLEAN,
        description: "Yayın ve Kamera (Stream/Video) durum değişimleri",
        default: true,
        hidden: true,
        restartNeeded: false
    },
    trackServerMessage: {
        type: OptionType.BOOLEAN,
        description: "Sunucuya mesaj attığında tek seferlik bildir",
        default: true,
        hidden: true,
        restartNeeded: false
    },
    notifiedServerMessages: {
        type: OptionType.STRING,
        description: "Sunucu mesajı bildirilen kullanıcı-sunucu geçmişi",
        default: "[]",
        hidden: true,
        restartNeeded: false
    },
    persistedLogs: {
        type: OptionType.STRING,
        description: "Discord kapansa bile saklanan log geçmişi (JSON)",
        default: "[]",
        hidden: true,
        restartNeeded: false
    },
    trackAvatar: {
        type: OptionType.BOOLEAN,
        description: "Avatar değişimi bildirimleri",
        default: true,
        hidden: true,
        restartNeeded: false
    },
    trackName: {
        type: OptionType.BOOLEAN,
        description: "İsim ve kullanıcı adı değişimi bildirimleri",
        default: true,
        hidden: true,
        restartNeeded: false
    },
    trackStatus: {
        type: OptionType.BOOLEAN,
        description: "Durum değişimi bildirimleri (Çevrimiçi/Boşta/DND/Çevrimdışı)",
        default: true,
        hidden: true,
        restartNeeded: false
    },
    trackActivity: {
        type: OptionType.BOOLEAN,
        description: "Oyun ve aktivite bildirimleri",
        default: true,
        hidden: true,
        restartNeeded: false
    },
    soundAlert: {
        type: OptionType.BOOLEAN,
        description: "Akustik ses uyarısı çal",
        default: true,
        hidden: true,
        restartNeeded: false
    },
    desktopNotifications: {
        type: OptionType.BOOLEAN,
        description: "Masaüstü bildirimleri göster",
        default: false,
        hidden: true,
        restartNeeded: false
    },
    targetUserIds: {
        type: OptionType.STRING,
        description: "İzlenen kullanıcı ID listesi (JSON Array)",
        default: "[]",
        hidden: true,
        restartNeeded: false
    }
});

// --- HELPER FUNCTIONS FOR USER LIST ---
export function parseIdList(raw?: string): string[] {
    if (!raw?.trim()) return [];
    try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
            return parsed.filter((id): id is string => typeof id === "string" && id.length > 0);
        }
    } catch {
        return raw.split(",").map(s => s.trim()).filter(Boolean);
    }
    return [];
}

export function getTargetUserIds(): string[] {
    return parseIdList(settings.store.targetUserIds);
}

export function setTargetUserIds(ids: string[]) {
    const unique = [...new Set(ids)];
    settings.store.targetUserIds = JSON.stringify(unique);
    unique.forEach(id => {
        getOrInitSnapshot(id);
        pollTargetProfile(id);
    });
}

export function toggleTargetUserId(userId: string): boolean {
    const ids = getTargetUserIds();
    const idx = ids.indexOf(userId);
    if (idx >= 0) {
        ids.splice(idx, 1);
        setTargetUserIds(ids);
        return false;
    }
    setTargetUserIds([...ids, userId]);
    return true;
}

export function removeTargetUserId(userId: string) {
    setTargetUserIds(getTargetUserIds().filter(id => id !== userId));
}

// --- SERVER MESSAGE NOTIFICATION HISTORY HELPERS ---
export function getNotifiedServerMessages(): string[] {
    return parseIdList(settings.store.notifiedServerMessages);
}

export function hasNotifiedServerMessage(userId: string, guildId: string): boolean {
    const list = getNotifiedServerMessages();
    return list.includes(`${userId}:${guildId}`);
}

export function markServerMessageNotified(userId: string, guildId: string) {
    const list = getNotifiedServerMessages();
    const key = `${userId}:${guildId}`;
    if (!list.includes(key)) {
        list.push(key);
        settings.store.notifiedServerMessages = JSON.stringify(list);
    }
}

export function clearNotifiedServerMessages() {
    settings.store.notifiedServerMessages = "[]";
}

// --- AVATAR & STORE HELPERS ---
export function getAvatarUrl(userId: string, avatarHash?: string | null): string {
    if (avatarHash) {
        const isAnimated = avatarHash.startsWith("a_");
        const ext = isAnimated ? "gif" : "png";
        return `https://cdn.discordapp.com/avatars/${userId}/${avatarHash}.${ext}?size=80`;
    }
    try {
        const index = Number((BigInt(userId) >> 22n) % 6n);
        return `https://cdn.discordapp.com/embed/avatars/${index}.png`;
    } catch {
        return "https://cdn.discordapp.com/embed/avatars/0.png";
    }
}

export function getUserVoiceState(userId: string): {
    channelId?: string;
    guildId?: string;
    deaf?: boolean;
    mute?: boolean;
    selfDeaf?: boolean;
    selfMute?: boolean;
    selfStream?: boolean;
    selfVideo?: boolean;
} | null {
    try {
        const allStates = VoiceStateStore?.getAllVoiceStates?.();
        if (!allStates) return null;

        for (const guildId of Object.keys(allStates)) {
            const guildVoice = allStates[guildId];
            if (guildVoice && guildVoice[userId]) {
                const vs = guildVoice[userId];
                return {
                    channelId: vs.channelId,
                    guildId: guildId === "@me" ? undefined : guildId,
                    deaf: vs.deaf,
                    mute: vs.mute,
                    selfDeaf: vs.selfDeaf,
                    selfMute: vs.selfMute,
                    selfStream: vs.selfStream,
                    selfVideo: vs.selfVideo
                };
            }
        }
    } catch {
        // VoiceStateStore unavailable or structure changed
    }
    return null;
}

// --- SNAPSHOT REPOSITORY ---
const userSnapshots = new Map<string, UserSnapshot>();

export function getOrInitSnapshot(userId: string): UserSnapshot {
    let snap = userSnapshots.get(userId);
    if (!snap) {
        const user = UserStore.getUser(userId);
        const username = user?.username || "Bilinmeyen";
        const globalName = user?.globalName;
        const avatar = user?.avatar;
        const avatarUrl = user && typeof user.getAvatarURL === "function"
            ? user.getAvatarURL(undefined, 80, true)
            : getAvatarUrl(userId, avatar);
        const status = PresenceStore?.getStatus?.(userId) || "offline";
        const activity = PresenceStore?.getActivities?.(userId)?.[0]?.name;
        const currentVoice = getUserVoiceState(userId);

        snap = {
            id: userId,
            username,
            globalName,
            avatar,
            avatarUrl,
            status,
            activity,
            channelId: currentVoice?.channelId,
            guildId: currentVoice?.guildId,
            selfMute: currentVoice?.selfMute,
            selfDeaf: currentVoice?.selfDeaf,
            mute: currentVoice?.mute,
            deaf: currentVoice?.deaf,
            isStreaming: currentVoice?.selfStream,
            isVideo: currentVoice?.selfVideo,
            voiceJoinedAt: currentVoice?.channelId ? Date.now() : undefined,
            lastUpdated: Date.now(),
            initialized: false
        };
        userSnapshots.set(userId, snap);
    }
    return snap;
}

// --- LOGGING SYSTEM (PERSISTENT ACROSS SESSIONS) ---
let stalkerLogs: StalkerLog[] | null = null;

function loadPersistedLogs(): StalkerLog[] {
    try {
        const raw = settings.store.persistedLogs;
        if (raw && raw.trim() && raw !== "[]") {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
                return parsed;
            }
        }
    } catch (e) {
        console.warn("[StalkerPlus] Kalıcı loglar çözümlenemedi:", e);
    }
    return [];
}

function savePersistedLogs(logs: StalkerLog[]) {
    try {
        settings.store.persistedLogs = JSON.stringify(logs);
    } catch (e) {
        console.warn("[StalkerPlus] Kalıcı loglar kaydedilemedi:", e);
    }
}

export function getStalkerLogs(): StalkerLog[] {
    if (stalkerLogs === null) {
        stalkerLogs = loadPersistedLogs();
    }
    return [...stalkerLogs];
}

export function addStalkerLog(log: StalkerLog) {
    if (stalkerLogs === null) {
        stalkerLogs = loadPersistedLogs();
    }
    stalkerLogs.unshift(log);
    if (stalkerLogs.length > 100) stalkerLogs.pop();
    savePersistedLogs(stalkerLogs);
}

export function clearStalkerLogs() {
    stalkerLogs = [];
    settings.store.persistedLogs = "[]";
}

// --- ACOUSTIC AUDIO CUE (SOOTHING LUXURY CHIME) ---
export function playStalkerAudioCue() {
    try {
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        if (!AudioCtx) return;
        const ctx = new AudioCtx();
        const t = ctx.currentTime;

        // Warm Low-pass filter to eliminate any sharp edges or harsh clicks
        const filter = ctx.createBiquadFilter();
        filter.type = "lowpass";
        filter.frequency.setValueAtTime(1600, t);
        filter.connect(ctx.destination);

        const masterGain = ctx.createGain();
        masterGain.connect(filter);

        // 1. Birinci yumuşak zarif ton (E5 - 659.25 Hz)
        const osc1 = ctx.createOscillator();
        const gain1 = ctx.createGain();
        osc1.type = "sine";
        osc1.frequency.setValueAtTime(659.25, t);

        gain1.gain.setValueAtTime(0.0001, t);
        gain1.gain.linearRampToValueAtTime(0.05, t + 0.015);
        gain1.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);

        osc1.connect(gain1);
        gain1.connect(masterGain);

        // 2. İkinci sıcak armonik ton (A5 - 880 Hz, 45ms gecikmeyle)
        const osc2 = ctx.createOscillator();
        const gain2 = ctx.createGain();
        osc2.type = "sine";
        osc2.frequency.setValueAtTime(880, t + 0.045);

        gain2.gain.setValueAtTime(0.0001, t);
        gain2.gain.setValueAtTime(0.0001, t + 0.045);
        gain2.gain.linearRampToValueAtTime(0.04, t + 0.06);
        gain2.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);

        osc2.connect(gain2);
        gain2.connect(masterGain);

        osc1.start(t);
        osc1.stop(t + 0.23);
        osc2.start(t + 0.045);
        osc2.stop(t + 0.29);
    } catch {
        // AudioContext blocked or restricted
    }
}

// --- DISPATCH STALKER NOTIFICATION ---
export interface NotificationPayload {
    userId: string;
    userName: string;
    userAvatar?: string;
    eventType: StalkerEventType;
    eventTitle: string;
    eventDetail: string;
    oldValue?: string;
    newValue?: string;
    channelId?: string;
    guildId?: string;
    messageId?: string;
    duration?: string;
}

export function dispatchStalkerNotification(payload: NotificationPayload) {
    const { userId, userName, userAvatar, eventType, eventTitle, eventDetail, oldValue, newValue, channelId, guildId, messageId, duration } = payload;

    // 1. Akustik Yumuşak Ses Uyarısı
    if (settings.store.soundAlert) {
        playStalkerAudioCue();
    }

    // 2. Canlı Terminal Günlüğüne Ekle
    addStalkerLog({
        id: `${Date.now()}-${Math.random()}`,
        timestamp: Date.now(),
        userId,
        userName,
        userAvatar,
        eventType,
        eventTitle,
        eventDetail,
        oldValue,
        newValue,
        channelId,
        guildId,
        messageId,
        duration
    });

    // 3. Modern, Orantılı ve Şık HUD Bildirim Gövdesi
    const richBody = (
        <div
            className="sp-notif-card"
            onClick={() => {
                if (eventType === "SERVER_MESSAGE" && channelId) {
                    switchToMessage(guildId, channelId, messageId);
                } else if (channelId && eventType.startsWith("VOICE")) {
                    ChannelActions?.selectVoiceChannel?.(channelId);
                } else {
                    openUserProfile(userId);
                }
            }}
        >
            <div className="sp-notif-content">
                <div className="sp-notif-desc">{eventDetail}</div>

                {/* Avatar Değişimi Karşılaştırması */}
                {eventType === "AVATAR_CHANGE" && (oldValue || newValue) && (
                    <div className="sp-notif-compare-box">
                        <div className="sp-notif-compare-side">
                            <span className="sp-notif-compare-tag">ÖNCE</span>
                            {oldValue ? (
                                <img src={oldValue} alt="Eski" className="sp-notif-compare-img old" />
                            ) : (
                                <div className="sp-notif-compare-fallback">YOK</div>
                            )}
                        </div>
                        <div className="sp-notif-compare-arrow-wrap">
                            <span className="sp-notif-compare-arrow">➔</span>
                        </div>
                        <div className="sp-notif-compare-side">
                            <span className="sp-notif-compare-tag">ŞİMDİ</span>
                            {newValue ? (
                                <img src={newValue} alt="Yeni" className="sp-notif-compare-img new" />
                            ) : (
                                <div className="sp-notif-compare-fallback">YOK</div>
                            )}
                        </div>
                    </div>
                )}
            </div>

            <div className="sp-notif-action-row">
                <div className="sp-notif-brand-pill">
                    <span className="sp-notif-dot" />
                    <span>STALKER+</span>
                </div>
                <button className="sp-notif-action-btn">
                    {eventType === "SERVER_MESSAGE"
                        ? "Mesaja Git ↗"
                        : channelId && eventType.startsWith("VOICE")
                            ? "Odaya Katıl ↗"
                            : "Profili İncele ↗"}
                </button>
            </div>
        </div>
    );

    // 4. Vencord Bildirimini Gönder
    showNotification({
        title: `${userName} • ${eventTitle}`,
        body: eventDetail,
        icon: userAvatar,
        richBody,
        onClick: () => {
            if (eventType === "SERVER_MESSAGE" && channelId) {
                switchToMessage(guildId, channelId, messageId);
            } else if (channelId && eventType.startsWith("VOICE")) {
                ChannelActions?.selectVoiceChannel?.(channelId);
            } else {
                openUserProfile(userId);
            }
        }
    });

    // 5. Masaüstü Bildirimi (Discord arkadayken)
    if (settings.store.desktopNotifications && typeof Notification !== "undefined" && !document.hasFocus()) {
        try {
            new Notification(`${userName} • ${eventTitle}`, {
                body: eventDetail,
                icon: userAvatar
            });
        } catch {
            // Ignored
        }
    }
}

// --- PROACTIVE PROFILE & AVATAR DIFF CHECKER ---
export function checkUserProfileDiff(userId: string, incomingUser: any) {
    if (!settings.store.enabled || !incomingUser) return;
    const targets = getTargetUserIds();
    if (!targets.includes(userId)) return;

    const snapshot = getOrInitSnapshot(userId);
    const user = UserStore.getUser(userId);

    const incomingUsername = incomingUser.username || user?.username || snapshot.username;
    const incomingGlobalName = incomingUser.global_name !== undefined ? incomingUser.global_name : (incomingUser.globalName !== undefined ? incomingUser.globalName : snapshot.globalName);
    const displayName = incomingGlobalName || incomingUsername;
    const newAvatarHash = incomingUser.avatar !== undefined ? incomingUser.avatar : user?.avatar;

    // A. İlk Kez Kalibre Ediliyorsa (İlk profil yüklemesi): Bildirim göndermeden başlangıç durumunu kaydet
    if (!snapshot.initialized) {
        snapshot.username = incomingUsername;
        snapshot.globalName = incomingGlobalName;
        snapshot.avatar = newAvatarHash;
        snapshot.avatarUrl = getAvatarUrl(userId, newAvatarHash);
        snapshot.initialized = true;
        snapshot.lastUpdated = Date.now();
        return;
    }

    // B. Avatar Değişimi Kontrolü
    if (settings.store.trackAvatar && newAvatarHash !== undefined && newAvatarHash !== snapshot.avatar) {
        const oldAvatarUrl = snapshot.avatarUrl || getAvatarUrl(userId, snapshot.avatar);
        const newAvatarUrl = getAvatarUrl(userId, newAvatarHash);

        dispatchStalkerNotification({
            userId,
            userName: displayName,
            userAvatar: newAvatarUrl,
            eventType: "AVATAR_CHANGE",
            eventTitle: "AVATAR DEĞİŞTİ",
            eventDetail: "Profil fotoğrafını güncelledi",
            oldValue: oldAvatarUrl,
            newValue: newAvatarUrl
        });

        snapshot.avatar = newAvatarHash;
        snapshot.avatarUrl = newAvatarUrl;
        snapshot.lastUpdated = Date.now();
    }

    // C. İsim & Kullanıcı Adı Değişimi Kontrolü
    if (settings.store.trackName) {
        const oldDisplayName = snapshot.globalName || snapshot.username;
        const newDisplayName = incomingGlobalName || incomingUsername;

        if (newDisplayName && oldDisplayName && newDisplayName !== oldDisplayName) {
            dispatchStalkerNotification({
                userId,
                userName: newDisplayName,
                userAvatar: snapshot.avatarUrl || getAvatarUrl(userId, snapshot.avatar),
                eventType: "NAME_CHANGE",
                eventTitle: "İSİM DEĞİŞTİ",
                eventDetail: `Kullanıcı adını güncelledi: "${oldDisplayName}" ➔ "${newDisplayName}"`,
                oldValue: oldDisplayName,
                newValue: newDisplayName
            });

            snapshot.username = incomingUsername;
            snapshot.globalName = incomingGlobalName;
            snapshot.lastUpdated = Date.now();
        }
    }
}

// --- DIRECT DISCORD REST PROFILE POLLER ---
let backoffUntil = 0;

export async function pollTargetProfile(userId: string) {
    if (!settings.store.enabled) return;
    if (Date.now() < backoffUntil) return;

    try {
        const res = await RestAPI.get({
            url: `/users/${userId}/profile`,
            query: {
                with_mutual_guilds: true,
                with_mutual_friends_count: true,
            }
        });
        const incomingUser = res?.body?.user;
        if (!incomingUser) return;

        checkUserProfileDiff(userId, incomingUser);
    } catch (err: any) {
        if (err?.status === 429) {
            const retryAfter = (err?.body?.retry_after || 10) * 1000;
            backoffUntil = Date.now() + retryAfter;
            console.warn(`[StalkerPlus] Rate limited on /users/${userId}/profile. Backing off for ${retryAfter}ms`);
        }
    }
}

// --- ROUND-ROBIN TARGET POLLER & WATCHDOG ---
let watchdogTimer: any = null;
let targetPollIndex = 0;
let lastPollTime = 0;

async function runWatchdogCheck() {
    if (!settings.store.enabled) return;
    const targets = getTargetUserIds();
    if (targets.length === 0) return;

    // 1. Her döngüde bir hedefi Discord REST API üzerinden sorgula
    const now = Date.now();
    if (now - lastPollTime >= 3500) {
        lastPollTime = now;
        if (targetPollIndex >= targets.length) targetPollIndex = 0;
        const targetId = targets[targetPollIndex];
        targetPollIndex = (targetPollIndex + 1) % targets.length;
        pollTargetProfile(targetId);
    }

    // 2. Yerel ses ve durum değişikliklerini anlık kontrol et
    for (const userId of targets) {
        const snapshot = getOrInitSnapshot(userId);

        // A. Ses Durum Kontrolü (Voice State Check)
        const currentVoice = getUserVoiceState(userId);
        const currentChannelId = currentVoice?.channelId;

        if (snapshot.channelId !== currentChannelId) {
            const prevChannelId = snapshot.channelId;
            const newChannelId = currentChannelId;
            const user = UserStore.getUser(userId);
            const userName = user ? (user.globalName || user.username) : (snapshot.globalName || snapshot.username || `ID: ${userId}`);
            const userAvatar = snapshot.avatarUrl || getAvatarUrl(userId, snapshot.avatar);

            // Sese Giriş
            if (!prevChannelId && newChannelId) {
                snapshot.voiceJoinedAt = Date.now();
                if (settings.store.trackVoiceJoin) {
                    const channel = ChannelStore.getChannel(newChannelId);
                    const channelName = channel?.name || "Ses Odası";
                    const guild = channel?.guild_id ? GuildStore.getGuild(channel.guild_id) : null;
                    const guildName = guild?.name ? `(${guild.name})` : "";

                    dispatchStalkerNotification({
                        userId,
                        userName,
                        userAvatar,
                        eventType: "VOICE_JOIN",
                        eventTitle: "SESE GİRDİ",
                        eventDetail: `#${channelName} ${guildName} odasına katıldı`.trim(),
                        channelId: newChannelId,
                        guildId: channel?.guild_id
                    });
                }
            }
            // Sesten Çıkış
            else if (prevChannelId && !newChannelId) {
                const oldChannel = ChannelStore.getChannel(prevChannelId);
                const channelName = oldChannel?.name || "Ses Odası";
                const guild = oldChannel?.guild_id ? GuildStore.getGuild(oldChannel.guild_id) : null;
                const guildName = guild?.name ? `(${guild.name})` : "";

                let durationText = "";
                if (snapshot.voiceJoinedAt) {
                    const durationMs = Date.now() - snapshot.voiceJoinedAt;
                    durationText = ` • Süre: ${formatDuration(durationMs)}`;
                }

                if (settings.store.trackVoiceLeave) {
                    dispatchStalkerNotification({
                        userId,
                        userName,
                        userAvatar,
                        eventType: "VOICE_LEAVE",
                        eventTitle: "SESTEN ÇIKTI",
                        eventDetail: `#${channelName} ${guildName} odasından ayrıldı${durationText}`.trim(),
                        channelId: prevChannelId,
                        guildId: oldChannel?.guild_id,
                        duration: durationText
                    });
                }
                snapshot.voiceJoinedAt = undefined;
            }
            // Oda Değiştirme
            else if (prevChannelId && newChannelId && prevChannelId !== newChannelId) {
                const oldChannel = ChannelStore.getChannel(prevChannelId);
                const newChannel = ChannelStore.getChannel(newChannelId);
                const oldName = oldChannel?.name || "Eski Oda";
                const newName = newChannel?.name || "Yeni Oda";

                let durationText = "";
                if (snapshot.voiceJoinedAt) {
                    const durationMs = Date.now() - snapshot.voiceJoinedAt;
                    durationText = ` (Önceki odada: ${formatDuration(durationMs)})`;
                }

                if (settings.store.trackVoiceMove) {
                    dispatchStalkerNotification({
                        userId,
                        userName,
                        userAvatar,
                        eventType: "VOICE_MOVE",
                        eventTitle: "ODA DEĞİŞTİRDİ",
                        eventDetail: `#${oldName} ➔ #${newName} odasına geçti${durationText}`,
                        channelId: newChannelId,
                        guildId: newChannel?.guild_id,
                        duration: durationText
                    });
                }
                snapshot.voiceJoinedAt = Date.now();
            }

            snapshot.channelId = newChannelId;
            snapshot.lastUpdated = Date.now();
        }

        if (currentVoice && currentVoice.channelId) {
            snapshot.selfMute = currentVoice.selfMute;
            snapshot.selfDeaf = currentVoice.selfDeaf;
            snapshot.mute = currentVoice.mute;
            snapshot.deaf = currentVoice.deaf;
            snapshot.isStreaming = currentVoice.selfStream;
            snapshot.isVideo = currentVoice.selfVideo;
        }

        // B. Durum Kontrolü (Status Check)
        const currentStatus = PresenceStore?.getStatus?.(userId);
        if (currentStatus && currentStatus !== snapshot.status && settings.store.trackStatus) {
            const oldStatus = snapshot.status || "offline";
            const newStatus = currentStatus;
            const statusLabels: Record<string, string> = {
                online: "Çevrimiçi",
                idle: "Boşta",
                dnd: "Rahatsız Etmeyin",
                offline: "Çevrimdışı"
            };
            const user = UserStore.getUser(userId);
            const userName = user ? (user.globalName || user.username) : (snapshot.globalName || snapshot.username || `ID: ${userId}`);

            dispatchStalkerNotification({
                userId,
                userName,
                userAvatar: snapshot.avatarUrl || getAvatarUrl(userId, snapshot.avatar),
                eventType: "STATUS_CHANGE",
                eventTitle: "DURUM DEĞİŞTİ",
                eventDetail: `Durum: ${statusLabels[oldStatus] || oldStatus} ➔ ${statusLabels[newStatus] || newStatus}`
            });
            snapshot.status = newStatus;
            snapshot.lastUpdated = Date.now();
        }

        // C. Aktivite Kontrolü (Activity Check)
        const currentActivities = PresenceStore?.getActivities?.(userId);
        const currentGame = currentActivities?.find?.((a: any) => a.type === 0)?.name;
        if (settings.store.trackActivity) {
            if (currentGame && currentGame !== snapshot.activity) {
                const user = UserStore.getUser(userId);
                const userName = user ? (user.globalName || user.username) : (snapshot.globalName || snapshot.username || `ID: ${userId}`);
                dispatchStalkerNotification({
                    userId,
                    userName,
                    userAvatar: snapshot.avatarUrl || getAvatarUrl(userId, snapshot.avatar),
                    eventType: "ACTIVITY_CHANGE",
                    eventTitle: "OYUNA GİRDİ",
                    eventDetail: `${currentGame} oynamaya başladı`
                });
                snapshot.activity = currentGame;
                snapshot.lastUpdated = Date.now();
            } else if (!currentGame && snapshot.activity) {
                snapshot.activity = undefined;
                snapshot.lastUpdated = Date.now();
            }
        }
    }
}

// --- CONTEXT MENU (KULLANICI SAĞ TIK) ---
const UserContext: NavContextMenuPatchCallback = (children, { user }: { user?: User; }) => {
    if (!user) return;

    const isTracked = getTargetUserIds().includes(user.id);
    const label = isTracked
        ? "Stalk Listesinden Kaldır"
        : "Stalk Listesine Ekle";

    children.push(
        <Menu.MenuGroup key="stalker-plus-context-group">
            <Menu.MenuItem
                id="stalker-plus-toggle"
                label={label}
                action={() => {
                    const added = toggleTargetUserId(user.id);
                    Toasts.show({
                        message: added
                            ? `[StalkerPlus] ${user.username} izleme listesine eklendi.`
                            : `[StalkerPlus] ${user.username} izleme listesinden kaldırıldı.`,
                        type: added ? Toasts.Type.SUCCESS : Toasts.Type.DEFAULT,
                        id: Toasts.genId()
                    });
                }}
            />
        </Menu.MenuGroup>
    );
};

// --- PLUGIN DEFINITION ---
export default definePlugin({
    name: "StalkerPlus",
    description: "Seçtiğiniz kullanıcıların ses, profil ve durum hareketlerini sağ alttan modern bildirimlerle anlık takip eder.",
    authors: [Devs.feelslove],
    settings,
    contextMenus: {
        "user-context": UserContext
    },

    start() {
        if (stalkerLogs === null) {
            stalkerLogs = loadPersistedLogs();
        }

        const targets = getTargetUserIds();
        targets.forEach(id => {
            getOrInitSnapshot(id);
            pollTargetProfile(id);
        });

        if (watchdogTimer) clearInterval(watchdogTimer);
        watchdogTimer = setInterval(runWatchdogCheck, 3000);
    },

    stop() {
        if (watchdogTimer) {
            clearInterval(watchdogTimer);
            watchdogTimer = null;
        }
    },

    flux: {
        // 1. SES OLAYLARI (Voice State Updates)
        VOICE_STATE_UPDATES({ voiceStates }: { voiceStates: VoiceStateUpdate[]; }) {
            if (!settings.store.enabled) return;

            const targets = getTargetUserIds();
            if (targets.length === 0) return;

            for (const state of voiceStates) {
                if (!targets.includes(state.userId)) continue;

                const snapshot = getOrInitSnapshot(state.userId);
                const prevChannelId = snapshot.channelId;
                const newChannelId = state.channelId || undefined;

                const user = UserStore.getUser(state.userId);
                const userName = user ? (user.globalName || user.username) : (snapshot.globalName || snapshot.username || `ID: ${state.userId}`);
                const userAvatar = snapshot.avatarUrl || getAvatarUrl(state.userId, snapshot.avatar);

                // --- A. KANAL DEĞİŞİMLERİ (GİRİŞ, ÇIKIŞ, GEÇİŞ) ---
                if (prevChannelId !== newChannelId) {
                    // Sese Giriş
                    if (!prevChannelId && newChannelId) {
                        snapshot.voiceJoinedAt = Date.now();
                        if (settings.store.trackVoiceJoin) {
                            const channel = ChannelStore.getChannel(newChannelId);
                            const channelName = channel?.name || "Ses Odası";
                            const guild = channel?.guild_id ? GuildStore.getGuild(channel.guild_id) : null;
                            const guildName = guild?.name ? `(${guild.name})` : "";

                            dispatchStalkerNotification({
                                userId: state.userId,
                                userName,
                                userAvatar,
                                eventType: "VOICE_JOIN",
                                eventTitle: "SESE GİRDİ",
                                eventDetail: `#${channelName} ${guildName} odasına katıldı`.trim(),
                                channelId: newChannelId,
                                guildId: channel?.guild_id
                            });
                        }
                    }
                    // Sesten Çıkış
                    else if (prevChannelId && !newChannelId) {
                        const oldChannel = ChannelStore.getChannel(prevChannelId);
                        const channelName = oldChannel?.name || "Ses Odası";
                        const guild = oldChannel?.guild_id ? GuildStore.getGuild(oldChannel.guild_id) : null;
                        const guildName = guild?.name ? `(${guild.name})` : "";

                        let durationText = "";
                        if (snapshot.voiceJoinedAt) {
                            const durationMs = Date.now() - snapshot.voiceJoinedAt;
                            durationText = ` • Süre: ${formatDuration(durationMs)}`;
                        }

                        if (settings.store.trackVoiceLeave) {
                            dispatchStalkerNotification({
                                userId: state.userId,
                                userName,
                                userAvatar,
                                eventType: "VOICE_LEAVE",
                                eventTitle: "SESTEN ÇIKTI",
                                eventDetail: `#${channelName} ${guildName} odasından ayrıldı${durationText}`.trim(),
                                channelId: prevChannelId,
                                guildId: oldChannel?.guild_id,
                                duration: durationText
                            });
                        }
                        snapshot.voiceJoinedAt = undefined;
                    }
                    // Oda Değiştirme
                    else if (prevChannelId && newChannelId && prevChannelId !== newChannelId) {
                        const oldChannel = ChannelStore.getChannel(prevChannelId);
                        const newChannel = ChannelStore.getChannel(newChannelId);
                        const oldName = oldChannel?.name || "Eski Oda";
                        const newName = newChannel?.name || "Yeni Oda";

                        let durationText = "";
                        if (snapshot.voiceJoinedAt) {
                            const durationMs = Date.now() - snapshot.voiceJoinedAt;
                            durationText = ` (Önceki odada: ${formatDuration(durationMs)})`;
                        }

                        if (settings.store.trackVoiceMove) {
                            dispatchStalkerNotification({
                                userId: state.userId,
                                userName,
                                userAvatar,
                                eventType: "VOICE_MOVE",
                                eventTitle: "ODA DEĞİŞTİRDİ",
                                eventDetail: `#${oldName} ➔ #${newName} odasına geçti${durationText}`,
                                channelId: newChannelId,
                                guildId: newChannel?.guild_id,
                                duration: durationText
                            });
                        }
                        snapshot.voiceJoinedAt = Date.now();
                    }

                    snapshot.channelId = newChannelId;
                }

                // --- B. SES DURUMU DETAYLARI (MİKROFON, KULAKLIK, YAYIN, KAMERA) ---
                if (newChannelId) {
                    const channel = ChannelStore.getChannel(newChannelId);
                    const channelName = channel?.name ? `#${channel.name}` : "Ses Odası";

                    // Mikrofon ve Kulaklık Takipleri
                    if (settings.store.trackVoiceState) {
                        // Kendi Mikrofonunu Açma / Kapatma (Self Mute)
                        if (state.selfMute !== undefined && snapshot.selfMute !== undefined && state.selfMute !== snapshot.selfMute) {
                            dispatchStalkerNotification({
                                userId: state.userId,
                                userName,
                                userAvatar,
                                eventType: "VOICE_MUTE",
                                eventTitle: state.selfMute ? "MİKROFON KAPATILDI" : "MİKROFON AÇILDI",
                                eventDetail: `${channelName} odasında ${state.selfMute ? "mikrofonunu kapattı (Mute)" : "mikrofonunu açtı (Unmute)"}`,
                                channelId: newChannelId,
                                guildId: channel?.guild_id
                            });
                        }

                        // Kendi Kulaklığını Kapatma (Sağırlaşma) / Açma (Self Deaf)
                        if (state.selfDeaf !== undefined && snapshot.selfDeaf !== undefined && state.selfDeaf !== snapshot.selfDeaf) {
                            dispatchStalkerNotification({
                                userId: state.userId,
                                userName,
                                userAvatar,
                                eventType: "VOICE_DEAF",
                                eventTitle: state.selfDeaf ? "SAĞIRLAŞTI" : "KULAKLIK AÇILDI",
                                eventDetail: `${channelName} odasında ${state.selfDeaf ? "kulaklığını kapattı (Sağırlaştı)" : "kulaklığını açtı (Sağırlığı kaldırdı)"}`,
                                channelId: newChannelId,
                                guildId: channel?.guild_id
                            });
                        }

                        // Sunucu Susturması (Server Mute)
                        if (state.mute !== undefined && snapshot.mute !== undefined && state.mute !== snapshot.mute) {
                            dispatchStalkerNotification({
                                userId: state.userId,
                                userName,
                                userAvatar,
                                eventType: "VOICE_MUTE",
                                eventTitle: state.mute ? "SUNUCU SUSTURDU" : "SUSTURMA KALKTI",
                                eventDetail: `${channelName} odasında sunucu tarafından ${state.mute ? "susturuldu" : "susturması kaldırıldı"}`,
                                channelId: newChannelId,
                                guildId: channel?.guild_id
                            });
                        }

                        // Sunucu Sağırlaştırması (Server Deaf)
                        if (state.deaf !== undefined && snapshot.deaf !== undefined && state.deaf !== snapshot.deaf) {
                            dispatchStalkerNotification({
                                userId: state.userId,
                                userName,
                                userAvatar,
                                eventType: "VOICE_DEAF",
                                eventTitle: state.deaf ? "SUNUCU SAĞIRLAŞTIRDI" : "SAĞIRLIK KALKTI",
                                eventDetail: `${channelName} odasında sunucu tarafından ${state.deaf ? "sağırlaştırıldı" : "sağırlaştırması kaldırıldı"}`,
                                channelId: newChannelId,
                                guildId: channel?.guild_id
                            });
                        }
                    }

                    // Yayın ve Kamera Takipleri
                    if (settings.store.trackVoiceMedia) {
                        // Ekran Paylaşımı / Yayın (Stream)
                        if (state.selfStream !== undefined && snapshot.isStreaming !== undefined && state.selfStream !== snapshot.isStreaming) {
                            dispatchStalkerNotification({
                                userId: state.userId,
                                userName,
                                userAvatar,
                                eventType: "VOICE_STREAM",
                                eventTitle: state.selfStream ? "YAYIN BAŞLATTI" : "YAYIN BİTTİ",
                                eventDetail: `${channelName} odasında ${state.selfStream ? "ekran yayını başlattı" : "ekran yayınını sonlandırdı"}`,
                                channelId: newChannelId,
                                guildId: channel?.guild_id
                            });
                        }

                        // Kamera / Video (Camera)
                        if (state.selfVideo !== undefined && snapshot.isVideo !== undefined && state.selfVideo !== snapshot.isVideo) {
                            dispatchStalkerNotification({
                                userId: state.userId,
                                userName,
                                userAvatar,
                                eventType: "VOICE_VIDEO",
                                eventTitle: state.selfVideo ? "KAMERA AÇILDI" : "KAMERA KAPANDI",
                                eventDetail: `${channelName} odasında ${state.selfVideo ? "kamerasını açtı" : "kamerasını kapattı"}`,
                                channelId: newChannelId,
                                guildId: channel?.guild_id
                            });
                        }
                    }
                }

                // Snapshot durumlarını güncelle
                if (state.selfMute !== undefined) snapshot.selfMute = state.selfMute;
                if (state.selfDeaf !== undefined) snapshot.selfDeaf = state.selfDeaf;
                if (state.mute !== undefined) snapshot.mute = state.mute;
                if (state.deaf !== undefined) snapshot.deaf = state.deaf;
                if (state.selfStream !== undefined) snapshot.isStreaming = state.selfStream;
                if (state.selfVideo !== undefined) snapshot.isVideo = state.selfVideo;
                snapshot.lastUpdated = Date.now();
            }
        },

        // 2. SUNUCUYA MESAJ ATILDIĞINDA TEK SEFERLİK BİLDİRİM
        MESSAGE_CREATE(payload: any) {
            if (!settings.store.enabled || !settings.store.trackServerMessage) return;
            const authorId = payload?.message?.author?.id;
            if (!authorId) return;

            const targets = getTargetUserIds();
            if (!targets.includes(authorId)) return;

            const channelId = payload.channelId || payload.message?.channel_id;
            const channel = channelId ? ChannelStore.getChannel(channelId) : null;
            const guildId = payload.guildId || payload.message?.guild_id || channel?.guild_id;

            // Sadece sunucu mesajlarını takip et (DM / Grup sohbetleri hariç)
            if (!guildId) return;

            // Kullanıcı bu sunucuya daha önce yazdıysa tek seferlik kuralı gereği bildirim atma
            if (hasNotifiedServerMessage(authorId, guildId)) return;

            markServerMessageNotified(authorId, guildId);

            const guild = GuildStore.getGuild(guildId);
            const guildName = guild?.name || "Sunucu";
            const channelName = channel?.name ? `#${channel.name}` : "sohbet";

            const user = UserStore.getUser(authorId);
            const snapshot = getOrInitSnapshot(authorId);
            const userName = user ? (user.globalName || user.username) : (payload.message?.author?.global_name || payload.message?.author?.username || snapshot.globalName || snapshot.username || `ID: ${authorId}`);
            const userAvatar = snapshot.avatarUrl || getAvatarUrl(authorId, payload.message?.author?.avatar || user?.avatar);

            const rawContent = payload.message?.content?.trim();
            const contentPreview = rawContent
                ? (rawContent.length > 55 ? `${rawContent.substring(0, 52)}...` : rawContent)
                : (payload.message?.attachments?.length ? "[Medya / Dosya]" : "[Mesaj]");

            dispatchStalkerNotification({
                userId: authorId,
                userName,
                userAvatar,
                eventType: "SERVER_MESSAGE",
                eventTitle: "SUNUCUYA YAZDI",
                eventDetail: `${guildName} sunucusunda ${channelName} kanalına mesaj yazdı: "${contentPreview}"`,
                channelId,
                guildId,
                messageId: payload.message?.id
            });
        },

        // 2. DURUM, AKTİVİTE VE PRESENCE PROFİL OLAYLARI
        PRESENCE_UPDATES({ updates }: { updates: PresenceUpdateItem[]; }) {
            if (!settings.store.enabled) return;

            const targets = getTargetUserIds();
            if (targets.length === 0) return;

            for (const item of updates) {
                const userId = item.user?.id;
                if (!userId || !targets.includes(userId)) continue;

                // Presence paketinde gelen avatar veya kullanıcı adı değişimlerini kontrol et
                checkUserProfileDiff(userId, item.user);

                const snapshot = getOrInitSnapshot(userId);
                const user = UserStore.getUser(userId);

                // Durum Değişimi
                if (settings.store.trackStatus && item.status && item.status !== snapshot.status) {
                    const oldStatus = snapshot.status || "offline";
                    const newStatus = item.status;

                    const statusLabels: Record<string, string> = {
                        online: "Çevrimiçi",
                        idle: "Boşta",
                        dnd: "Rahatsız Etmeyin",
                        offline: "Çevrimdışı"
                    };

                    const displayName = user?.globalName || user?.username || snapshot.globalName || snapshot.username || `ID: ${userId}`;

                    dispatchStalkerNotification({
                        userId,
                        userName: displayName,
                        userAvatar: snapshot.avatarUrl || getAvatarUrl(userId, snapshot.avatar),
                        eventType: "STATUS_CHANGE",
                        eventTitle: "DURUM DEĞİŞTİ",
                        eventDetail: `Durum: ${statusLabels[oldStatus] || oldStatus} ➔ ${statusLabels[newStatus] || newStatus}`
                    });
                    snapshot.status = newStatus;
                }

                // Oyun ve Aktiviteler
                if (settings.store.trackActivity && item.activities) {
                    const currentGame = item.activities.find(a => a.type === 0)?.name;
                    const displayName = user?.globalName || user?.username || snapshot.globalName || snapshot.username || `ID: ${userId}`;

                    if (currentGame && currentGame !== snapshot.activity) {
                        dispatchStalkerNotification({
                            userId,
                            userName: displayName,
                            userAvatar: snapshot.avatarUrl || getAvatarUrl(userId, snapshot.avatar),
                            eventType: "ACTIVITY_CHANGE",
                            eventTitle: "OYUNA GİRDİ",
                            eventDetail: `${currentGame} oynamaya başladı`
                        });
                        snapshot.activity = currentGame;
                    } else if (!currentGame && snapshot.activity) {
                        snapshot.activity = undefined;
                    }
                }

                snapshot.lastUpdated = Date.now();
            }
        },

        // 3. PROFİL VE KULLANICI GÜNCELLEMELERİ
        USER_UPDATE(user: User) {
            if (!settings.store.enabled || !user?.id) return;
            checkUserProfileDiff(user.id, user);
        },

        GUILD_MEMBER_UPDATE(payload: any) {
            if (!settings.store.enabled || !payload?.user?.id) return;
            checkUserProfileDiff(payload.user.id, payload.user);
        },

        USER_PROFILE_FETCH_SUCCESS(payload: any) {
            if (!settings.store.enabled || !payload?.user?.id) return;
            checkUserProfileDiff(payload.user.id, payload.user);
        }
    }
});
