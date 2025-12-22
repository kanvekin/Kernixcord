/*
 * Menu loading fixes for Kernixcord
 * Addresses missing menu issues after injection
 */

import { waitFor } from "@webpack";
import { filters } from "@webpack";
import { Logger } from "@utils/Logger";

const logger = new Logger("MenuFix");

// Enhanced menu component detection with fallbacks
const menuSelectors = [
    m => m.name === "MenuCheckboxItem",
    m => m.name === "MenuRadioItem",
    m => m.name === "MenuItem",
    m => m.name === "MenuGroup",
    filters.componentByCode('path:["empty"]'),
    filters.componentByCode("sliderContainer", "slider", "handleSize:16", "=100"),
    filters.componentByCode(".SEARCH)", ".focus()", "query:")
];

// Retry mechanism for menu loading
let menuLoadRetries = 0;
const MAX_RETRIES = 5;

export function ensureMenuComponents() {
    return new Promise<void>((resolve, reject) => {
        const attemptLoad = (attempt: number) => {
            logger.info(`Attempting to load menu components (attempt ${attempt}/${MAX_RETRIES})`);

            const loadPromises = menuSelectors.map((selector, index) => {
                return new Promise<void>((menuResolve) => {
                    const timeout = setTimeout(() => {
                        logger.warn(`Menu selector ${index} timed out`);
                        menuResolve();
                    }, 2000);

                    waitFor(selector, (component, id) => {
                        clearTimeout(timeout);
                        if (component) {
                            logger.info(`Menu component ${index} loaded successfully`);
                        }
                        menuResolve();
                    });
                });
            });

            Promise.all(loadPromises).then(() => {
                // Verify critical menu components are loaded
                waitFor(m => m.name === "MenuCheckboxItem", (component) => {
                    if (component) {
                        logger.info("Critical menu components verified");
                        resolve();
                    } else if (attempt < MAX_RETRIES) {
                        logger.warn(`Menu verification failed, retrying... (${attempt + 1}/${MAX_RETRIES})`);
                        setTimeout(() => attemptLoad(attempt + 1), 1000);
                    } else {
                        logger.error("Failed to load menu components after maximum retries");
                        reject(new Error("Menu components failed to load"));
                    }
                });
            });
        };

        attemptLoad(1);
    });
}

// Force menu refresh if stuck
export function forceMenuRefresh() {
    logger.info("Attempting to force menu refresh");

    // Try to trigger menu re-render
    try {
        const menuContainer = document.querySelector('[class*="menu-"]');
        if (menuContainer) {
            const event = new Event('resize');
            window.dispatchEvent(event);
            logger.info("Menu refresh triggered");
        }
    } catch (error) {
        logger.error("Failed to force menu refresh:", error);
    }
}

// Monitor menu loading and provide fallback
export function monitorMenuLoading() {
    let loadingTimeout: NodeJS.Timeout;

    const startMonitoring = () => {
        loadingTimeout = setTimeout(() => {
            logger.warn("Menu loading taking longer than expected, applying fixes");
            ensureMenuComponents().catch(() => {
                forceMenuRefresh();
            });
        }, 3000);
    };

    const stopMonitoring = () => {
        if (loadingTimeout) {
            clearTimeout(loadingTimeout);
        }
    };

    // Start monitoring
    startMonitoring();

    // Stop monitoring when menu is ready
    waitFor(m => m.name === "MenuCheckboxItem", () => {
        stopMonitoring();
        logger.info("Menu monitoring completed successfully");
    });
}

// Apply all menu fixes
export function applyMenuFixes() {
    logger.info("Applying menu loading fixes");

    try {
        monitorMenuLoading();

        // Additional safety net
        setTimeout(() => {
            ensureMenuComponents().catch(error => {
                logger.error("Menu components failed to load:", error);
                forceMenuRefresh();
            });
        }, 5000);

        logger.info("Menu fixes applied successfully");
    } catch (error) {
        logger.error("Failed to apply menu fixes:", error);
    }
}
