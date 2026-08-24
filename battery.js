import { state } from "./state.js";
import { startPositionWatch } from "./tracking.js";
import { logEvent } from "./utils.js";
import { requestWakeLockWithRetry } from "./main.js";

export function monitorBattery() {
    if (!('getBattery' in navigator) && !('battery' in navigator)) {
        // Battery API ikke støttet, skjul batteristatus
        return;
    }

    const getBatteryPromise = navigator.getBattery?.() ||
                             navigator.battery?.then?.((battery) => Promise.resolve(battery)) ||
                             Promise.reject();

    getBatteryPromise.then((battery) => {
        const updateBatteryStatus = () => {
            state.batteryLevel = Math.round(battery.level * 100);
            state.isBatteryLow = state.batteryLevel <= 20;

            const batteryIndicator = document.getElementById('battery-indicator');
            const batteryPercent = document.getElementById('battery-percent');
            if (batteryIndicator) {
                batteryIndicator.style.display = 'inline';
            }
            if (batteryPercent) {
                batteryPercent.innerText = state.batteryLevel;
                batteryPercent.style.color = state.batteryLevel <= 20 ? '#f44' : '#aaa';
            }

            const statusEl = document.getElementById('status');
            if (statusEl && state.batteryLevel <= 20) {
                statusEl.style.color = '#f44';
            }

            if (state.isBatteryLow && Date.now() - state.lastBatteryWarning > 60000) {
                logEvent(`⚠️ Batteri lavt (${state.batteryLevel}%). Anbefalt: Koble til lader eller bruk batterisparer-modus.`);
                state.lastBatteryWarning = Date.now();
            }

            if (state.isBatteryLow && !state.adaptiveAccuracyMode) {
                enableAdaptiveAccuracy();
            } else if (!state.isBatteryLow && state.adaptiveAccuracyMode && state.batteryLevel > 40) {
                disableAdaptiveAccuracy();
            }
        };

        updateBatteryStatus();
        battery.addEventListener?.('levelchange', updateBatteryStatus);
        battery.addEventListener?.('chargingchange', updateBatteryStatus);
    }).catch(() => {
        // Battery API ikke tilgjengelig
    });
}


export function enableAdaptiveAccuracy() {
    if (state.adaptiveAccuracyMode) return;
    state.adaptiveAccuracyMode = true;
    logEvent('🔋 Adaptiv GPS-nøyaktighet aktivert for å spare batteri.');

    if (state.isTracking && state.watchId !== null) {
        navigator.geolocation.clearWatch(state.watchId);
        startPositionWatch({
            enableHighAccuracy: false,
            maximumAge: 5000,
            timeout: 15000
        });
    }
}


export function disableAdaptiveAccuracy() {
    if (!state.adaptiveAccuracyMode) return;
    state.adaptiveAccuracyMode = false;
    logEvent('📡 Høy GPS-nøyaktighet gjenopprettet.');

    if (state.isTracking && state.watchId !== null) {
        navigator.geolocation.clearWatch(state.watchId);
        startPositionWatch({
            enableHighAccuracy: true,
            maximumAge: 0,
            timeout: 20000
        });
    }
}

// --- Forbedret Wake Lock håndtering ---

export function startBackgroundKeepAlive() {
    if (state.backgroundKeepAliveInterval) {
        clearInterval(state.backgroundKeepAliveInterval);
    }

    // Hver 10. sekund under bakgrunnskjøring, forsøk å opprettholde GPS-lock
    state.backgroundKeepAliveInterval = setInterval(() => {
        if (state.isTracking && document.visibilityState === 'hidden') {
            // Anmodning om nyeste posisjon (uten å avbryte watchPosition)
            navigator.geolocation.getCurrentPosition(
                () => {}, // Stillevoksning, data håndteres via watchPosition
                () => {},
                { enableHighAccuracy: !state.adaptiveAccuracyMode, timeout: 8000 }
            );
        }
    }, 10000);
}


export function stopBackgroundKeepAlive() {
    if (state.backgroundKeepAliveInterval) {
        clearInterval(state.backgroundKeepAliveInterval);
        state.backgroundKeepAliveInterval = null;
    }
}

// --- Hjelpefunksjon: Logg hendelser til skjermen ---

export function maybeRequestWakeLock() {
    requestWakeLockWithRetry();
}

// --- Initialiser Kartet ---
