// --- Globale variabler for å holde styr på turen ---
let isTracking = false;
let watchId = null; // ID-en til GPS-lytteren
let startTime = null;
let timerInterval = null;
let wakeLock = null;
let backgroundTrackingEnabled = false;

let totalDistance = 0; // I kilometer
let maxSpeed = 0; // I km/t
let lastPosition = null; // Forrige GPS-koordinat
let topSpeedPoint = null; // Hvor toppfarten ble registrert
let speedCheckpoints = []; // Liste over fartspunkter langs ruten
let speedCheckpointLayers = []; // Kartmarkører for fartspunkter
let lastCheckpointTime = null;
let speedSamples = []; // Hastighetsprøver for grafen
let isPaused = false;
let pauseStartTime = null;
let tripSummary = {
    maxAltitude: null,
    minAltitude: null,
    altitudeGain: 0,
    lastAltitude: null
};
let tripModeEnabled = false;
let pauseCount = 0;
let pauseDurationSeconds = 0;
let pauseActiveSince = null;
let routeSamples = [];
const CHECKPOINT_INTERVAL_MS = 20000;
const PAUSE_THRESHOLD_SPEED = 5;
const RESUME_THRESHOLD_SPEED = 8;
const PAUSE_DELAY_MS = 10000;

// --- Batteri- og bakgrunnssporing ---
let batteryLevel = 100;
let isBatteryLow = false;
let lastBatteryWarning = 0;
let adaptiveAccuracyMode = false;
let backgroundKeepAliveInterval = null;
let lastWakeLockRequest = 0;

// --- Kartvariabler (Leaflet) ---
let map = null;
let currentMarker = null;
let routePolyline = null;
let routeCoordinates = [];
let rideDetailsMap = null;
let rideDetailsPolyline = null;
let rideDetailsMarkers = [];

// --- Batteri og energioptimalisering ---
function monitorBattery() {
    if (!('getBattery' in navigator) && !('battery' in navigator)) {
        // Battery API ikke støttet, skjul batteristatus
        return;
    }

    const getBatteryPromise = navigator.getBattery?.() || 
                             navigator.battery?.then?.((battery) => Promise.resolve(battery)) ||
                             Promise.reject();

    getBatteryPromise.then((battery) => {
        const updateBatteryStatus = () => {
            batteryLevel = Math.round(battery.level * 100);
            isBatteryLow = batteryLevel <= 20;
            
            const batteryIndicator = document.getElementById('battery-indicator');
            const batteryPercent = document.getElementById('battery-percent');
            if (batteryIndicator) {
                batteryIndicator.style.display = 'inline';
            }
            if (batteryPercent) {
                batteryPercent.innerText = batteryLevel;
                batteryPercent.style.color = batteryLevel <= 20 ? '#f44' : '#aaa';
            }
            
            const statusEl = document.getElementById('status');
            if (statusEl && batteryLevel <= 20) {
                statusEl.style.color = '#f44';
            }
            
            if (isBatteryLow && Date.now() - lastBatteryWarning > 60000) {
                logEvent(`⚠️ Batteri lavt (${batteryLevel}%). Anbefalt: Koble til lader eller bruk batterisparer-modus.`);
                lastBatteryWarning = Date.now();
            }

            if (isBatteryLow && !adaptiveAccuracyMode) {
                enableAdaptiveAccuracy();
            } else if (!isBatteryLow && adaptiveAccuracyMode && batteryLevel > 40) {
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

function enableAdaptiveAccuracy() {
    if (adaptiveAccuracyMode) return;
    adaptiveAccuracyMode = true;
    logEvent('🔋 Adaptiv GPS-nøyaktighet aktivert for å spare batteri.');
    
    if (isTracking && watchId !== null) {
        navigator.geolocation.clearWatch(watchId);
        startPositionWatch({
            enableHighAccuracy: false,
            maximumAge: 3000,
            timeout: 15000
        });
    }
}

function disableAdaptiveAccuracy() {
    if (!adaptiveAccuracyMode) return;
    adaptiveAccuracyMode = false;
    logEvent('📡 Høy GPS-nøyaktighet gjenopprettet.');
    
    if (isTracking && watchId !== null) {
        navigator.geolocation.clearWatch(watchId);
        startPositionWatch({
            enableHighAccuracy: true,
            maximumAge: 0,
            timeout: 20000
        });
    }
}

// --- Forbedret Wake Lock håndtering ---
async function requestWakeLockWithRetry() {
    if (!('wakeLock' in navigator)) {
        return;
    }

    try {
        if (wakeLock) {
            return; // Allerede aktiv
        }

        wakeLock = await navigator.wakeLock.request('screen');
        logEvent('📱 Skjermen holdes på for å sikre GPS-sporing.');
        
        wakeLock.addEventListener('release', () => {
            wakeLock = null;
            if (isTracking && document.visibilityState === 'visible') {
                requestWakeLockWithRetry();
            }
        });

        lastWakeLockRequest = Date.now();
    } catch (err) {
        if (err.name === 'NotAllowedError') {
            logEvent('⚠️ Skjerm-låsen krever sikker HTTPS-forbindelse.');
        } else if (err.name === 'NotSupportedError') {
            logEvent('ℹ️ Nettleseren din støtter ikke skjerm-lås.');
        }
    }
}

// --- Bakgrunnshold for GPS under bakgrunnsmodus ---
function startBackgroundKeepAlive() {
    if (backgroundKeepAliveInterval) {
        clearInterval(backgroundKeepAliveInterval);
    }

    // Hver 10. sekund under bakgrunnskjøring, forsøk å opprettholde GPS-lock
    backgroundKeepAliveInterval = setInterval(() => {
        if (isTracking && document.visibilityState === 'hidden') {
            // Anmodning om nyeste posisjon (uten å avbryte watchPosition)
            navigator.geolocation.getCurrentPosition(
                () => {}, // Stillevoksning, data håndteres via watchPosition
                () => {},
                { enableHighAccuracy: !adaptiveAccuracyMode, timeout: 8000 }
            );
        }
    }, 10000);
}

function stopBackgroundKeepAlive() {
    if (backgroundKeepAliveInterval) {
        clearInterval(backgroundKeepAliveInterval);
        backgroundKeepAliveInterval = null;
    }
}

// --- Hjelpefunksjon: Logg hendelser til skjermen ---
function logEvent(message) {
    const logElement = document.getElementById('log-output');
    if (!logElement) return;

    const timeString = new Date().toLocaleTimeString('no-NO');
    logElement.innerText = `[${timeString}] ${message}\n` + logElement.innerText;
}

function updateTrackingButton(isActive) {
    const btn = document.getElementById('btn-toggle');
    if (!btn) return;

    btn.classList.toggle('active', isActive);
    btn.textContent = isActive ? 'Stopp Sporing' : 'Start Sporing';
}

function isSecureGeolocationContext() {
    return window.isSecureContext || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
}

function initApp() {
    initMap();
    loadSavedRides();
    attachLifecycleHandlers();
    initLeaderboardUI();
    monitorBattery(); // Overvåk batteristatus
}

function renderSpeedCheckpoints() {
    const container = document.getElementById('speed-points-list');
    if (!container) return;

    if (speedCheckpoints.length === 0) {
        container.innerHTML = '<p style="color: #888; margin: 0;">Ingen fartspunkter registrert ennå.</p>';
        return;
    }

    const html = speedCheckpoints.map((checkpoint) => {
        const label = checkpoint.isTopSpeed ? '🔥 Toppfart' : '📍 Fartspunkt';
        const time = new Date(checkpoint.timestamp).toLocaleTimeString('no-NO', { hour: '2-digit', minute: '2-digit' });
        return `
            <div class="speed-point-item ${checkpoint.isTopSpeed ? 'top-speed' : ''}">
                <strong>${label}</strong><br>
                <span>${checkpoint.speed} km/t</span><br>
                <small>${time}</small>
            </div>
        `;
    }).join('');

    container.innerHTML = html;
}

function formatDuration(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function calculateBestSegment() {
    if (routeSamples.length < 2) return null;

    let best = null;

    for (let i = 0; i < routeSamples.length - 1; i++) {
        const start = routeSamples[i];
        const end = routeSamples[i + 1];
        const distanceKm = calculateDistance(start.lat, start.lon, end.lat, end.lon);
        const durationHours = (end.timestamp - start.timestamp) / 3600000;
        if (durationHours <= 0) continue;

        const avgSpeed = distanceKm / durationHours;
        if (!best || avgSpeed > best.speed) {
            best = {
                speed: avgSpeed,
                distanceKm,
                durationSeconds: Math.round((end.timestamp - start.timestamp) / 1000)
            };
        }
    }

    return best;
}

function renderTripSummary() {
    const container = document.getElementById('trip-summary-content');
    if (!container) return;

    const stateLabel = isPaused ? 'Pauset' : 'Aktiv';
    const altitudeMax = tripSummary.maxAltitude !== null ? `${Math.round(tripSummary.maxAltitude)} m` : '—';
    const altitudeMin = tripSummary.minAltitude !== null ? `${Math.round(tripSummary.minAltitude)} m` : '—';
    const altitudeGain = tripSummary.altitudeGain > 0 ? `${Math.round(tripSummary.altitudeGain)} m` : '0 m';
    const bestSegment = calculateBestSegment();
    const bestSegmentText = bestSegment ? `${Math.round(bestSegment.speed)} km/t` : '—';

    container.innerHTML = `
        <div class="summary-grid">
            <div class="summary-card"><span>Status</span><strong>${stateLabel}</strong></div>
            <div class="summary-card"><span>Topphastighet</span><strong>${maxSpeed > 0 ? `${Math.round(maxSpeed)} km/t` : '0 km/t'}</strong></div>
            <div class="summary-card"><span>Avstand</span><strong>${totalDistance.toFixed(2)} km</strong></div>
            <div class="summary-card"><span>Snittfart</span><strong>${document.getElementById('avg-speed').innerText} km/t</strong></div>
            <div class="summary-card"><span>Høyeste punkt</span><strong>${altitudeMax}</strong></div>
            <div class="summary-card"><span>Laveste punkt</span><strong>${altitudeMin}</strong></div>
            <div class="summary-card"><span>Stigning</span><strong>${altitudeGain}</strong></div>
            <div class="summary-card"><span>Beste del</span><strong>${bestSegmentText}</strong></div>
            <div class="summary-card"><span>Pause-tid</span><strong>${formatDuration(pauseDurationSeconds)}</strong></div>
            <div class="summary-card"><span>Antall pauser</span><strong>${pauseCount}</strong></div>
            <div class="summary-card"><span>Rute punkter</span><strong>${routeCoordinates.length}</strong></div>
            <div class="summary-card"><span>Fartspunkter</span><strong>${speedCheckpoints.length}</strong></div>
        </div>
    `;
}

function renderSpeedGraph() {
    const canvas = document.getElementById('speed-graph');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    ctx.clearRect(0, 0, width, height);

    ctx.fillStyle = '#0b0b0b';
    ctx.fillRect(0, 0, width, height);

    ctx.strokeStyle = '#333';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
        const y = 20 + (height - 40) * (i / 4);
        ctx.beginPath();
        ctx.moveTo(20, y);
        ctx.lineTo(width - 20, y);
        ctx.stroke();
    }

    if (speedSamples.length < 2) {
        ctx.fillStyle = '#888';
        ctx.font = '14px Arial';
        ctx.fillText('Ingen hastighetsdata ennå', 20, height / 2);
        return;
    }

    const maxSpeed = Math.max(...speedSamples, 1);
    const minSpeed = 0;
    const chartWidth = width - 40;
    const chartHeight = height - 40;

    ctx.strokeStyle = '#0f0';
    ctx.lineWidth = 2;
    ctx.beginPath();

    speedSamples.forEach((sample, index) => {
        const x = 20 + (index / (speedSamples.length - 1)) * chartWidth;
        const y = height - 20 - ((sample - minSpeed) / (maxSpeed - minSpeed)) * chartHeight;
        if (index === 0) {
            ctx.moveTo(x, y);
        } else {
            ctx.lineTo(x, y);
        }
    });

    ctx.stroke();

    ctx.fillStyle = '#ff0';
    speedSamples.forEach((sample, index) => {
        const x = 20 + (index / (speedSamples.length - 1)) * chartWidth;
        const y = height - 20 - ((sample - minSpeed) / (maxSpeed - minSpeed)) * chartHeight;
        ctx.beginPath();
        ctx.arc(x, y, 3, 0, Math.PI * 2);
        ctx.fill();
    });
}

function clearSpeedCheckpointMarkers() {
    if (!map) return;

    speedCheckpointLayers.forEach((layer) => {
        map.removeLayer(layer);
    });
    speedCheckpointLayers = [];
}

function toggleTripMode() {
    tripModeEnabled = !tripModeEnabled;
    const button = document.getElementById('btn-trip-mode');
    const panel = document.getElementById('trip-mode-panel');
    if (button) {
        button.textContent = tripModeEnabled ? 'Turmodus: På' : 'Turmodus: Av';
        button.classList.toggle('active', tripModeEnabled);
    }
    if (panel) {
        panel.style.display = tripModeEnabled ? 'block' : 'none';
    }
    if (tripModeEnabled) {
        updateTripShareText();
    }
}

function updateTripShareText() {
    const textElement = document.getElementById('trip-share-text');
    if (!textElement) return;

    const distance = totalDistance.toFixed(2);
    const speed = maxSpeed > 0 ? Math.round(maxSpeed) : 0;
    const duration = document.getElementById('time') ? document.getElementById('time').innerText : '00:00';
    const bestSegment = calculateBestSegment();
    const bestSegmentText = bestSegment ? `${Math.round(bestSegment.speed)} km/t` : '—';
    textElement.innerText = `Tur: ${distance} km • Maks ${speed} km/t • Tid ${duration} • Beste del ${bestSegmentText} • Pauset ${formatDuration(pauseDurationSeconds)}`;
}

function copyTripSummary() {
    const text = document.getElementById('trip-share-text')?.innerText || '';
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
        logEvent('Oppsummering kopiert til utklippstavlen.');
    }).catch(() => {
        logEvent('Kunne ikke kopiere oppsummering.');
    });
}

function updateTripAltitude(altitude) {
    if (altitude === null || altitude === undefined) return;

    if (tripSummary.maxAltitude === null || altitude > tripSummary.maxAltitude) {
        tripSummary.maxAltitude = altitude;
    }

    if (tripSummary.minAltitude === null || altitude < tripSummary.minAltitude) {
        tripSummary.minAltitude = altitude;
    }

    if (tripSummary.lastAltitude !== null) {
        const delta = altitude - tripSummary.lastAltitude;
        if (delta > 0) {
            tripSummary.altitudeGain += delta;
        }
    }

    tripSummary.lastAltitude = altitude;
}

function handlePauseLogic(currentSpeed) {
    if (currentSpeed >= RESUME_THRESHOLD_SPEED && isPaused) {
        if (pauseActiveSince !== null) {
            pauseDurationSeconds += Math.floor((Date.now() - pauseActiveSince) / 1000);
            pauseActiveSince = null;
        }
        isPaused = false;
        pauseStartTime = null;
        logEvent('Tur fortsetter igjen etter pause.');
        return false;
    }

    if (currentSpeed < PAUSE_THRESHOLD_SPEED) {
        if (!isPaused) {
            if (pauseStartTime === null) {
                pauseStartTime = Date.now();
            } else if (Date.now() - pauseStartTime >= PAUSE_DELAY_MS) {
                isPaused = true;
                pauseCount += 1;
                pauseActiveSince = Date.now();
                pauseStartTime = null;
                logEvent('Tur satt på pause fordi du sto stille for lenge.');
            }
        }
    } else {
        pauseStartTime = null;
    }

    return isPaused;
}

function exportGpx() {
    if (!routeCoordinates || routeCoordinates.length === 0) {
        alert('Ingen rute å eksportere ennå.');
        return;
    }

    const trackPoints = routeCoordinates.map(([lat, lon]) => `      <trkpt lat="${lat}" lon="${lon}"></trkpt>`).join('\n');
    const gpxContent = `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="MotoTrack">\n  <trk>\n    <name>Tur ${new Date().toLocaleDateString('no-NO')}</name>\n    <trkseg>\n${trackPoints}\n    </trkseg>\n  </trk>\n</gpx>`;

    const blob = new Blob([gpxContent], { type: 'application/gpx+xml' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `mototrack-${Date.now()}.gpx`;
    link.click();
    URL.revokeObjectURL(url);
    logEvent('GPX-fil eksportert.');
}

function addSpeedCheckpoint(lat, lon, speed, timestamp, isTopSpeed = false) {
    const checkpoint = {
        lat,
        lon,
        speed: Math.round(speed),
        timestamp,
        isTopSpeed
    };

    speedCheckpoints.push(checkpoint);
    if (speedCheckpoints.length > 20) {
        speedCheckpoints.shift();
    }

    if (map) {
        const marker = L.circleMarker([lat, lon], {
            radius: isTopSpeed ? 8 : 5,
            color: isTopSpeed ? '#ff0' : '#0ff',
            fillColor: isTopSpeed ? '#ff0' : '#0ff',
            fillOpacity: 0.9
        }).addTo(map);

        marker.bindPopup(`<strong>${Math.round(speed)} km/t</strong><br>${new Date(timestamp).toLocaleTimeString('no-NO', { hour: '2-digit', minute: '2-digit' })}`);
        speedCheckpointLayers.push(marker);
    }

    renderSpeedCheckpoints();
}

function attachLifecycleHandlers() {
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pageshow', () => {
        if (isTracking) {
            restartPositionWatch();
        }
    });
    window.addEventListener('online', () => {
        if (isTracking) {
            restartPositionWatch();
        }
    });
}

function handleVisibilityChange() {
    if (!isTracking) return;

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

function maybeRequestWakeLock() {
    requestWakeLockWithRetry();
}

// --- Initialiser Kartet ---
function initMap() {
    if (typeof L === 'undefined') {
        const statusText = document.getElementById('status');
        if (statusText) {
            statusText.innerText = 'Kartbiblioteket kunne ikke lastes. Prøv å laste siden på nytt.';
        }
        logEvent('Kartbiblioteket kunne ikke lastes.');
        return;
    }

    // Setter startposisjon midt i Norge med et standard zoom-nivå
    map = L.map('map').setView([60.472, 8.468], 5);

    // Henter kartfliser fra OpenStreetMap
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors'
    }).addTo(map);

    // Klargjør streken som skal tegne ruten
    routePolyline = L.polyline([], {color: 'red', weight: 4}).addTo(map);
    logEvent('Kart lastet inn.');
}

// Kjøres automatisk når nettsiden er ferdig lastet
window.addEventListener('DOMContentLoaded', initApp);

// --- Start / Stopp Sporing ---
function toggleTracking() {
    if (isTracking) {
        stopTracking({ saveRide: true });
        return;
    }

    startTracking();
}

function startTracking() {
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

    isTracking = true;
    backgroundTrackingEnabled = true;
    if (!startTime) startTime = Date.now();

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
    clearInterval(timerInterval);
    timerInterval = setInterval(updateTimer, 1000);

    const geolocationOptions = {
        enableHighAccuracy: true,
        maximumAge: 0,
        timeout: 20000
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

function startPositionWatch(options) {
    if (watchId !== null) {
        navigator.geolocation.clearWatch(watchId);
    }

    watchId = navigator.geolocation.watchPosition(
        (position) => {
            handlePositionUpdate(position);
        },
        (error) => {
            if (!isTracking) return;
            if (error.code === 1) {
                handlePositionError(error);
                return;
            }
            if (document.visibilityState === 'hidden') {
                logEvent('GPS-signalet ble brutt i bakgrunn. Forsøker å hente ny posisjon snart.');
            }
            window.setTimeout(() => {
                if (isTracking) {
                    startPositionWatch(options);
                }
            }, 5000);
        },
        options
    );
}

function restartPositionWatch() {
    if (!isTracking) return;
    if (watchId !== null) {
        navigator.geolocation.clearWatch(watchId);
        watchId = null;
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

function stopTracking(options = { saveRide: false }) {
    if (watchId !== null) {
        navigator.geolocation.clearWatch(watchId);
        watchId = null;
    }

    clearInterval(timerInterval);
    timerInterval = null;
    stopBackgroundKeepAlive();

    isTracking = false;
    backgroundTrackingEnabled = false;
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
function handlePositionUpdate(position) {
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
    if (currentSpeed > maxSpeed) {
        maxSpeed = currentSpeed;
        topSpeedPoint = { lat, lon, timestamp: Date.now() };
        isNewTopSpeed = true;
        document.getElementById('max-speed').innerText = `Maks: ${Math.round(maxSpeed)} km/t`;
    }

    speedSamples.push(currentSpeed);
    if (speedSamples.length > 60) {
        speedSamples.shift();
    }
    renderSpeedGraph();

    // Regn ut distanse hvis vi har en forrige posisjon
    if (lastPosition) {
        const dist = calculateDistance(lastPosition.lat, lastPosition.lon, lat, lon);
        totalDistance += dist;
    }
    lastPosition = { lat, lon }; // Lagre nåværende posisjon til neste oppdatering

    // Oppdater UI
    document.getElementById('speed').innerText = Math.round(currentSpeed);
    document.getElementById('distance').innerText = totalDistance.toFixed(2);
    document.getElementById('status').innerText = 'Får GPS-signal (Nøyaktighet: ' + Math.round(coords.accuracy) + 'm)';
    renderTripSummary();
    if (tripModeEnabled) {
        updateTripShareText();
    }

    if (coords.altitude !== null) {
        document.getElementById('altitude').innerText = Math.round(coords.altitude);
    }

    const shouldRecordCheckpoint = currentSpeed > 0 && (
        lastCheckpointTime === null ||
        Date.now() - lastCheckpointTime >= CHECKPOINT_INTERVAL_MS
    );

    if (shouldRecordCheckpoint) {
        addSpeedCheckpoint(lat, lon, currentSpeed, Date.now(), isNewTopSpeed);
        lastCheckpointTime = Date.now();
    }

    // Regn ut snittfart (Distanse / Tid i timer)
    const elapsedSeconds = (Date.now() - startTime) / 1000;
    const elapsedHours = elapsedSeconds / 3600;
    if (elapsedHours > 0) {
        const avgSpeed = totalDistance / elapsedHours;
        document.getElementById('avg-speed').innerText = Math.round(avgSpeed);
    }

    // --- Oppdater Kartet ---
    const currentLatLng = [lat, lon];
    routeCoordinates.push(currentLatLng);
    routeSamples.push({ lat, lon, timestamp: Date.now() });

    if (routePolyline) {
        routePolyline.setLatLngs(routeCoordinates); // Tegn streken
    }

    // Flytt markøren og sentrer kartet
    if (map && !currentMarker) {
        currentMarker = L.marker(currentLatLng).addTo(map);
        map.setView(currentLatLng, 15);
    } else if (map && currentMarker) {
        currentMarker.setLatLng(currentLatLng);
        map.panTo(currentLatLng);
    }
}

// --- Feilhåndtering for GPS ---
function handlePositionError(error) {
    let msg = 'Ukjent GPS-feil.';
    if (error.code === 1) msg = 'Du avslo tilgang til posisjon.';
    if (error.code === 2) msg = 'Posisjon utilgjengelig (ingen signal).';
    if (error.code === 3) msg = 'Tidsavbrudd på GPS-signal.';

    document.getElementById('status').innerText = `Feil: ${msg}`;
    logEvent(`GPS Feil: ${msg}`);
}

// --- Tidtaker ---
function updateTimer() {
    if (!startTime) return;
    const elapsedSeconds = Math.floor((Date.now() - startTime) / 1000);
    const minutes = Math.floor(elapsedSeconds / 60);
    const seconds = elapsedSeconds % 60;

    // Legger til en null foran hvis tallet er under 10 (f.eks "05")
    const formattedTime =
        String(minutes).padStart(2, '0') + ':' +
        String(seconds).padStart(2, '0');

    document.getElementById('time').innerText = formattedTime;
}

// --- Nullstill tur ---
function resetRide() {
    if (!confirm('Er du sikker på at du vil slette turen?')) {
        return;
    }

    if (isTracking) {
        stopTracking({ saveRide: false });
    }

    // Nullstill variabler
    startTime = null;
    totalDistance = 0;
    maxSpeed = 0;
    lastPosition = null;
    topSpeedPoint = null;
    speedCheckpoints = [];
    lastCheckpointTime = null;
    speedSamples = [];
    isPaused = false;
    pauseStartTime = null;
    pauseCount = 0;
    pauseDurationSeconds = 0;
    pauseActiveSince = null;
    routeSamples = [];
    tripSummary = {
        maxAltitude: null,
        minAltitude: null,
        altitudeGain: 0,
        lastAltitude: null
    };
    routeCoordinates = [];

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
    if (routePolyline) routePolyline.setLatLngs([]);
    if (map && currentMarker) {
        map.removeLayer(currentMarker);
        currentMarker = null;
    }
    clearSpeedCheckpointMarkers();
    renderSpeedCheckpoints();
    renderSpeedGraph();

    logEvent('Tur nullstilt.');
}

// --- Ledertavle (Leaderboard) ---
const LEADERBOARD_STORAGE_KEY = 'mc_leaderboard_entries';

function loadRiderName() {
    return localStorage.getItem('mc_rider_name') || '';
}

function saveRiderName() {
    const input = document.getElementById('leaderboard-name-input');
    if (!input) return;

    const name = input.value.trim().slice(0, 20);
    if (!name) {
        alert('Skriv inn et navn først.');
        return;
    }

    localStorage.setItem('mc_rider_name', name);
    logEvent(`Navn lagret for ledertavlen: ${name}`);
}

function buildLeaderboardShareUrl(entry) {
    const url = new URL(window.location.href);
    url.searchParams.set('share', encodeURIComponent(JSON.stringify(entry)));
    return url.toString();
}

async function shareLeaderboardEntry() {
    const name = loadRiderName();
    if (!name) {
        alert('Skriv inn et navn først.');
        return;
    }

    const entry = {
        name,
        speed: Number(maxSpeed) || 0,
        distance: document.getElementById('distance')?.innerText || '0.00',
        duration: document.getElementById('time')?.innerText || '00:00',
        timestamp: new Date().toISOString()
    };

    const shareUrl = buildLeaderboardShareUrl(entry);
    const localEntries = addLocalLeaderboardEntry(entry);
    renderLeaderboard(localEntries);

    try {
        if (navigator.share) {
            await navigator.share({
                title: 'Mototrack resultat',
                text: `${name} oppnådde ${Math.round(entry.speed)} km/t`,
                url: shareUrl
            });
        } else if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(shareUrl);
            alert('Lenke kopiert. Del den med andre.');
        } else {
            window.prompt('Kopier denne lenken:', shareUrl);
        }

        logEvent('Resultat delt via lenke.');
    } catch (error) {
        logEvent('Deling av resultat ble avbrutt.');
    }
}

function getLocalLeaderboardEntries() {
    try {
        const stored = localStorage.getItem(LEADERBOARD_STORAGE_KEY);
        return stored ? JSON.parse(stored) : [];
    } catch (error) {
        return [];
    }
}

function saveLocalLeaderboardEntries(entries) {
    localStorage.setItem(LEADERBOARD_STORAGE_KEY, JSON.stringify(entries));
    return entries;
}

function addLocalLeaderboardEntry(entry) {
    const entries = getLocalLeaderboardEntries();
    entries.push(entry);
    entries.sort((a, b) => b.speed - a.speed);
    return saveLocalLeaderboardEntries(entries.slice(0, 10));
}

function loadSharedLeaderboardEntryFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const shared = params.get('share');
    if (!shared) return null;

    try {
        const parsed = JSON.parse(decodeURIComponent(shared));
        if (!parsed || !parsed.name || !parsed.speed) return null;

        const entries = addLocalLeaderboardEntry(parsed);
        const url = new URL(window.location.href);
        url.searchParams.delete('share');
        window.history.replaceState({}, document.title, url.toString());
        return entries;
    } catch (error) {
        return null;
    }
}

function renderLeaderboard(entries) {
    const container = document.getElementById('leaderboard-list');
    if (!container) return;

    if (!entries || entries.length === 0) {
        container.innerHTML = '<p style="color: #888; margin: 0;">Ingen resultater på ledertavlen ennå. Appen fungerer også uten betalt server.</p>';
        return;
    }

    const medals = ['🥇', '🥈', '🥉'];
    const html = entries.map((entry, index) => {
        const medal = medals[index] || `${index + 1}.`;
        const date = entry.timestamp ? new Date(entry.timestamp).toLocaleDateString('no-NO') : '';
        return `
            <div class="leaderboard-item">
                <span class="leaderboard-rank">${medal}</span>
                <span class="leaderboard-name">${entry.name}</span>
                <span class="leaderboard-speed">${Math.round(entry.speed)} km/t</span>
                <span class="leaderboard-date">${date}</span>
            </div>
        `;
    }).join('');

    container.innerHTML = html;
}

function fetchLeaderboard() {
    const localEntries = getLocalLeaderboardEntries();
    renderLeaderboard(localEntries);
    return localEntries;
}

function submitScoreToLeaderboard(rideData) {
    const name = loadRiderName();
    if (!name) {
        logEvent('Ingen navn lagret – hopper over innsending til ledertavlen.');
        return;
    }

    if (!rideData.maxSpeed || rideData.maxSpeed <= 0) {
        return;
    }

    const entry = {
        name,
        speed: rideData.maxSpeed,
        distance: rideData.distance,
        duration: rideData.duration,
        timestamp: new Date().toISOString()
    };

    const localEntries = addLocalLeaderboardEntry(entry);
    renderLeaderboard(localEntries);
    logEvent('Resultat lagret lokalt i ledertavlen.');
}

function initLeaderboardUI() {
    const input = document.getElementById('leaderboard-name-input');
    if (input) {
        input.value = loadRiderName();
    }

    const sharedEntries = loadSharedLeaderboardEntryFromUrl();
    if (sharedEntries) {
        renderLeaderboard(sharedEntries);
    }

    fetchLeaderboard();
}

// --- Matematikk for å regne ut avstand mellom to GPS-punkter (Haversine formel) ---
function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Jordens radius i kilometer
    const toRad = Math.PI / 180;
    const dLat = (lat2 - lat1) * toRad;
    const dLon = (lon2 - lon1) * toRad;

    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c; // Distanse i kilometer
}

// --- Lagre nåværende tur til LocalStorage ---
function saveCurrentRide() {
    if (routeCoordinates.length === 0 && totalDistance === 0) {
        alert('Ingen turdata å lagre ennå.');
        return;
    }

    const rideData = {
        id: Date.now(), // Unik ID basert på tidspunkt
        date: new Date().toLocaleDateString('no-NO') + ' ' + new Date().toLocaleTimeString('no-NO', {hour: '2-digit', minute:'2-digit'}),
        distance: totalDistance.toFixed(2),
        maxSpeed: Math.round(maxSpeed),
        duration: document.getElementById('time').innerText,
        coordinates: routeCoordinates,
        topSpeedPoint,
        speedCheckpoints
    };

    // Hent eksisterende turer fra localStorage (eller opprett tom liste hvis ingen finnes)
    let rides = JSON.parse(localStorage.getItem('mc_rides')) || [];

    // Legg den nye turen øverst i listen
    rides.unshift(rideData);

    // Behold maks 5 turer og slett de eldste automatisk
    if (rides.length > 5) {
        rides = rides.slice(0, 5);
    }

    // Lagre den oppdaterte listen tilbake til localStorage
    localStorage.setItem('mc_rides', JSON.stringify(rides));

    logEvent('Tur lagret i historikk!');
    loadSavedRides(); // Oppdater visningen på skjermen
    submitScoreToLeaderboard(rideData);
}

// --- Les inn og vis lagrede turer fra LocalStorage ---
function loadSavedRides() {
    const ridesContainer = document.getElementById('saved-rides-list');
    if (!ridesContainer) return;

    const rides = JSON.parse(localStorage.getItem('mc_rides')) || [];

    if (rides.length === 0) {
        ridesContainer.innerHTML = "<p style='color: #888;'>Ingen lagrede turer ennå.</p>";
        return;
    }

    let html = '';
    rides.forEach((ride) => {
        html += `
            <div class="saved-ride-item" onclick="showRideDetails(${ride.id})">
                <strong>📅 ${ride.date}</strong><br>
                <span>Distanse: <b>${ride.distance} km</b> | Maks: <b>${ride.maxSpeed} km/t</b> | Tid: <b>${ride.duration}</b> | Fartspunkter: <b>${(ride.speedCheckpoints || []).length}</b></span><br>
                <button onclick="event.stopPropagation(); deleteRide(${ride.id})" style="padding: 5px 10px; font-size: 0.8rem; background: #600; margin-top: 5px;">Slett</button>
            </div>
        `;
    });

    ridesContainer.innerHTML = html;
}

function showRideDetails(rideId) {
    const rides = JSON.parse(localStorage.getItem('mc_rides')) || [];
    const ride = rides.find((item) => item.id === rideId);
    if (!ride) return;

    const detailsPanel = document.getElementById('ride-details-panel');
    const detailsContent = document.getElementById('ride-details-content');
    if (!detailsPanel || !detailsContent) return;

    detailsContent.innerHTML = `
        <p><strong>Dato:</strong> ${ride.date}</p>
        <p><strong>Distanse:</strong> ${ride.distance} km</p>
        <p><strong>Maksfart:</strong> ${ride.maxSpeed} km/t</p>
        <p><strong>Varighet:</strong> ${ride.duration}</p>
        <p><strong>Toppfartspunkt:</strong> ${ride.topSpeedPoint ? `${Math.round(ride.topSpeedPoint.lat * 100000) / 100000}, ${Math.round(ride.topSpeedPoint.lon * 100000) / 100000}` : 'Ikke registrert'}</p>
    `;

    detailsPanel.style.display = 'block';
    detailsPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });

    initRideDetailsMap(ride);
}

function initRideDetailsMap(ride) {
    const mapContainer = document.getElementById('ride-details-map');
    if (!mapContainer) return;

    if (rideDetailsMap) {
        rideDetailsMap.remove();
        rideDetailsMap = null;
    }

    rideDetailsMarkers.forEach((marker) => marker.remove());
    rideDetailsMarkers = [];

    rideDetailsMap = L.map('ride-details-map').setView([60.472, 8.468], 5);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors'
    }).addTo(rideDetailsMap);

    if (ride.coordinates && ride.coordinates.length > 1) {
        rideDetailsPolyline = L.polyline(ride.coordinates, { color: 'red', weight: 4 }).addTo(rideDetailsMap);
        rideDetailsMap.fitBounds(rideDetailsPolyline.getBounds());
    }

    if (ride.topSpeedPoint) {
        const topSpeedMarker = L.circleMarker([ride.topSpeedPoint.lat, ride.topSpeedPoint.lon], {
            radius: 8,
            color: '#ff0',
            fillColor: '#ff0',
            fillOpacity: 0.9
        }).addTo(rideDetailsMap);
        topSpeedMarker.bindPopup('Toppfart');
        rideDetailsMarkers.push(topSpeedMarker);
    }

    (ride.speedCheckpoints || []).forEach((checkpoint) => {
        const marker = L.circleMarker([checkpoint.lat, checkpoint.lon], {
            radius: 5,
            color: '#0ff',
            fillColor: '#0ff',
            fillOpacity: 0.9
        }).addTo(rideDetailsMap);
        marker.bindPopup(`${checkpoint.speed} km/t`);
        rideDetailsMarkers.push(marker);
    });
}

// --- Slette en enkelt tur ---
function deleteRide(id) {
    if (confirm('Vil du slette denne turen fra historikken?')) {
        let rides = JSON.parse(localStorage.getItem('mc_rides')) || [];
        rides = rides.filter(ride => ride.id !== id);
        localStorage.setItem('mc_rides', JSON.stringify(rides));
        loadSavedRides();
        const detailsPanel = document.getElementById('ride-details-panel');
        if (detailsPanel) detailsPanel.style.display = 'none';
        logEvent('En tur ble slettet fra historikken.');
    }
}