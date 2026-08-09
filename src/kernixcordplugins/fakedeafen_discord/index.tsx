import ErrorBoundary from "@components/ErrorBoundary";
import definePlugin from "@utils/types";
import { findByProps, findComponentByCodeLazy } from "@webpack";
import { Devs } from "@utils/constants";

const Button = findComponentByCodeLazy(".GREEN,positionKeyStemOverride:");
let enabled = false;
let originalSend: any;

function refresh_voice_state(enabled: boolean) {
    const ChannelStore = findByProps("getChannel", "getDMFromUserId");
    const SelectedChannelStore = findByProps("getVoiceChannelId");
    const wsModule = findByProps("getSocket");
    const MediaEngineStore = findByProps("isDeaf", "isMute");
    let caca = 0;

    if (!wsModule) {
        console.log("[FakeDeafen] WebSocket Gateway not found");
        caca += 1;
    }
    if (!SelectedChannelStore) {
        console.log("[FakeDeafen] SelectedChannelStore not found");
        caca += 1;
    }
    if (caca > 0) return;
    
    const socket = wsModule.getSocket();
    const channelId = SelectedChannelStore.getVoiceChannelId();
    const channel = channelId ? ChannelStore?.getChannel(channelId) : null;
    
    if (socket && channelId) {
        try {
            // op code 4 = voiceStateUpdate
            socket.send(4, {
                guild_id: channel?.guild_id ?? null,
                channel_id: channelId,
                self_mute: enabled || (MediaEngineStore?.isMute() ?? false),
                self_deaf: enabled || (MediaEngineStore?.isDeaf() ?? false),
                self_video: false,
                flags: 0
            });
        } catch (error) {
            console.error("[FakeDeafen] failed to update voice state:", error);
        }
    }
}

function fd_icon() {
    const iconColor = enabled ? "#ed4245" : "currentColor";
    
    return (
        <svg width="20" height="20" viewBox="0 0 32 32" fill="none">
            <rect x="6" y="8" width="20" height="4" rx="2" fill={iconColor}/>
            <rect x="11" y="3" width="10" height="8" rx="3" fill={iconColor}/>
            {enabled ? (
                <>
                    <line x1="7" y1="18" x2="13" y2="24" stroke={iconColor} strokeWidth="2"/>
                    <line x1="13" y1="18" x2="7" y2="24" stroke={iconColor} strokeWidth="2"/>
                    <line x1="19" y1="18" x2="25" y2="24" stroke={iconColor} strokeWidth="2"/>
                    <line x1="25" y1="18" x2="19" y2="24" stroke={iconColor} strokeWidth="2"/>
                    <path d="M14 23c1-1 3-1 4 0" stroke={iconColor} strokeWidth="2" strokeLinecap="round"/>
                </>
            ) : (
                <>
                    <circle cx="10" cy="21" r="4" stroke={iconColor} strokeWidth="2" fill="none"/>
                    <circle cx="22" cy="21" r="4" stroke={iconColor} strokeWidth="2" fill="none"/>
                    <path d="M14 21c1 1 3 1 4 0" stroke={iconColor} strokeWidth="2" strokeLinecap="round"/>
                </>
            )}
        </svg>
    );
}

function fd_button(props: { nameplate?: any; }) {
    return (
        <Button
            tooltipText={enabled ? "Disable Fake Deafen" : "Enable Fake Deafen"}
            icon={fd_icon}
            role="switch"
            aria-checked={enabled}
            redGlow={enabled}
            plated={props?.nameplate != null}
            onClick={() => {
                enabled = !enabled;
                refresh_voice_state(enabled);
            }}
        />
    );
}

export default definePlugin({
    name: "FakeDeafen",
    description: "Fake deafen yourself",
    authors: [Devs.feelslove],

    start() {
        const wsModule = findByProps("getSocket");
        if (!wsModule) return;
        const socket = wsModule.getSocket();
        if (!socket) return;
        
        // default send function
        originalSend = socket.send;
        
        // modify send function 
        socket.send = function (op: number, data: any, ...args: any[]) {
            // op code 4 = voiceStateUpdate don't ask me why
            if (op === 4 && enabled && data) {
                data.self_mute = true;
                data.self_deaf = true;
            }
            return originalSend.apply(this, [op, data, ...args]);
        };
    },

    stop() {
        const wsModule = findByProps("getSocket");
        if (wsModule) {
            const socket = wsModule.getSocket();
            if (socket && originalSend) {
                socket.send = originalSend;
            }
        }
    },

    patches: [
        {
            find: "#{intl::USER_PROFILE_ACCOUNT_POPOUT_BUTTON_A11Y_LABEL}",
            replacement: {
                match: /children:\[(?=.{0,25}?accountContainerRef)/,
                replace: "children:[$self.fd_button(arguments[0]),"
            }
        }
    ],

    fd_button: ErrorBoundary.wrap(fd_button, { noop: true }),
});