import { RestAPI } from "@webpack/common";
import { arrayBufferToBase64 } from "../utils/helpers";
import { updateWithTime } from "../utils/notifications";
import { throwIfCancelled, state } from "../store";
import { handleCloneError } from "../utils/errorHandler";
import { CloneContext } from "./types";

export async function cloneEmojis(ctx: CloneContext) {
    const { sourceGuild, options, newGuildId, assetQueue } = ctx;

    if (!options.cloneEmojis) return;

    try {
        const sourceEmojisResp = await RestAPI.get({ url: `/guilds/${sourceGuild.id}/emojis` });
        const sourceEmojis: any[] = (sourceEmojisResp as any).body || [];

        if (sourceEmojis.length === 0) {
            updateWithTime("No custom emojis to clone.", 20);
            return;
        }

        updateWithTime(`Cloning ${sourceEmojis.length} custom emojis...`, 20);

        let targetEmojis: any[] = [];
        if (options.resumeMode && newGuildId) {
            try {
                const targetEmojisResp = await RestAPI.get({ url: `/guilds/${newGuildId}/emojis` });
                targetEmojis = (targetEmojisResp as any).body || [];
            } catch (e) {
                console.warn("[ServerCloner] Failed to fetch target emojis for resume mode:", e);
            }
        }

        let emojiStep = 0;
        const emojiPromises = sourceEmojis.map(async (emoji: any) => {
            if (!state.isCloning) return;
            throwIfCancelled();

            if (options.resumeMode) {
                const existing = targetEmojis.find((e: any) => e.name === emoji.name);
                if (existing) {
                    state.emojiIdMap[emoji.id] = existing.id;
                    emojiStep++;
                    updateWithTime(`Skipping existing emoji (${emojiStep}/${sourceEmojis.length})...`, 20 + (emojiStep / sourceEmojis.length) * 5);
                    return;
                }
            }

            try {
                const ext = emoji.animated ? "gif" : "png";
                const emojiUrl = `https://cdn.discordapp.com/emojis/${emoji.id}.${ext}?size=256`;
                const response = await fetch(emojiUrl);
                if (!response.ok) return;

                const buffer = await response.arrayBuffer();
                const base64 = arrayBufferToBase64(buffer);
                const imageStr = `data:image/${ext};base64,${base64}`;

                await assetQueue.execute(async () => {
                    const createResp = await RestAPI.post({
                        url: `/guilds/${newGuildId}/emojis`,
                        body: {
                            name: emoji.name,
                            image: imageStr,
                            roles: []
                        }
                    });

                    if (createResp?.body?.id) {
                        state.emojiIdMap[emoji.id] = createResp.body.id;
                    }
                }, (msg) => updateWithTime(msg, 20 + (emojiStep / sourceEmojis.length) * 5));

                emojiStep++;
                updateWithTime(`Cloned emoji ${emoji.name} (${emojiStep}/${sourceEmojis.length})...`, 20 + (emojiStep / sourceEmojis.length) * 5);
            } catch (e) {
                handleCloneError("Emoji", e, emoji.name);
            }
        });

        await Promise.all(emojiPromises);
    } catch (e) {
        console.warn("[ServerCloner] Failed to clone source emojis:", e);
    }
}
