/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { Text as DiscordText } from "@vencord/discord-types";

import { Text, type TextProps, type TextSize, type TextTag, type TextWeight } from "./Text";
export * from "./Text";

// #region Old compatibility

/** @deprecated use `Text` from `@components/Text` instead */
export const BaseText = Text;
export type BaseTextProps<Tag extends TextTag = "div"> = TextProps<Tag>;

export const TextCompat: DiscordText = function TextCompat({ color, variant, ...restProps }) {
    const newBaseTextProps = restProps as BaseTextProps;

    if (variant) {
        const [left, right] = variant.split("/");
        if (left && right) {
            const size = left.split("-").pop();
            newBaseTextProps.size = size as TextSize;
            newBaseTextProps.weight = right as TextWeight;
        }
    }

    if (color) {
        newBaseTextProps.style ??= {};
        newBaseTextProps.style.color = `var(--${color}, var(--text-default))`;
    }

    return <BaseText {...newBaseTextProps} />;
};

// #endregion
