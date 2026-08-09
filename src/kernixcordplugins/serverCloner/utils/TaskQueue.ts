import { sleep, randomDelay } from "./helpers";
import { state } from "../store";

export class TaskQueue {
    private maxConcurrency: number;
    private currentConcurrency: number;
    private activeWorkers = 0;
    private pausedUntil = 0;
    private consecutive429 = 0;
    private successCount = 0;
    private statusListeners: Set<(msg: string) => void> = new Set();

    private static readonly SUCCESSES_TO_UPSCALE = 8;
    private static readonly MAX_CONSECUTIVE_429 = 12;

    constructor(concurrency = 4) {
        this.maxConcurrency = concurrency;
        this.currentConcurrency = concurrency;
    }

    reset() {
        this.activeWorkers = 0;
        this.pausedUntil = 0;
        this.consecutive429 = 0;
        this.successCount = 0;
        this.currentConcurrency = this.maxConcurrency;
        this.statusListeners.clear();
    }

    private broadcastStatus(msg: string) {
        this.statusListeners.forEach(cb => { try { cb(msg); } catch (_) { } });
    }

    async execute<T>(
        fn: () => Promise<T>,
        statusUpdateCb?: (msg: string) => void,
        exitCondition?: () => boolean,
        retries = 4
    ): Promise<T> {

        if (statusUpdateCb) this.statusListeners.add(statusUpdateCb);

        try {
            while (this.activeWorkers >= this.currentConcurrency || Date.now() < this.pausedUntil) {
                if (!state.isCloning) throw new Error("Cancelled");
                if (exitCondition && exitCondition()) throw new Error("Skipped");

                if (Date.now() < this.pausedUntil) {
                    // Show the wait time to caller while we are paused
                    const remaining = Math.ceil((this.pausedUntil - Date.now()) / 1000);
                    if (statusUpdateCb) statusUpdateCb(`Rate limited — waiting ${remaining}s`);
                    const sleepMs = Math.min(500, this.pausedUntil - Date.now() + 10);
                    await sleep(Math.max(50, sleepMs));
                } else {
                    await sleep(25);
                }
            }

            this.activeWorkers++;

            try {
                for (let i = 0; i < retries; i++) {
                    try {
                        if (!state.isCloning) throw new Error("Cancelled");
                        if (exitCondition && exitCondition()) throw new Error("Skipped");

                        if (Date.now() < this.pausedUntil) {
                            this.activeWorkers--;
                            const remaining = this.pausedUntil - Date.now();
                            const waitSec = Math.ceil(remaining / 1000);
                            if (statusUpdateCb) statusUpdateCb(`Rate limited — waiting ${waitSec}s`);
                            await sleep(remaining + 50);
                            if (!state.isCloning) throw new Error("Cancelled");
                            while (this.activeWorkers >= this.currentConcurrency) {
                                if (!state.isCloning) throw new Error("Cancelled");
                                await sleep(25);
                            }
                            this.activeWorkers++;
                        }

                        const result = await fn();

                        this.consecutive429 = 0;
                        this.successCount++;
                        if (
                            this.successCount >= TaskQueue.SUCCESSES_TO_UPSCALE &&
                            this.currentConcurrency < this.maxConcurrency
                        ) {
                            this.currentConcurrency = Math.min(this.maxConcurrency, this.currentConcurrency + 1);
                            this.successCount = 0;
                        }
                        return result;

                    } catch (e: any) {
                        if (!state.isCloning) throw new Error("Cancelled");
                        if (exitCondition && exitCondition()) throw new Error("Skipped");
                        if (e?.message === "Skipped" || e?.message === "Cancelled") throw e;

                        if (e?.status === 429) {
                            this.consecutive429++;
                            this.successCount = 0;

                            const oldC = this.currentConcurrency;
                            this.currentConcurrency = Math.max(1, Math.floor(this.currentConcurrency / 2));
                            if (oldC !== this.currentConcurrency) {
                                console.warn(`[TaskQueue] 429 — concurrency ${oldC} → ${this.currentConcurrency}`);
                            }

                            if (this.consecutive429 >= TaskQueue.MAX_CONSECUTIVE_429) {
                                const err: any = new Error("RateLimitExhausted");
                                err.rateLimitExhausted = true;
                                throw err;
                            }

                            const retryAfterRaw = e.retry_after ?? e.body?.retry_after ?? e.headers?.["retry-after"] ?? 1;
                            const retryAfterMs = (Number(retryAfterRaw) * 1000) + randomDelay(100, 400);

                            const newPauseUntil = Date.now() + retryAfterMs;
                            if (newPauseUntil > this.pausedUntil) {
                                this.pausedUntil = newPauseUntil;
                                const waitSec = Math.ceil(retryAfterMs / 1000);
                                const msg = `Rate limited — waiting ${waitSec}s`;
                                if (statusUpdateCb) statusUpdateCb(msg);
                                this.broadcastStatus(msg);
                                console.warn(`[TaskQueue] Pause ${retryAfterMs}ms (retry_after=${retryAfterRaw})`);
                            }

                            this.activeWorkers--;
                            await sleep(retryAfterMs);
                            if (!state.isCloning) throw new Error("Cancelled");
                            while (this.activeWorkers >= this.currentConcurrency || Date.now() < this.pausedUntil) {
                                if (!state.isCloning) throw new Error("Cancelled");
                                await sleep(25);
                            }
                            this.activeWorkers++;

                            if (i < retries - 1) continue;
                        }

                        if (e?.status === 403) {
                            let errorCode = e?.body?.code || 0;
                            if (!errorCode && e?.text) {
                                try { errorCode = JSON.parse(e.text)?.code || 0; } catch (_) { }
                            }
                            if (errorCode === 50101) throw e;
                            if (i < retries - 1) {
                                await sleep(Math.min(1500 + i * 1500, 8000));
                                continue;
                            }
                            throw e;
                        }

                        if (e?.status === 400) throw e;

                        if (i === retries - 1) throw e;
                        await sleep(500 + i * 500 + randomDelay(100, 300));
                    }
                }
                throw new Error("Max retries exceeded");
            } finally {
                this.activeWorkers--;
            }
        } finally {
            if (statusUpdateCb) this.statusListeners.delete(statusUpdateCb);
        }
    }
}
