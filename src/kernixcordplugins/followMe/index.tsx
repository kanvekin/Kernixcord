/*
 * FollowMe plugin for Equicord
 * Adds a "Beni Takip Etsin" context-menu option and a management panel.
 */

import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { definePluginSettings } from "@api/Settings";
// Devs is imported below via this file's existing import; avoid duplicate import
import definePlugin, { OptionType } from "@utils/types";
import { Channel, User, VoiceState } from "@vencord/discord-types";
import { findByPropsLazy, findStoreLazy } from "@webpack";
import { Forms, Menu, React, VoiceStateStore, RestAPI, PermissionStore, PermissionsBits, ChannelStore, Toasts, Button } from "@webpack/common";
import { Devs } from "@utils/constants";
import { HeaderBarButton } from "@api/HeaderBar";
import { Modal, openModal } from "@webpack/common";

interface UserContextProps {
    channel: Channel;
    user: User;
    guildId?: string;
}

type TFollower = { userId: string; addedAt: number; };

const settings = definePluginSettings({
    onlyWhenInVoice: {
        type: OptionType.BOOLEAN,
        default: true,
        description: "Sadece siz sesliyken takipçileri taşı"
    },
    followers: {
        type: OptionType.STRING,
        description: "Internal: JSON array of follower objects",
        hidden: true,
        default: "[]"
    }
    ,
    following: {
        type: OptionType.STRING,
        description: "Internal: JSON array of users you follow",
        hidden: true,
        default: "[]"
    }
});

function getFollowers(): TFollower[] {
    try { return JSON.parse(settings.store.followers || "[]"); } catch { return []; }
}

function saveFollowers(list: TFollower[]) { settings.store.followers = JSON.stringify(list); }
function isFollower(id: string) { return getFollowers().some(f => f.userId === id); }
function addFollower(id: string) { const list = getFollowers(); if (!list.some(l => l.userId === id)) { list.push({ userId: id, addedAt: Date.now() }); saveFollowers(list); } }
function removeFollower(id: string) { saveFollowers(getFollowers().filter(f => f.userId !== id)); }

type TFollowing = { userId: string; addedAt: number; };

function getFollowing(): TFollowing[] { try { return JSON.parse(settings.store.following || "[]"); } catch { return []; } }
function saveFollowing(list: TFollowing[]) { settings.store.following = JSON.stringify(list); }
function isFollowing(id: string) { return getFollowing().some(f => f.userId === id); }
function addFollowing(id: string) { const list = getFollowing(); if (!list.some(l => l.userId === id)) { list.push({ userId: id, addedAt: Date.now() }); saveFollowing(list); } }
function removeFollowing(id: string) { saveFollowing(getFollowing().filter(f => f.userId !== id)); }

const UserStore = findStoreLazy("UserStore");
const voiceChannelAction = findByPropsLazy("selectVoiceChannel");

let modalKey: string | null = null;

function FollowMeModal({ props }: { props: any; }) {
    const [, setR] = React.useState(0);
    const refresh = () => setR(r => r + 1);

    const followers = getFollowers();
    const following = getFollowing();

    return (
        <Modal {...props} size="lg" title="FollowMe Yönetim" actions={[{ text: "Kapat", onClick: () => props.onClose() }]}>
            <div style={{ display: 'flex', gap: 16 }}>
                <div style={{ flex: 1 }}>
                    <h4>Takipçiler</h4>
                    {followers.length === 0 && <Forms.FormText>Hiç takipçi yok.</Forms.FormText>}
                    {followers.map(f => {
                        const u = UserStore.getUser(f.userId);
                        const display = u ? `${u.id} / ${u.username}${(u as any).discriminator ? "#" + (u as any).discriminator : ""} / ${(u as any).global_name ?? u.username}` : f.userId;
                        return (
                            <div key={f.userId} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                                <Forms.FormText>{display}</Forms.FormText>
                                <Button className="vc-btn vc-btn-danger" onClick={() => { removeFollower(f.userId); Toasts.show(Toasts.create("Takipçi kaldırıldı.", Toasts.Type.SUCCESS)); refresh(); }}>Kaldır</Button>
                            </div>
                        );
                    })}
                </div>
                <div style={{ flex: 1 }}>
                    <h4>Takip Ettiklerim</h4>
                    {following.length === 0 && <Forms.FormText>Hiç takip yok.</Forms.FormText>}
                    {following.map(f => {
                        const u = UserStore.getUser(f.userId);
                        const display = u ? `${u.id} / ${u.username}${(u as any).discriminator ? "#" + (u as any).discriminator : ""} / ${(u as any).global_name ?? u.username}` : f.userId;
                        return (
                            <div key={f.userId} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                                <Forms.FormText>{display}</Forms.FormText>
                                <Button className="vc-btn vc-btn-danger" onClick={() => { removeFollowing(f.userId); Toasts.show(Toasts.create("Takipten çıkarıldı.", Toasts.Type.SUCCESS)); refresh(); }}>Kaldır</Button>
                            </div>
                        );
                    })}
                </div>
            </div>
        </Modal>
    );
}

function openFollowMeModal() {
    openModal((props: any) => (
        <FollowMeModal props={props} />
    ));
}

const UserContextMenuPatch: NavContextMenuPatchCallback = (children, { user }: UserContextProps) => {
    if (UserStore.getCurrentUser().id === user.id) return;
    const [isFollowMeChecked, setFollowMeChecked] = React.useState(isFollower(user.id));
    const [isFollowUserChecked, setFollowUserChecked] = React.useState(isFollowing(user.id));

    children.push(
        <Menu.MenuSeparator />,
        <Menu.MenuCheckboxItem
            id="followme-follow-toggle"
            label="Beni Takip Etsin"
            checked={isFollowMeChecked}
            action={() => {
                if (isFollower(user.id)) { removeFollower(user.id); setFollowMeChecked(false); Toasts.show(Toasts.create("Takipçi kaldırıldı.", Toasts.Type.SUCCESS)); }
                else { addFollower(user.id); setFollowMeChecked(true); Toasts.show(Toasts.create("Takipçi eklendi.", Toasts.Type.SUCCESS)); }
            }}
        />,
        <Menu.MenuCheckboxItem
            id="followme-follow-user-toggle"
            label="Onu Takip Et"
            checked={isFollowUserChecked}
            action={() => {
                if (isFollowing(user.id)) { removeFollowing(user.id); setFollowUserChecked(false); Toasts.show(Toasts.create("Takipten çıkarıldı.", Toasts.Type.SUCCESS)); }
                else { addFollowing(user.id); setFollowUserChecked(true); Toasts.show(Toasts.create("Takip eklendi.", Toasts.Type.SUCCESS)); }
            }}
        />
    );
};

export default definePlugin({
    name: "FollowMe",
    description: "Seçtiğin kullanıcıların seni takip edip ses odalarına taşınmasını sağlar.",
    authors: [Devs.feelslove],
    dependencies: ["HeaderBarAPI"],
    settings,
    settingsAboutComponent: () => (
        <Forms.FormText className="plugin-warning">Seçtiğin kullanıcılar senin hesabının taşıma yetkisini kullanarak seni takip etmeye çalışacak. Yönetimi başlık çubuğundaki butondan açabilirsin.</Forms.FormText>
    ),
    flux: {
        async VOICE_STATE_UPDATES({ voiceStates }: { voiceStates: VoiceState[]; }) {
            try {
                const me = UserStore.getCurrentUser();
                if (!me) return;

                if (settings.store.onlyWhenInVoice && VoiceStateStore.getVoiceStateForUser(me.id) == null) return;

                for (const vs of voiceStates) {
                    // If I moved, try to move my followers
                    if (vs.userId === me.id) {
                        const newChannelId = vs.channelId ?? null;
                        if (!newChannelId) continue;

                        const guildId = (ChannelStore.getChannel(newChannelId) as any)?.guild_id || (ChannelStore.getChannel(newChannelId) as any)?.guildId;
                        if (!guildId) continue;

                        const followers = getFollowers();
                        for (const f of followers) {
                            try {
                                const followerVoice = VoiceStateStore.getVoiceStateForUser(f.userId);
                                if (followerVoice && followerVoice.channelId === newChannelId) continue;

                                const targetChannel = ChannelStore.getChannel(newChannelId);
                                if (!targetChannel) continue;

                                const canMove = PermissionStore.can(PermissionsBits.MOVE_MEMBERS, targetChannel);
                                if (!canMove) continue;

                                await RestAPI.patch({ url: `/guilds/${guildId}/members/${f.userId}`, body: { channel_id: newChannelId } });
                            } catch (e) {
                                console.error("FollowMe: failed to move", f.userId, e);
                            }
                        }
                        continue;
                    }

                    // If someone I follow moved, try to move myself to them
                    if (isFollowing(vs.userId)) {
                        const targetChannelId = vs.channelId ?? null;
                        if (!targetChannelId) continue;

                        // If settings require being in voice to follow, check
                        if (settings.store.onlyWhenInVoice && VoiceStateStore.getVoiceStateForUser(me.id) === null) continue;

                        const followerVoice = VoiceStateStore.getVoiceStateForUser(me.id);
                        if (followerVoice && followerVoice.channelId === targetChannelId) continue;

                        // Move self by selecting voice channel
                        try {
                            voiceChannelAction.selectVoiceChannel(targetChannelId);
                        } catch (e) {
                            console.error("FollowMe: failed to selectVoiceChannel for following", vs.userId, e);
                        }
                    }
                }
            } catch (e) {
                console.error("FollowMe: VOICE_STATE_UPDATES error", e);
            }
        }
    },
    contextMenus: { "user-context": UserContextMenuPatch },
    headerBarButton: {
        icon: (props: any) => (
            <svg viewBox="0 0 24 24" width={18} height={18} fill="currentColor" {...props}>
                <path d="M12 2a5 5 0 00-5 5v1H6a2 2 0 00-2 2v6h16v-6a2 2 0 00-2-2h-1V7a5 5 0 00-5-5zm-1 14H8v-2h3v2zm6 0h-3v-2h3v2zM9 9V7a3 3 0 116 0v2H9z" />
            </svg>
        ),
        render: () => (
            <HeaderBarButton
                icon={(props: any) => (
                    <svg viewBox="0 0 24 24" width={18} height={18} fill="currentColor" {...props}>
                        <path d="M12 2a5 5 0 00-5 5v1H6a2 2 0 00-2 2v6h16v-6a2 2 0 00-2-2h-1V7a5 5 0 00-5-5zm-1 14H8v-2h3v2zm6 0h-3v-2h3v2zM9 9V7a3 3 0 116 0v2H9z" />
                    </svg>
                )}
                tooltip="FollowMe Yönetimi"
                onClick={() => openFollowMeModal()}
            />
        )
    }
});
