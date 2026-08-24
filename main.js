import { state } from "./state.js";
import { monitorBattery, startBackgroundKeepAlive, stopBackgroundKeepAlive } from "./battery.js";
import { logEvent } from "./utils.js";
import { initLeaderboardUI } from "./leaderboard.js";
import { loadSavedRides } from "./storage.js";
import { restartPositionWatch } from "./tracking.js";
import { initMap } from "./map.js";

export async function requestWakeLockWithRetry() {
    if (!('state.wakeLock' in navigator)) {
        return;
    }

    try {
        if (state.wakeLock) {
            return; // Allerede aktiv
        }

        state.wakeLock = await navigator.wakeLock.request('screen');
        logEvent('📱 Skjermen holdes på for å sikre GPS-sporing.');

        state.wakeLock.addEventListener('release', () => {
            state.wakeLock = null;
            if (state.isTracking && document.visibilityState === 'visible') {
                requestWakeLockWithRetry();
            }
        });

        state.lastWakeLockRequest = Date.now();
    } catch (err) {
        if (err.name === 'NotAllowedError') {
            logEvent('⚠️ Skjerm-låsen krever sikker HTTPS-forbindelse.');
        } else if (err.name === 'NotSupportedError') {
            logEvent('ℹ️ Nettleseren din støtter ikke skjerm-lås.');
        }
    }
}

// --- Bakgrunnshold for GPS under bakgrunnsmodus ---

export function initApp() {
    initMap();
    loadSavedRides();
    attachLifecycleHandlers();
    initLeaderboardUI();
    monitorBattery(); // Overvåk batteristatus
}


export function attachLifecycleHandlers() {
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pageshow', () => {
        if (state.isTracking) {
            restartPositionWatch();
        }
    });
    window.addEventListener('online', () => {
        if (state.isTracking) {
            restartPositionWatch();
        }
    });
}


export function handleVisibilityChange() {
    if (!state.isTracking) return;

    if (document.visibilityState === 'hidden') {
        logEvent('📲 Appen går i bakgrunn. GPS-sporing fortsetter så lenge nettleseren tillater det.');
        requestWakeLockWithRetry();
        startBackgroundKeepAlive();
    } else {
        logEvent('📱 Appen er synlig igjen.');
        stopBackgroundKeepAlive();
        restartPositionWatch();
    }
}



import { toggleTracking, resetRide } from "./tracking.js";
import { exportGpx } from "./storage.js";
import { toggleTripMode, copyTripSummary } from "./ui.js";
import { saveRiderName, fetchLeaderboard, shareLeaderboardEntry } from "./leaderboard.js";

document.addEventListener('DOMContentLoaded', () => {
    initApp();

    const attachClick = (id, handler) => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('click', handler);
    };

    attachClick('btn-toggle', toggleTracking);
    attachClick('btn-reset', resetRide);
    attachClick('btn-export-gpx', exportGpx);
    attachClick('btn-trip-mode', toggleTripMode);
    attachClick('btn-copy-summary', copyTripSummary);
    attachClick('btn-save-name', saveRiderName);
    attachClick('btn-refresh-leaderboard', fetchLeaderboard);
    attachClick('btn-share-leaderboard', shareLeaderboardEntry);
});
