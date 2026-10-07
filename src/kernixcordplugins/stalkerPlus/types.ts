/*
 * StalkerPlus - Type Definitions
 * Author: xen (https://github.com/xenover1991)
 * License: MIT
 */

export type StalkerEventType =
    | "VOICE_JOIN"
    | "VOICE_LEAVE"
    | "VOICE_MOVE"
    | "VOICE_MUTE"
    | "VOICE_DEAF"
    | "VOICE_STREAM"
    | "VOICE_VIDEO"
    | "SERVER_MESSAGE"
    | "AVATAR_CHANGE"
    | "NAME_CHANGE"
    | "STATUS_CHANGE"
    | "ACTIVITY_CHANGE"
    | "STREAM_START"
    | "CAMERA_ON";

export interface UserSnapshot {
    id: string;
    username: string;
    globalName?: string;
    avatar?: string;
    avatarUrl?: string;
    bio?: string;
    banner?: string;
    status?: string;
    activity?: string;
    channelId?: string | null;
    guildId?: string | null;
    voiceJoinedAt?: number;
    isStreaming?: boolean;
    isVideo?: boolean;
    selfMute?: boolean;
    selfDeaf?: boolean;
    mute?: boolean;
    deaf?: boolean;
    lastUpdated: number;
    initialized?: boolean;
}

export interface StalkerLog {
    id: string;
    timestamp: number;
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

export interface VoiceStateUpdate {
    userId: string;
    channelId?: string | null;
    oldChannelId?: string | null;
    deaf?: boolean;
    mute?: boolean;
    selfDeaf?: boolean;
    selfMute?: boolean;
    selfStream?: boolean;
    selfVideo?: boolean;
    sessionId?: string;
    suppress?: boolean;
    guildId?: string;
    requestToSpeakTimestamp?: string | null;
}

export interface PresenceUpdateItem {
    user: {
        id: string;
        username?: string;
        global_name?: string;
        avatar?: string;
    };
    status: string;
    clientStatus?: {
        desktop?: string;
        web?: string;
        mobile?: string;
    };
    activities?: Array<{
        name: string;
        type: number;
        details?: string;
        state?: string;
    }>;
}
