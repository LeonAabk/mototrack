import { state } from "./state.js";
import { renderSpeedCheckpoints, addSpeedCheckpoint, clearSpeedCheckpointMarkers } from "./map.js";
import { renderSpeedGraph, renderTripSummary, updateTripShareText, updateTrackingButton } from "./ui.js";
import { stopBackgroundKeepAlive, startBackgroundKeepAlive, maybeRequestWakeLock } from "./battery.js";
import { calculateDistance, isSecureGeolocationContext, logEvent } from "./utils.js";
import { requestWakeLockWithRetry } from "./main.js";
import { saveCurrentRide } from "./storage.js";

export function updateTripAltitude(altitude) {
    if (altitude === null || altitude === undefined) return;

    if (state.tripSummary.maxAltitude === null || altitude > state.tripSummary.maxAltitude) {
        state.tripSummary.maxAltitude = altitude;
    }

    if (state.tripSummary.minAltitude === null || altitude < state.tripSummary.minAltitude) {
        state.tripSummary.minAltitude = altitude;
    }

    if (state.tripSummary.lastAltitude !== null) {
        const delta = altitude - state.tripSummary.lastAltitude;
        if (delta > 0) {
            state.tripSummary.altitudeGain += delta;
        }
    }

    state.tripSummary.lastAltitude = altitude;
}


export function handlePauseLogic(currentSpeed) {
    if (currentSpeed >= state.RESUME_THRESHOLD_SPEED && state.isPaused) {
        if (state.pauseActiveSince !== null) {
            state.pauseDurationSeconds += Math.floor((Date.now() - state.pauseActiveSince) / 1000);
            state.pauseActiveSince = null;
        }
        state.isPaused = false;
        state.pauseStartTime = null;
        logEvent('Tur fortsetter igjen etter pause.');
        return false;
    }

    if (currentSpeed < state.PAUSE_THRESHOLD_SPEED) {
        if (!state.isPaused) {
            if (state.pauseStartTime === null) {
                state.pauseStartTime = Date.now();
            } else if (Date.now() - state.pauseStartTime >= state.PAUSE_DELAY_MS) {
                state.isPaused = true;
                state.pauseCount += 1;
                state.pauseActiveSince = Date.now();
                state.pauseStartTime = null;
                logEvent('Tur satt på pause fordi du sto stille for lenge.');
            }
        }
    } else {
        state.pauseStartTime = null;
    }

    return state.isPaused;
}


export function toggleTracking() {
    if (state.isTracking) {
        stopTracking({ saveRide: true });
        return;
    }

    startTracking();
}


export function startTracking() {
    const statusText = document.getElementById('status');

    if (!navigator.geolocation) {
        alert('Nettleseren din støtter ikke GPS-sporing.');
        return;
    }

    if (!isSecureGeolocationContext()) {
        if (statusText) {
            statusText.innerText = 'GPS-tillatelse krever en sikker adresse. Åpne siden via HTTPS eller localhost, og prøv igjen.';
        }
        logEvent('GPS krever HTTPS eller localhost for å kunne spørre på telefonen.');
        return;
    }

    state.isTracking = true;
    state.backgroundTrackingEnabled = true;
    if (!state.startTime) state.startTime = Date.now();

    updateTrackingButton(true);
    if (statusText) {
        statusText.innerText = 'Ber om tillatelse til posisjon...';
    }
    logEvent('🏍️ Sporing startet. Venter på GPS...');

    requestWakeLockWithRetry();
    startBackgroundKeepAlive();

    if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission().catch(() => {});
    }

    // Start tidtakeren
    clearInterval(state.timerInterval);
    state.timerInterval = setInterval(updateTimer, 1000);

    // Hvis vi er i adaptiv batterimodus, reduser nøyaktigheten for å spare batteri
    const geolocationOptions = {
        enableHighAccuracy: !state.adaptiveAccuracyMode,
        maximumAge: state.adaptiveAccuracyMode ? 5000 : 0,
        timeout: state.adaptiveAccuracyMode ? 15000 : 20000
    };

    const requestPermission = () => {
        navigator.geolocation.getCurrentPosition(
            (position) => {
                handlePositionUpdate(position);
                startPositionWatch(geolocationOptions);
            },
            (error) => {
                stopTracking({ saveRide: false });
                handlePositionError(error);
            },
            geolocationOptions
        );
    };

    if (navigator.permissions && navigator.permissions.query) {
        navigator.permissions.query({ name: 'geolocation' }).then((permissionStatus) => {
            if (permissionStatus.state === 'denied') {
                stopTracking({ saveRide: false });
                if (statusText) {
                    statusText.innerText = 'GPS-tillatelse er blokkert. Åpne nettleserinnstillingene og tillat posisjon for denne siden.';
                }
                logEvent('GPS-tillatelse er blokkert i nettleseren.');
                return;
            }

            requestPermission();
        }).catch(() => {
            requestPermission();
        });
    } else {
        requestPermission();
    }
}


export function startPositionWatch(options) {
    if (state.watchId !== null) {
        navigator.geolocation.clearWatch(state.watchId);
    }

    state.watchId = navigator.geolocation.watchPosition(
        (position) => {
            handlePositionUpdate(position);
        },
        (error) => {
            if (!state.isTracking) return;
            if (error.code === 1) {
                handlePositionError(error);
                return;
            }
            if (document.visibilityState === 'hidden') {
                logEvent('GPS-signalet ble brutt i bakgrunn. Forsøker å hente ny posisjon snart.');
            }
            window.setTimeout(() => {
                if (state.isTracking) {
                    startPositionWatch(options);
                }
            }, 5000);
        },
        options
    );
}


export function restartPositionWatch() {
    if (!state.isTracking) return;
    if (state.watchId !== null) {
        navigator.geolocation.clearWatch(state.watchId);
        state.watchId = null;
    }
    maybeRequestWakeLock();
    navigator.geolocation.getCurrentPosition(
        (position) => {
            handlePositionUpdate(position);
            startPositionWatch({
                enableHighAccuracy: true,
                maximumAge: 0,
                timeout: 20000
            });
        },
        handlePositionError,
        { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 }
    );
}


export function stopTracking(options = { saveRide: false }) {
    if (state.watchId !== null) {
        navigator.geolocation.clearWatch(state.watchId);
        state.watchId = null;
    }

    clearInterval(state.timerInterval);
    state.timerInterval = null;
    stopBackgroundKeepAlive();

    state.isTracking = false;
    state.backgroundTrackingEnabled = false;
    updateTrackingButton(false);

    const statusText = document.getElementById('status');
    if (statusText) {
        statusText.innerText = 'Sporing stoppet.';
        statusText.style.color = '#888';
    }
    logEvent('Sporing stoppet.');

    if (options.saveRide) {
        saveCurrentRide();
    }
}

// --- Håndter nye GPS-data ---

export function handlePositionUpdate(position) {
    const coords = position.coords;
    const lat = coords.latitude;
    const lon = coords.longitude;

    if ('Notification' in window && Notification.permission === 'granted' && document.visibilityState === 'hidden') {
        new Notification('MotoTrack', {
            body: `Oppdatert: ${Math.round((coords.speed || 0) * 3.6)} km/t`
        });
    }

    // Konverter fart fra meter per sekund (m/s) til km/t
    // Hvis coords.speed er null (ofte tilfelle når man står stille på iOS), bruk 0
    const currentSpeed = (coords.speed || 0) * 3.6;

    if (coords.altitude !== null) {
        updateTripAltitude(coords.altitude);
    }

    if (handlePauseLogic(currentSpeed)) {
        document.getElementById('speed').innerText = '0';
        document.getElementById('status').innerText = 'Pauset - venter på bevegelse...';
        renderTripSummary();
        return;
    }

    let isNewTopSpeed = false;

    // Oppdater maksfart
    if (currentSpeed > state.maxSpeed) {
        state.maxSpeed = currentSpeed;
        state.topSpeedPoint = { lat, lon, timestamp: Date.now() };
        isNewTopSpeed = true;
        document.getElementById('max-speed').innerText = `Maks: ${Math.round(state.maxSpeed)} km/t`;
    }

    state.speedSamples.push(currentSpeed);
    if (state.speedSamples.length > 60) {
        state.speedSamples.shift();
    }
    renderSpeedGraph();

    // Regn ut distanse hvis vi har en forrige posisjon
    if (state.lastPosition) {
        const dist = calculateDistance(state.lastPosition.lat, state.lastPosition.lon, lat, lon);
        state.totalDistance += dist;
    }
    state.lastPosition = { lat, lon }; // Lagre nåværende posisjon til neste oppdatering

    // Oppdater UI
    document.getElementById('speed').innerText = Math.round(currentSpeed);
    document.getElementById('distance').innerText = state.totalDistance.toFixed(2);
    document.getElementById('status').innerText = 'Får GPS-signal (Nøyaktighet: ' + Math.round(coords.accuracy) + 'm)';
    renderTripSummary();
    if (state.tripModeEnabled) {
        updateTripShareText();
    }

    if (coords.altitude !== null) {
        document.getElementById('altitude').innerText = Math.round(coords.altitude);
    }

    const shouldRecordCheckpoint = currentSpeed > 0 && (
        state.lastCheckpointTime === null ||
        Date.now() - state.lastCheckpointTime >= state.CHECKPOINT_INTERVAL_MS
    );

    if (shouldRecordCheckpoint) {
        addSpeedCheckpoint(lat, lon, currentSpeed, Date.now(), isNewTopSpeed);
        state.lastCheckpointTime = Date.now();
    }

    // Regn ut snittfart (Distanse / Tid i timer)
    const elapsedSeconds = (Date.now() - state.startTime) / 1000;
    const elapsedHours = elapsedSeconds / 3600;
    if (elapsedHours > 0) {
        const avgSpeed = state.totalDistance / elapsedHours;
        document.getElementById('avg-speed').innerText = Math.round(avgSpeed);
    }

    // --- Oppdater Kartet ---
    const currentLatLng = [lat, lon];
    state.routeCoordinates.push(currentLatLng);
    state.routeSamples.push({ lat, lon, timestamp: Date.now(), speed: currentSpeed });

    if (state.map) {
        let color = '#22c55e'; // Grønn for < 50
        if (currentSpeed >= 80) {
            color = '#ef4444'; // Rød for >= 80
        } else if (currentSpeed >= 50) {
            color = '#facc15'; // Gul for 50-80
        }

        if (state.routeCoordinates.length > 1) {
            const previousLatLng = state.routeCoordinates[state.routeCoordinates.length - 2];
            L.polyline([previousLatLng, currentLatLng], {color: color, weight: 4}).addTo(state.map);
        }
    }

    // Flytt markøren og sentrer kartet
    if (state.map && !state.currentMarker) {
        state.currentMarker = L.marker(currentLatLng).addTo(state.map);
        state.map.setView(currentLatLng, 15);
    } else if (state.map && state.currentMarker) {
        state.currentMarker.setLatLng(currentLatLng);
        state.map.panTo(currentLatLng);
    }
}

// --- Feilhåndtering for GPS ---

export function handlePositionError(error) {
    let msg = 'Ukjent GPS-feil.';
    if (error.code === 1) msg = 'Du avslo tilgang til posisjon.';
    if (error.code === 2) msg = 'Posisjon utilgjengelig (ingen signal).';
    if (error.code === 3) msg = 'Tidsavbrudd på GPS-signal.';

    document.getElementById('status').innerText = `Feil: ${msg}`;
    logEvent(`GPS Feil: ${msg}`);
}

// --- Tidtaker ---

export function updateTimer() {
    if (!state.startTime) return;
    const elapsedSeconds = Math.floor((Date.now() - state.startTime) / 1000);
    const minutes = Math.floor(elapsedSeconds / 60);
    const seconds = elapsedSeconds % 60;

    // Legger til en null foran hvis tallet er under 10 (f.eks "05")
    const formattedTime =
        String(minutes).padStart(2, '0') + ':' +
        String(seconds).padStart(2, '0');

    document.getElementById('time').innerText = formattedTime;
}

// --- Nullstill tur ---

export function resetRide() {
    if (!confirm('Er du sikker på at du vil slette turen?')) {
        return;
    }

    if (state.isTracking) {
        stopTracking({ saveRide: false });
    }

    // Nullstill variabler
    state.startTime = null;
    state.totalDistance = 0;
    state.maxSpeed = 0;
    state.lastPosition = null;
    state.topSpeedPoint = null;
    state.speedCheckpoints = [];
    state.lastCheckpointTime = null;
    state.speedSamples = [];
    state.isPaused = false;
    state.pauseStartTime = null;
    state.pauseCount = 0;
    state.pauseDurationSeconds = 0;
    state.pauseActiveSince = null;
    state.routeSamples = [];
    state.tripSummary = {
        maxAltitude: null,
        minAltitude: null,
        altitudeGain: 0,
        lastAltitude: null
    };
    state.routeCoordinates = [];

    // Nullstill UI
    document.getElementById('speed').innerText = '0';
    document.getElementById('max-speed').innerText = 'Maks: 0 km/t';
    document.getElementById('distance').innerText = '0.00';
    document.getElementById('avg-speed').innerText = '0';
    document.getElementById('time').innerText = '00:00';
    document.getElementById('altitude').innerText = '0';
    document.getElementById('log-output').innerText = 'Tur nullstilt.\n';
    document.getElementById('status').innerText = 'Venter på GPS-signal...';
    renderTripSummary();

    // Fjern ruten og fartspunkter fra kartet
    if (state.routePolyline) state.routePolyline.setLatLngs([]);
    if (state.map && state.currentMarker) {
        state.map.removeLayer(state.currentMarker);
        state.currentMarker = null;
    }
    clearSpeedCheckpointMarkers();
    renderSpeedCheckpoints();
    renderSpeedGraph();

    logEvent('Tur nullstilt.');
}

// --- Ledertavle (Leaderboard) ---
