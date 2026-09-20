/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { HeaderBarButton } from "@api/HeaderBar";
import { definePluginSettings } from "@api/Settings";
import { ModalCloseButton, ModalContent, ModalHeader, ModalRoot, ModalSize, openModal, ModalProps } from "@utils/modal";
import definePlugin, { OptionType } from "@utils/types";
import { User } from "@vencord/discord-types";
import { Button, FluxDispatcher, Forms, React, TextInput, UserStore } from "@webpack/common";
import { Devs } from "@utils/constants";

const settings = definePluginSettings({
    spoofedUsername: {
        description: "Your spoofed username",
        type: OptionType.STRING,
        default: ""
    }
});

let originalUser: User | null = null;

function applySpoof(username: string) {
    const realUser = UserStore.getCurrentUser();
    if (!realUser) return;

    if (!originalUser) {
        originalUser = { ...realUser } as User;
    }

    if (username.trim()) {
        FluxDispatcher.dispatch({
            type: "CURRENT_USER_UPDATE",
            user: {
                ...realUser,
                username: username.trim(),
                global_name: username.trim(),
                globalName: username.trim()
            }
        });
    } else {
        FluxDispatcher.dispatch({
            type: "CURRENT_USER_UPDATE",
            user: originalUser
        });
        originalUser = null;
    }
}

function SpoofModal({ modalProps }: { modalProps: ModalProps }) {
    const [name, setName] = React.useState(settings.store.spoofedUsername);

    return (
        <ModalRoot {...modalProps} size={ModalSize.SMALL}>
            <ModalHeader separator={false}>
                <Forms.FormTitle tag="h2">Spoof Username</Forms.FormTitle>
                <ModalCloseButton onClick={modalProps.onClose} />
            </ModalHeader>
            <ModalContent style={{ paddingBottom: "16px" }}>
                <Forms.FormTitle tag="h5">Fake Username</Forms.FormTitle>
                <TextInput
                    value={name}
                    onChange={setName}
                    placeholder="Enter fake username (leave blank to reset)"
                    style={{ marginBottom: 20 }}
                />
                <Button
                    onClick={() => {
                        settings.store.spoofedUsername = name;
                        applySpoof(name);
                        modalProps.onClose();
                    }}
                >
                    Apply
                </Button>
            </ModalContent>
        </ModalRoot>
    );
}

function SpoofIcon() {
    return (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z" />
        </svg>
    );
}

export default definePlugin({
    name: "SpoofUsername",
    description: "Spoof your own username locally with a management panel in the header.",
    authors: [Devs.feelslove],
    settings,
    
    headerBarButton: {
        icon: SpoofIcon,
        render: () => (
            <HeaderBarButton
                icon={SpoofIcon}
                tooltip="Spoof Username"
                onClick={() => openModal(props => <SpoofModal modalProps={props} />)}
            />
        )
    },

    start() {
        if (settings.store.spoofedUsername) {
            applySpoof(settings.store.spoofedUsername);
        }
    },

    stop() {
        applySpoof(""); // reset
    }
});
