/*
 * SahteMesaj
 * Equicord / Vencord UserPlugin
 */

import { addChatBarButton, ChatBarButton, removeChatBarButton } from "@api/ChatButtons";
import { openModal } from "@utils/modal";
import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";
import type { Channel } from "@vencord/discord-types";
import {
    ChannelStore,
    FluxDispatcher,
    UserStore,
    useEffect,
    useState
} from "@webpack/common";

interface TargetUser {
    id: string;
    username: string;
    avatar: string | null;
    globalName?: string | null;
}

function buildFakeMessage(channelId: string, content: string, user: TargetUser) {
    const channel: Channel | undefined = ChannelStore.getChannel(channelId);
    if (!channel) return null;

    const fakeId = `${Date.now()}${Math.floor(Math.random() * 1000)}`;

    return {
        id: fakeId,
        type: 0,
        channel_id: channelId,
        author: {
            id: user.id,
            username: user.username,
            discriminator: "0000",
            avatar: user.avatar,
            bot: false,
            global_name: user.globalName || user.username
        },
        content,
        attachments: [],
        embeds: [],
        mentions: [],
        mention_roles: [],
        mention_everyone: false,
        pinned: false,
        edited_timestamp: null,
        flags: 0,
        components: [],
        timestamp: new Date().toISOString(),
        tts: false
    };
}

function sendFakeMessage(channelId: string, content: string, user: TargetUser) {
    const message = buildFakeMessage(channelId, content, user);
    if (!message) return;

    setTimeout(() => {
        FluxDispatcher.dispatch({
            type: "MESSAGE_CREATE",
            channelId,
            message,
            optimistic: false,
            isPushNotification: false
        });
    }, 0);
}

function FakeMessageModal({ channelId, onClose }: { channelId: string; onClose: () => void }) {
    const me = UserStore.getCurrentUser();
    const channel: any = ChannelStore.getChannel(channelId);

    const availableUsers: TargetUser[] = [];
    if (channel?.recipients && Array.isArray(channel.recipients)) {
        for (const recipientId of channel.recipients) {
            const u = UserStore.getUser(recipientId);
            if (u) {
                availableUsers.push({
                    id: u.id,
                    username: u.username,
                    avatar: u.avatar,
                    globalName: (u as any).globalName || u.username
                });
            }
        }
    }

    if (me) {
        availableUsers.push({
            id: me.id,
            username: me.username,
            avatar: me.avatar,
            globalName: (me as any).globalName || me.username
        });
    }

    const [selectedIndex, setSelectedIndex] = useState(0);
    const [content, setContent] = useState("");

    const selectedUser = availableUsers[selectedIndex] || availableUsers[0];

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        e.stopPropagation();

        if (e.key === "Escape") {
            e.preventDefault();
            onClose();
            return;
        }

        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            if (content.trim()) {
                sendFakeMessage(channelId, content, selectedUser);
                onClose();
            }
            return;
        }

        if (e.key === "ArrowUp") {
            e.preventDefault();
            setSelectedIndex((prev) => (prev > 0 ? prev - 1 : availableUsers.length - 1));
            return;
        }

        if (e.key === "ArrowDown") {
            e.preventDefault();
            setSelectedIndex((prev) => (prev < availableUsers.length - 1 ? prev + 1 : 0));
            return;
        }
    };

    return (
        <div 
            style={{
                padding: "20px",
                backgroundColor: "#313338",
                color: "white",
                borderRadius: "8px",
                width: "420px",
                boxShadow: "0 8px 24px rgba(0, 0, 0, 0.6)",
                display: "flex",
                flexDirection: "column",
                gap: "16px",
                boxSizing: "border-box"
            }}
        >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <h3 style={{ margin: 0, fontSize: "18px", fontWeight: "bold", color: "white" }}>
                    Fake Message Send.
                </h3>
            </div>

            {/* GÖNDERİCİ SEÇİMİ */}
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                <label style={{ fontSize: "12px", color: "#b5bac1", fontWeight: "bold" }}>
                    Sender (Use ↑ / ↓ to change):
                </label>
                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                    {availableUsers.map((user, idx) => {
                        const isSelected = selectedIndex === idx;
                        const avatarUrl = user.avatar 
                            ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png` 
                            : "https://cdn.discordapp.com/embed/avatars/0.png";

                        return (
                            <div
                                key={user.id}
                                style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: "10px",
                                    padding: "8px 12px",
                                    borderRadius: "6px",
                                    backgroundColor: isSelected ? "#404249" : "#1e1f22",
                                    border: isSelected ? "2px solid #5865f2" : "2px solid transparent"
                                }}
                            >
                                <img 
                                    src={avatarUrl} 
                                    alt={user.username} 
                                    style={{ width: "32px", height: "32px", borderRadius: "50%" }} 
                                />
                                <div style={{ display: "flex", flexDirection: "column" }}>
                                    <span style={{ fontSize: "14px", fontWeight: "bold", color: "white" }}>
                                        {user.globalName || user.username}
                                    </span>
                                    <span style={{ fontSize: "11px", color: "#949ba4" }}>
                                        {user.id === me?.id ? "(Your Account)" : "(The Other Side)"}
                                    </span>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* MESAJ YAZMA ALANI */}
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                <label style={{ fontSize: "12px", color: "#b5bac1", fontWeight: "bold" }}>Mesaj Metni:</label>
                <textarea
                    rows={3}
                    value={content}
                    placeholder="Type your message... (Enter: Send | Esc: Cancel | ↑↓: Select Contact)"
                    onChange={(e) => setContent(e.target.value)}
                    onKeyDown={handleKeyDown}
                    autoFocus
                    style={{ 
                        padding: "10px", 
                        borderRadius: "4px", 
                        border: "none", 
                        backgroundColor: "#1e1f22", 
                        color: "white", 
                        resize: "none",
                        fontSize: "14px",
                        outline: "none"
                    }}
                />
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", color: "#949ba4" }}>
                <span>[Enter] Send</span>
                <span>[Esc] Cancel</span>
                <span>[↑/↓] Select Contact</span>
            </div>
        </div>
    );
}

const SahteMesajChatBarButton: ChatBarButton = ({ channel }) => {
    return (
        <ChatBarButton
            tooltip="Fake Message"
            onClick={() => {
                openModal((props) => (
                    <FakeMessageModal
                        channelId={(channel as Channel).id}
                        onClose={props.onClose}
                    />
                ));
            }}
        >
            ✔
        </ChatBarButton>
    );
};

export default definePlugin({
    name: "Fake Message",

    description: "It creates a fake message in the DM inbox appearing to be from the other person.",

    tags: ["Fun", "Utility"],

    authors: [Devs.feelslove],

    start() {
        addChatBarButton("SahteMesaj", SahteMesajChatBarButton);
    },

    stop() {
        removeChatBarButton("SahteMesaj");
    }
});