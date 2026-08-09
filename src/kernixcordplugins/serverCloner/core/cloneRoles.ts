import { RestAPI, GuildStore } from "@webpack/common";
import { replaceEmojis, arrayBufferToBase64, sleep } from "../utils/helpers";
import { checkGuildExistence, fetchGuildRoles } from "../utils/api";
import { updateWithTime } from "../utils/notifications";
import { throwIfCancelled, state } from "../store";
import { handleCloneError } from "../utils/errorHandler";
import { CloneContext } from "./types";

export async function cloneRoles(ctx: CloneContext): Promise<number> {
    let rolesFailed = 0;
    const { sourceGuild, newGuildId, options, estimateRoles, rolesProgressStart, rolesProgressEnd, taskQueue, roleQueue, roleIdMap } = ctx;

    let skipRoles = false;
    if (state.mainProgressNotificationId) {
        const skipBtn = document.getElementById(state.mainProgressNotificationId)?.querySelector(".cloner-skip-roles-btn") as HTMLElement;
        if (skipBtn) skipBtn.style.display = "";


        const ogSkip = state.skipRolesCallback;
        state.skipRolesCallback = () => {
            skipRoles = true;
            if (ogSkip) ogSkip();
        };
    }

    const sortedRoles = estimateRoles.filter(r => r.name !== "@everyone").sort((a, b) => b.position - a.position);
    const everyoneRole = estimateRoles.find(r => r.name === "@everyone");

    const newRoles = await RestAPI.get({ url: `/guilds/${newGuildId}/roles` });
    const existingTargetRoles = newRoles.body || [];
    const newEveryoneRole = existingTargetRoles.find((r: any) => r.name === "@everyone");

    if (everyoneRole && newEveryoneRole) {
        roleIdMap[everyoneRole.id] = newEveryoneRole.id;
        try {
            await RestAPI.patch({
                url: `/guilds/${newGuildId}/roles/${newEveryoneRole.id}`,
                body: { permissions: everyoneRole.permissions.toString() }
            });
        } catch (e) {
            console.warn("[ServerCloner] Failed to update @everyone role:", e);
        }
    }

    if (options.resumeMode) {
        for (const role of sortedRoles) {
            const match = existingTargetRoles.find((r: any) => r.name === role.name && r.name !== "@everyone");
            if (match) {
                roleIdMap[role.id] = match.id;
                const expectedName = replaceEmojis(role.name) || role.name;
                if (match.name !== expectedName) {
                    try {
                        await RestAPI.patch({
                            url: `/guilds/${newGuildId}/roles/${match.id}`,
                            body: { name: expectedName }
                        });
                    } catch (e) {
                        console.warn(`[ServerCloner] Failed to patch existing role emoji: ${role.name}`, e);
                    }
                }
            }
        }
    }

    const rolesToCreate = options.resumeMode ? sortedRoles.filter(r => !roleIdMap[r.id]) : sortedRoles;
    const actionLabel = options.resumeMode ? "Resuming" : "Cloning";

    const targetGuildForTier = GuildStore.getGuild(newGuildId);
    const targetTier = (targetGuildForTier as any)?.premiumTier || 0;
    const canUseRoleIcons = targetTier >= 2;

    let roleStep = 0;
    const rolePromises = rolesToCreate.map(async (role: any) => {
        if (!state.isCloning) return;
        if (skipRoles) return;

        try {
            checkGuildExistence(sourceGuild.id, newGuildId);

            const rolePayload: any = {
                name: replaceEmojis(role.name),
                permissions: role.permissions.toString(),
                color: role.color,
                hoist: role.hoist,
                mentionable: role.mentionable,
            };

            if (canUseRoleIcons) {
                rolePayload.unicode_emoji = (role as any).unicodeEmoji || (role as any).unicode_emoji || null;
                const roleIcon = (role as any).icon;
                if (roleIcon) {
                    try {
                        const iconUrl = `https://cdn.discordapp.com/role-icons/${role.id}/${roleIcon}.png?size=128`;
                        const iconResp = await fetch(iconUrl);
                        if (iconResp.ok) {
                            const iconBuf = await iconResp.arrayBuffer();
                            rolePayload.icon = `data:image/png;base64,${arrayBufferToBase64(iconBuf)}`;
                        }
                    } catch (_) { }
                }
            }

            const response = await roleQueue.execute(async () => {
                try {
                    return await RestAPI.post({ url: `/guilds/${newGuildId}/roles`, body: rolePayload });
                } catch (e: any) {
                    let code = e?.body?.code || e?.code;
                    if (!code && e?.text) {
                        try { code = JSON.parse(e.text)?.code; } catch (_) { }
                    }
                    if (code === 50101) {
                        delete rolePayload.icon;
                        delete rolePayload.unicode_emoji;
                        return await RestAPI.post({ url: `/guilds/${newGuildId}/roles`, body: rolePayload });
                    }
                    throw e;
                }
            }, (msg) => updateWithTime(msg, rolesProgressStart + ((roleStep / Math.max(rolesToCreate.length, 1)) * (rolesProgressEnd - rolesProgressStart))), () => skipRoles, 5);

            if (response?.body?.id) {
                roleIdMap[role.id] = response.body.id;
            }

            roleStep++;
            updateWithTime(`${actionLabel} role ${roleStep}/${rolesToCreate.length}: ${role.name}`, rolesProgressStart + ((roleStep / Math.max(rolesToCreate.length, 1)) * (rolesProgressEnd - rolesProgressStart)));

        } catch (e: any) {
            if (e?.rateLimitExhausted) {
                rolesFailed += (rolesToCreate.length - roleStep);
                updateWithTime(`Rate limited, skipping remaining roles...`, rolesProgressEnd);
                skipRoles = true;
                return;
            }
            rolesFailed++;
            handleCloneError("Role", e, role.name);
        }
    });

    await Promise.all(rolePromises);


    const positionUpdates = estimateRoles
        .filter(r => r.name !== "@everyone" && roleIdMap[r.id])
        .map(r => ({ id: roleIdMap[r.id], position: r.position }));
    if (positionUpdates.length > 0) {
        try {
            await roleQueue.execute(async () => {
                await RestAPI.patch({ url: `/guilds/${newGuildId}/roles`, body: positionUpdates });
            });
        } catch (e) {
            console.warn("[ServerCloner] Failed to sync role positions:", e);
        }
    }

    if (options.resumeMode && rolesToCreate.length === 0) {
        updateWithTime(`All roles already exist, skipping...`, rolesProgressEnd);
    }

    if (state.mainProgressNotificationId) {
        const skipBtn = document.getElementById(state.mainProgressNotificationId)?.querySelector(".cloner-skip-roles-btn") as HTMLElement;
        if (skipBtn) skipBtn.style.display = "none";
    }

    return rolesFailed;
}