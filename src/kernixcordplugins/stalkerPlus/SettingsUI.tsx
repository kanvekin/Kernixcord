/*
 * StalkerPlus - Tactical Surveillance Command Center (Türkçe Arayüz)
 * Author: xen (https://github.com/xenover1991)
 * License: MIT
 */

import { ChannelStore, React, SelectedChannelStore, Toasts, useEffect, useMemo, useState, UserStore } from "@webpack/common";

import {
    clearNotifiedServerMessages,
    clearStalkerLogs,
    dispatchStalkerNotification,
    formatDuration,
    getNotifiedServerMessages,
    getOrInitSnapshot,
    getStalkerLogs,
    getTargetUserIds,
    playStalkerAudioCue,
    removeTargetUserId,
    settings,
    setTargetUserIds
} from "./index";

interface TacticalSwitchProps {
    checked: boolean;
    onChange: (val: boolean) => void;
}

function TacticalSwitch({ checked, onChange }: TacticalSwitchProps) {
    return (
        <div
            className={`sp-tactical-switch ${checked ? "on" : ""}`}
            onClick={() => onChange(!checked)}
            role="switch"
            aria-checked={checked}
        >
            <div className="sp-tactical-thumb" />
        </div>
    );
}

export function StalkerSettings() {
    settings.use([
        "enabled",
        "trackVoiceJoin",
        "trackVoiceLeave",
        "trackVoiceMove",
        "trackVoiceState",
        "trackVoiceMedia",
        "trackServerMessage",
        "notifiedServerMessages",
        "persistedLogs",
        "trackAvatar",
        "trackName",
        "trackStatus",
        "trackActivity",
        "soundAlert",
        "desktopNotifications",
        "targetUserIds"
    ]);

    const [activeTab, setActiveTab] = useState<"sensors" | "dossiers" | "wiretap" | "diagnostics">("sensors");
    const [userIdInput, setUserIdInput] = useState("");
    const [logs, setLogs] = useState(getStalkerLogs());

    useEffect(() => {
        const interval = setInterval(() => {
            setLogs(getStalkerLogs());
        }, 1000);
        return () => clearInterval(interval);
    }, []);

    const isEnabled = settings.store.enabled;
    const targetIds = useMemo(() => getTargetUserIds(), [settings.store.targetUserIds]);

    const currentVoiceChannelId = SelectedChannelStore.getVoiceChannelId();
    const currentVoiceChannel = currentVoiceChannelId ? ChannelStore.getChannel(currentVoiceChannelId) : null;

    const activeSensorsCount = [
        settings.store.trackVoiceJoin,
        settings.store.trackVoiceLeave,
        settings.store.trackVoiceMove,
        settings.store.trackVoiceState,
        settings.store.trackVoiceMedia,
        settings.store.trackServerMessage,
        settings.store.trackAvatar,
        settings.store.trackName,
        settings.store.trackStatus,
        settings.store.trackActivity
    ].filter(Boolean).length;

    const handleAddTarget = () => {
        const cleanId = userIdInput.trim();
        if (!cleanId || !/^\d{16,21}$/.test(cleanId)) {
            Toasts.show({
                message: "Geçersiz Discord Kullanıcı ID formatı. (17-20 haneli rakam olmalıdır)",
                type: Toasts.Type.FAILURE,
                id: Toasts.genId()
            });
            return;
        }

        if (targetIds.includes(cleanId)) {
            Toasts.show({
                message: "Bu hedef zaten izleme listesinde mevcut.",
                type: Toasts.Type.DEFAULT,
                id: Toasts.genId()
            });
            return;
        }

        setTargetUserIds([...targetIds, cleanId]);
        setUserIdInput("");
        const user = UserStore.getUser(cleanId);
        const name = user ? (user.globalName || user.username) : cleanId;
        Toasts.show({
            message: `[StalkerPlus] ${name} izleme listesine eklendi.`,
            type: Toasts.Type.SUCCESS,
            id: Toasts.genId()
        });
    };

    return (
        <div className="sp-deck">
            {/* Header Deck */}
            <div className="sp-deck-header">
                <div className="sp-brand">
                    <h2 className="sp-deck-title">STALKER PLUS</h2>
                </div>

                <div
                    className={`sp-arm-btn ${isEnabled ? "armed" : ""}`}
                    onClick={() => {
                        settings.store.enabled = !isEnabled;
                        if (!isEnabled && settings.store.soundAlert) playStalkerAudioCue();
                    }}
                >
                    <span className="sp-arm-label">AÇ/KAPAT</span>
                    <TacticalSwitch
                        checked={isEnabled}
                        onChange={v => { settings.store.enabled = v; }}
                    />
                </div>
            </div>

            {/* Radar Metrics Bar */}
            <div className="sp-radar-bar">
                <div className="sp-radar-cell">
                    <span className="sp-radar-label">SES BAĞLANTISI</span>
                    <span className="sp-radar-val">
                        {currentVoiceChannel ? `#${currentVoiceChannel.name}` : "BAĞLANTI YOK"}
                    </span>
                </div>
                <div className="sp-radar-cell">
                    <span className="sp-radar-label">İZLENEN HEDEFLER</span>
                    <span className="sp-radar-val">{targetIds.length} HEDEF</span>
                </div>
                <div className="sp-radar-cell">
                    <span className="sp-radar-label">AKTİF SENSÖRLER</span>
                    <span className="sp-radar-val">{activeSensorsCount} / 10 AKTİF</span>
                </div>
                <div className="sp-radar-cell">
                    <span className="sp-radar-label">YAKALANAN OLAYLAR</span>
                    <span className="sp-radar-val">{logs.length} OLAY</span>
                </div>
            </div>

            {/* Segmented Tactical Nav */}
            <div className="sp-deck-nav">
                <button
                    className={`sp-deck-tab ${activeTab === "sensors" ? "active" : ""}`}
                    onClick={() => setActiveTab("sensors")}
                >
                    SEÇENEKLER
                </button>
                <button
                    className={`sp-deck-tab ${activeTab === "dossiers" ? "active" : ""}`}
                    onClick={() => setActiveTab("dossiers")}
                >
                    HEDEF LİSTESİ ({targetIds.length})
                </button>
                <button
                    className={`sp-deck-tab ${activeTab === "wiretap" ? "active" : ""}`}
                    onClick={() => setActiveTab("wiretap")}
                >
                    LOG ({logs.length})
                </button>
                <button
                    className={`sp-deck-tab ${activeTab === "diagnostics" ? "active" : ""}`}
                    onClick={() => setActiveTab("diagnostics")}
                >
                    TEST
                </button>
            </div>

            {/* Tab 1: Sensor Grid (Modular 2x2 Layout) */}
            {activeTab === "sensors" && (
                <div className="sp-deck-panel">
                    <div className="sp-sensor-grid">
                        {/* Module 1: Voice Radar */}
                        <div className="sp-sensor-card">
                            <div className="sp-sensor-card-header">
                                <span className="sp-sensor-card-title">SES SEÇENEKLERİ</span>
                                <span className="sp-sensor-card-badge">SES</span>
                            </div>
                            <div className="sp-sensor-items">
                                <div className="sp-sensor-item">
                                    <div className="sp-sensor-item-info">
                                        <span className="sp-sensor-item-name">Sese Giriş</span>
                                        <span className="sp-sensor-item-desc">Hedef bir ses kanalına katıldığında bildir</span>
                                    </div>
                                    <TacticalSwitch
                                        checked={settings.store.trackVoiceJoin}
                                        onChange={v => { settings.store.trackVoiceJoin = v; }}
                                    />
                                </div>
                                <div className="sp-sensor-item">
                                    <div className="sp-sensor-item-info">
                                        <span className="sp-sensor-item-name">Sesten Çıkış & Süre</span>
                                        <span className="sp-sensor-item-desc">Kanalda geçirilen süreyle birlikte bildir</span>
                                    </div>
                                    <TacticalSwitch
                                        checked={settings.store.trackVoiceLeave}
                                        onChange={v => { settings.store.trackVoiceLeave = v; }}
                                    />
                                </div>
                                <div className="sp-sensor-item">
                                    <div className="sp-sensor-item-info">
                                        <span className="sp-sensor-item-name">Kanal Geçişi</span>
                                        <span className="sp-sensor-item-desc">Hedef oda değiştirdiğinde (#Oda1 ➔ #Oda2) bildir</span>
                                    </div>
                                    <TacticalSwitch
                                        checked={settings.store.trackVoiceMove}
                                        onChange={v => { settings.store.trackVoiceMove = v; }}
                                    />
                                </div>
                                <div className="sp-sensor-item">
                                    <div className="sp-sensor-item-info">
                                        <span className="sp-sensor-item-name">Mikrofon & Kulaklık</span>
                                        <span className="sp-sensor-item-desc">Mikrofon susturma (Mute) ve kulaklık kapatma (Deaf)</span>
                                    </div>
                                    <TacticalSwitch
                                        checked={settings.store.trackVoiceState}
                                        onChange={v => { settings.store.trackVoiceState = v; }}
                                    />
                                </div>
                                <div className="sp-sensor-item">
                                    <div className="sp-sensor-item-info">
                                        <span className="sp-sensor-item-name">Yayın & Kamera</span>
                                        <span className="sp-sensor-item-desc">Ekran paylaşımı (Stream) ve kamera durumları</span>
                                    </div>
                                    <TacticalSwitch
                                        checked={settings.store.trackVoiceMedia}
                                        onChange={v => { settings.store.trackVoiceMedia = v; }}
                                    />
                                </div>
                            </div>
                        </div>

                        {/* Module 2: Server Message Tracking */}
                        <div className="sp-sensor-card">
                            <div className="sp-sensor-card-header">
                                <span className="sp-sensor-card-title">SUNUCU MESAJ TAKİBİ</span>
                                <span className="sp-sensor-card-badge">MESAJ</span>
                            </div>
                            <div className="sp-sensor-items">
                                <div className="sp-sensor-item">
                                    <div className="sp-sensor-item-info">
                                        <span className="sp-sensor-item-name">İlk Mesaj Bildirimi (1 Seferlik)</span>
                                        <span className="sp-sensor-item-desc">
                                            Kullanıcı bir sunucuya yazdığında (aktif/çevrimdışı fark etmeksizin) tek seferlik bildir
                                        </span>
                                    </div>
                                    <TacticalSwitch
                                        checked={settings.store.trackServerMessage}
                                        onChange={v => { settings.store.trackServerMessage = v; }}
                                    />
                                </div>
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingTop: "10px", borderTop: "1px dashed #1c1c24" }}>
                                    <div style={{ fontSize: "11px", color: "#64748b", fontFamily: "ui-monospace, monospace" }}>
                                        Bildirilen sunucular: <strong>{getNotifiedServerMessages().length} kayıt</strong>
                                    </div>
                                    <button
                                        className="sp-redact-btn"
                                        style={{ fontSize: "9.5px", padding: "4px 8px" }}
                                        onClick={() => {
                                            clearNotifiedServerMessages();
                                            Toasts.show({
                                                message: "[StalkerPlus] Mesaj bildirim geçmişi sıfırlandı. Tekrar yazdıklarında bildirim gelecektir.",
                                                type: Toasts.Type.SUCCESS,
                                                id: Toasts.genId()
                                            });
                                        }}
                                    >
                                        HAFIZAYI SIFIRLA
                                    </button>
                                </div>
                            </div>
                        </div>

                        {/* Module 3: Biometric Identity */}
                        <div className="sp-sensor-card">
                            <div className="sp-sensor-card-header">
                                <span className="sp-sensor-card-title">PROFİL</span>
                                <span className="sp-sensor-card-badge">PROFİL</span>
                            </div>
                            <div className="sp-sensor-items">
                                <div className="sp-sensor-item">
                                    <div className="sp-sensor-item-info">
                                        <span className="sp-sensor-item-name">Avatar Değişimi</span>
                                        <span className="sp-sensor-item-desc">Eski ve yeni avatarı karşılaştırarak bildir</span>
                                    </div>
                                    <TacticalSwitch
                                        checked={settings.store.trackAvatar}
                                        onChange={v => { settings.store.trackAvatar = v; }}
                                    />
                                </div>
                                <div className="sp-sensor-item">
                                    <div className="sp-sensor-item-info">
                                        <span className="sp-sensor-item-name">İsim ve Kullanıcı Adı</span>
                                        <span className="sp-sensor-item-desc">Kullanıcı adı veya görünen ad değişimlerini bildir</span>
                                    </div>
                                    <TacticalSwitch
                                        checked={settings.store.trackName}
                                        onChange={v => { settings.store.trackName = v; }}
                                    />
                                </div>
                            </div>
                        </div>

                        {/* Module 4: Telemetry & Presence */}
                        <div className="sp-sensor-card">
                            <div className="sp-sensor-card-header">
                                <span className="sp-sensor-card-title">DURUM</span>
                                <span className="sp-sensor-card-badge">DURUM</span>
                            </div>
                            <div className="sp-sensor-items">
                                <div className="sp-sensor-item">
                                    <div className="sp-sensor-item-info">
                                        <span className="sp-sensor-item-name">Durum Geçişleri</span>
                                        <span className="sp-sensor-item-desc">Çevrimiçi, Boşta, Rahatsız Etmeyin ve Çevrimdışı</span>
                                    </div>
                                    <TacticalSwitch
                                        checked={settings.store.trackStatus}
                                        onChange={v => { settings.store.trackStatus = v; }}
                                    />
                                </div>
                                <div className="sp-sensor-item">
                                    <div className="sp-sensor-item-info">
                                        <span className="sp-sensor-item-name">Oyun ve Müzik</span>
                                        <span className="sp-sensor-item-desc">Oyun başlatma ve Spotify dinleme aktiviteleri</span>
                                    </div>
                                    <TacticalSwitch
                                        checked={settings.store.trackActivity}
                                        onChange={v => { settings.store.trackActivity = v; }}
                                    />
                                </div>
                            </div>
                        </div>

                        {/* Module 5: Alert Dispatch */}
                        <div className="sp-sensor-card">
                            <div className="sp-sensor-card-header">
                                <span className="sp-sensor-card-title">BİLDİRİMLER</span>
                                <span className="sp-sensor-card-badge">UYARI</span>
                            </div>
                            <div className="sp-sensor-items">
                                <div className="sp-sensor-item">
                                    <div className="sp-sensor-item-info">
                                        <span className="sp-sensor-item-name">Akustik Ses Uyarısı</span>
                                        <span className="sp-sensor-item-desc">Olay yakalandığında kulağı yormayan yumuşak bir bildirim sesi çal</span>
                                    </div>
                                    <TacticalSwitch
                                        checked={settings.store.soundAlert}
                                        onChange={v => { settings.store.soundAlert = v; }}
                                    />
                                </div>
                                <div className="sp-sensor-item">
                                    <div className="sp-sensor-item-info">
                                        <span className="sp-sensor-item-name">Masaüstü Bildirimleri</span>
                                        <span className="sp-sensor-item-desc">Discord arkadayken Windows masaüstü bildirimi gönder</span>
                                    </div>
                                    <TacticalSwitch
                                        checked={settings.store.desktopNotifications}
                                        onChange={v => { settings.store.desktopNotifications = v; }}
                                    />
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Tab 2: Target Dossiers */}
            {activeTab === "dossiers" && (
                <div className="sp-deck-panel">
                    <div className="sp-command-bar">
                        <input
                            type="text"
                            className="sp-cmd-input"
                            placeholder="> HEDEF KULLANICI ID'Sİ GİRİN (örn: 206993987125510144)..."
                            value={userIdInput}
                            onChange={e => setUserIdInput(e.target.value)}
                            onKeyDown={e => { if (e.key === "Enter") handleAddTarget(); }}
                        />
                        <button className="sp-cmd-btn" onClick={handleAddTarget}>
                            + HEDEFİ EKLE
                        </button>
                    </div>

                    <div style={{ fontSize: "11px", color: "#64748b", fontFamily: "ui-monospace, monospace" }}>
                        💡 <strong>İPUCU:</strong> Discord&apos;da herhangi bir kullanıcıya sağ tıklayıp <em>&quot;Stalk Listesine Ekle&quot;</em> diyerek de anında ekleyebilirsiniz.
                    </div>

                    {targetIds.length === 0 ? (
                        <div className="sp-empty-state">
                            <span className="sp-empty-title">[ HEDEF LİSTESİ BOŞ ]</span>
                            <span className="sp-empty-desc">
                                Şu anda izlenen hedef bulunmuyor. Yukarıya bir Discord Kullanıcı ID&apos;si girin veya Discord içinde bir kullanıcıya sağ tıklayın.
                            </span>
                        </div>
                    ) : (
                        <div className="sp-dossiers-list">
                            {targetIds.map(userId => {
                                const user = UserStore.getUser(userId);
                                const displayName = user ? (user.globalName || user.username) : "Bilinmeyen Kullanıcı";
                                const tag = user ? `@${user.username}` : userId;
                                const avatar = user && typeof user.getAvatarURL === "function" ? user.getAvatarURL(undefined, 80, true) : null;
                                const snap = getOrInitSnapshot(userId);
                                const voiceChannel = snap.channelId ? ChannelStore.getChannel(snap.channelId) : null;

                                return (
                                    <div key={userId} className="sp-dossier-card">
                                        <div className="sp-dossier-profile">
                                            <div className="sp-dossier-avatar-wrap">
                                                {avatar ? (
                                                    <img src={avatar} alt="" className="sp-dossier-avatar" />
                                                ) : (
                                                    <div className="sp-dossier-avatar-fallback">ID</div>
                                                )}
                                            </div>
                                            <div className="sp-dossier-info">
                                                <span className="sp-dossier-name">{displayName}</span>
                                                <div className="sp-dossier-meta">
                                                    <span>{tag}</span>
                                                    <span>•</span>
                                                    <span>ID: {userId}</span>
                                                </div>
                                                {snap.channelId && (
                                                    <div className="sp-dossier-voice-capsule">
                                                        <span className="sp-dossier-voice-tag">
                                                            🎙️ #{voiceChannel?.name || "Ses Odası"}
                                                        </span>
                                                        {snap.voiceJoinedAt && (
                                                            <span className="sp-dossier-voice-duration">
                                                                ⏱️ {formatDuration(Date.now() - snap.voiceJoinedAt)}
                                                            </span>
                                                        )}
                                                        {snap.selfMute && <span className="sp-dossier-vicon" title="Mikrofon Susturuldu">🔇 Mute</span>}
                                                        {snap.selfDeaf && <span className="sp-dossier-vicon" title="Kulaklık Kapatıldı">🎧 Deaf</span>}
                                                        {snap.isStreaming && <span className="sp-dossier-vicon live" title="Yayın Açık">📺 Canlı</span>}
                                                        {snap.isVideo && <span className="sp-dossier-vicon cam" title="Kamera Açık">📷 Kamera</span>}
                                                    </div>
                                                )}
                                            </div>
                                        </div>

                                        <div className="sp-dossier-actions">
                                            <button
                                                className="sp-redact-btn"
                                                onClick={() => removeTargetUserId(userId)}
                                            >
                                                HEDEFİ KALDIR
                                            </button>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            )}

            {/* Tab 3: Wiretap Stream (Terminal Output) */}
            {activeTab === "wiretap" && (
                <div className="sp-deck-panel">
                    <div className="sp-terminal-box">
                        <div className="sp-terminal-header">
                            <div className="sp-terminal-title">
                                <span className="sp-reticle-dot" />
                                <span>GERÇEK ZAMANLI LOG [{logs.length} OLAY]</span>
                                <span style={{ fontSize: "9px", color: "#22c55e", background: "rgba(34, 197, 94, 0.12)", border: "1px solid rgba(34, 197, 94, 0.25)", padding: "1px 6px", borderRadius: "3px", fontWeight: "700" }}>
                                    💾 KALICI HAFIZA AKTİF
                                </span>
                            </div>
                            {logs.length > 0 && (
                                <button
                                    className="sp-redact-btn"
                                    style={{ padding: "3px 8px", fontSize: "9px" }}
                                    onClick={() => {
                                        clearStalkerLogs();
                                        setLogs([]);
                                    }}
                                >
                                    AKIŞI TEMİZLE
                                </button>
                            )}
                        </div>

                        {logs.length === 0 ? (
                            <div className="sp-empty-state" style={{ padding: "28px 12px" }}>
                                <span className="sp-empty-title">[ AKIŞ TEMİZ ]</span>
                                <span className="sp-empty-desc">
                                    Henüz yakalanan bir aktivite paketi kaydedilmedi. Hedef olayları bekleniyor.
                                </span>
                            </div>
                        ) : (
                            <div className="sp-terminal-lines">
                                {logs.map(log => {
                                    const isToday = new Date(log.timestamp).toDateString() === new Date().toDateString();
                                    const ts = isToday
                                        ? new Date(log.timestamp).toLocaleTimeString()
                                        : `${new Date(log.timestamp).toLocaleDateString([], { month: "numeric", day: "numeric" })} ${new Date(log.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;

                                    return (
                                        <div key={log.id} className="sp-wiretap-entry">
                                            <span className="sp-wiretap-ts">
                                                [{ts}]
                                            </span>
                                            <span className="sp-wiretap-badge">{log.eventTitle}</span>
                                            <span className="sp-wiretap-agent">&gt; {log.userName}</span>
                                            <span className="sp-wiretap-detail">: {log.eventDetail}</span>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Tab 4: Diagnostics & Pulse Simulator */}
            {activeTab === "diagnostics" && (
                <div className="sp-deck-panel">
                    <div className="sp-sensor-grid">
                        <div className="sp-sensor-card">
                            <div className="sp-sensor-card-header">
                                <span className="sp-sensor-card-title">TEST: SESE GİRİŞ</span>
                                <span className="sp-sensor-card-badge">TEST</span>
                            </div>
                            <span className="sp-sensor-item-desc">
                                Sağ alttaki bildirim kartını ve ses uyarısını test etmek için sahte sese giriş bildirimi gönderir.
                            </span>
                            <button
                                className="sp-cmd-btn"
                                onClick={() => {
                                    const cur = UserStore.getCurrentUser();
                                    dispatchStalkerNotification({
                                        userId: cur?.id || "0",
                                        userName: cur?.globalName || cur?.username || "xen",
                                        userAvatar: cur?.getAvatarURL(undefined, 80, true),
                                        eventType: "VOICE_JOIN",
                                        eventTitle: "SESE GİRDİ",
                                        eventDetail: "#Genel-Sohbet ses odasına katıldı (Sunucu)"
                                    });
                                }}
                            >
                                SESE GİRİŞİ TEST ET
                            </button>
                        </div>

                        <div className="sp-sensor-card">
                            <div className="sp-sensor-card-header">
                                <span className="sp-sensor-card-title">TEST: SESTEN ÇIKIŞ & SÜRE</span>
                                <span className="sp-sensor-card-badge">TEST</span>
                            </div>
                            <span className="sp-sensor-item-desc">
                                Ses kanalında geçirilen süreyi içeren sesten ayrılma bildirimini simüle eder.
                            </span>
                            <button
                                className="sp-cmd-btn"
                                onClick={() => {
                                    const cur = UserStore.getCurrentUser();
                                    dispatchStalkerNotification({
                                        userId: cur?.id || "0",
                                        userName: cur?.globalName || cur?.username || "xen",
                                        userAvatar: cur?.getAvatarURL(undefined, 80, true),
                                        eventType: "VOICE_LEAVE",
                                        eventTitle: "SESTEN ÇIKTI",
                                        eventDetail: "#Genel-Sohbet (Sunucu) odasından ayrıldı • Süre: 42 dk 15 sn",
                                        duration: "42 dk 15 sn"
                                    });
                                }}
                            >
                                SESTEN ÇIKIŞI TEST ET
                            </button>
                        </div>

                        <div className="sp-sensor-card">
                            <div className="sp-sensor-card-header">
                                <span className="sp-sensor-card-title">TEST: MİKROFON DURUMU</span>
                                <span className="sp-sensor-card-badge">TEST</span>
                            </div>
                            <span className="sp-sensor-item-desc">
                                Kullanıcının ses odasındayken mikrofonunu kapattığı (Mute) ses durumu bildirimini simüle eder.
                            </span>
                            <button
                                className="sp-cmd-btn"
                                onClick={() => {
                                    const cur = UserStore.getCurrentUser();
                                    dispatchStalkerNotification({
                                        userId: cur?.id || "0",
                                        userName: cur?.globalName || cur?.username || "xen",
                                        userAvatar: cur?.getAvatarURL(undefined, 80, true),
                                        eventType: "VOICE_MUTE",
                                        eventTitle: "MİKROFON KAPATILDI",
                                        eventDetail: "#Genel-Sohbet odasında mikrofonunu kapattı (Mute)"
                                    });
                                }}
                            >
                                MİKROFONU TEST ET
                            </button>
                        </div>

                        <div className="sp-sensor-card">
                            <div className="sp-sensor-card-header">
                                <span className="sp-sensor-card-title">TEST: SUNUCUYA YAZDI</span>
                                <span className="sp-sensor-card-badge">TEST</span>
                            </div>
                            <span className="sp-sensor-item-desc">
                                Hedef bir sunucuya mesaj attığında tetiklenen tek seferlik bildirim kartını ve mesaja gitme butonunu test eder.
                            </span>
                            <button
                                className="sp-cmd-btn"
                                onClick={() => {
                                    const cur = UserStore.getCurrentUser();
                                    dispatchStalkerNotification({
                                        userId: cur?.id || "0",
                                        userName: cur?.globalName || cur?.username || "xen",
                                        userAvatar: cur?.getAvatarURL(undefined, 80, true),
                                        eventType: "SERVER_MESSAGE",
                                        eventTitle: "SUNUCUYA YAZDI",
                                        eventDetail: 'Vencord Topluluğu sunucusunda #genel-sohbet kanalına mesaj yazdı: "selam millet, nasılsınız?"'
                                    });
                                }}
                            >
                                SUNUCU MESAJINI TEST ET
                            </button>
                        </div>

                        <div className="sp-sensor-card">
                            <div className="sp-sensor-card-header">
                                <span className="sp-sensor-card-title">TEST: AVATAR DEĞİŞİMİ</span>
                                <span className="sp-sensor-card-badge">TEST</span>
                            </div>
                            <span className="sp-sensor-item-desc">
                                Eski ve yeni avatarın yan yana karşılaştırıldığı bildirim kartını test eder.
                            </span>
                            <button
                                className="sp-cmd-btn"
                                onClick={() => {
                                    const cur = UserStore.getCurrentUser();
                                    const av = cur?.getAvatarURL(undefined, 80, true);
                                    dispatchStalkerNotification({
                                        userId: cur?.id || "0",
                                        userName: cur?.globalName || cur?.username || "xen",
                                        userAvatar: av,
                                        eventType: "AVATAR_CHANGE",
                                        eventTitle: "AVATAR DEĞİŞTİ",
                                        eventDetail: "Profil fotoğrafını güncelledi",
                                        oldValue: av,
                                        newValue: av
                                    });
                                }}
                            >
                                AVATAR DEĞİŞİMİNİ TEST ET
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Deck Footer */}
            <div className="sp-deck-footer">
                <span>developed by xen.</span>
            </div>
        </div>
    );
}
