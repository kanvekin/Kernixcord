/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import definePlugin from "@utils/types";
import { Devs } from "@utils/constants";

export default definePlugin({
    name: "DontLimitMe",
    description: "removes the limit on message sending. spam away! (Bannable)",
    tags: ["Utility", "Chat"],
    authors: [Devs.feelslove],
    patches: [
        {
            find: "cancelQueueMetricTimers",
            replacement: {
                match: /this\.maxSize=[a-zA-Z]+,/,
                replace: "this.maxSize=Number.MAX_SAFE_INTEGER,"
            }
        }
    ]
});