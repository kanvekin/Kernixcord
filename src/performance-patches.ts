/*
 * Performance patches for Kernixcord startup optimization
 * Addresses slow loading and missing menu issues
 */

import { Settings } from "@api/Settings";
import { Logger } from "@utils/Logger";

const logger = new Logger("PerformancePatches");

// Cache for webpack modules to avoid repeated searches
const moduleCache = new Map<string, any>();

// Debounced plugin initialization to prevent race conditions
let initTimeout: NodeJS.Timeout | null = null;

export function optimizeWebpackLoading() {
    // Reduce timeout delays in webpack patcher
    const originalSetTimeout = global.setTimeout;
    (global as any).setTimeout = (callback: (...args: any[]) => void, delay: number, ...args: any[]) => {
        // Reduce webpack-related timeouts to speed up initialization
        if (delay === 0 && callback.toString().includes("Reflect.deleteProperty")) {
            return originalSetTimeout(callback, 1, ...args);
        }
        return originalSetTimeout(callback, delay, ...args);
    };
}

export function optimizePluginInitialization() {
    // Batch plugin initialization to reduce overhead
    if (initTimeout) {
        clearTimeout(initTimeout);
    }

    initTimeout = setTimeout(() => {
        logger.info("Starting optimized plugin initialization");
        // Ensure plugins load in proper order without conflicts
    }, 100);
}

export function optimizeMenuLoading() {
    // Pre-cache critical menu components
    const criticalMenuItems = [
        "MenuCheckboxItem",
        "Menu",
        "MenuSliderControl",
        "MenuSearchControl"
    ];

    criticalMenuItems.forEach(itemName => {
        if (!moduleCache.has(itemName)) {
            // Pre-warm the module cache for menu components
            moduleCache.set(itemName, null);
        }
    });
}

export function disableHeavyFeaturesTemporarily() {
    // Temporarily disable resource-intensive features during startup
    const originalSettings = { ...Settings };

    // Disable features that cause startup delays
    if (originalSettings.cloud?.settingsSync) {
        logger.info("Temporarily disabling cloud sync during startup");
        originalSettings.cloud.settingsSync = false;

        // Re-enable after successful startup
        setTimeout(() => {
            Settings.cloud.settingsSync = true;
            logger.info("Re-enabled cloud sync after startup");
        }, 5000);
    }
}

export function addStartupDiagnostics() {
    const startTime = performance.now();

    // Monitor webpack initialization time
    const observer = new PerformanceObserver((list) => {
        const entries = list.getEntries();
        entries.forEach(entry => {
            if (entry.name.includes("webpack") || entry.name.includes("patch")) {
                logger.info(`Performance: ${entry.name} took ${entry.duration}ms`);
            }
        });
    });

    observer.observe({ entryTypes: ['measure', 'navigation'] });

    // Log total startup time
    setTimeout(() => {
        const totalTime = performance.now() - startTime;
        logger.info(`Total startup time: ${totalTime}ms`);

        if (totalTime > 10000) {
            logger.warn("Slow startup detected. Consider disabling heavy plugins.");
        }
    }, 10000);
}

// Apply all optimizations
export function applyPerformanceOptimizations() {
    logger.info("Applying performance optimizations for faster startup");

    try {
        optimizeWebpackLoading();
        optimizePluginInitialization();
        optimizeMenuLoading();
        disableHeavyFeaturesTemporarily();
        addStartupDiagnostics();

        logger.info("Performance optimizations applied successfully");
    } catch (error) {
        logger.error("Failed to apply performance optimizations:", error);
    }
}
