import { state } from "./state.js";
import { logEvent } from "./utils.js";
import { initApp } from "./main.js";

export function renderSpeedCheckpoints() {
    const container = document.getElementById('speed-points-list');
    if (!container) return;

    if (state.speedCheckpoints.length === 0) {
        container.innerHTML = '<p style="color: #888; margin: 0;">Ingen fartspunkter registrert ennå.</p>';
        return;
    }

    const html = state.speedCheckpoints.map((checkpoint) => {
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


export function clearSpeedCheckpointMarkers() {
    if (!state.map) return;

    state.speedCheckpointLayers.forEach((layer) => {
        state.map.removeLayer(layer);
    });
    state.speedCheckpointLayers = [];
}


export function addSpeedCheckpoint(lat, lon, speed, timestamp, isTopSpeed = false) {
    const checkpoint = {
        lat,
        lon,
        speed: Math.round(speed),
        timestamp,
        isTopSpeed
    };

    state.speedCheckpoints.push(checkpoint);
    if (state.speedCheckpoints.length > 20) {
        state.speedCheckpoints.shift();
    }

    if (state.map) {
        const marker = L.circleMarker([lat, lon], {
            radius: isTopSpeed ? 8 : 5,
            color: isTopSpeed ? '#ff0' : '#0ff',
            fillColor: isTopSpeed ? '#ff0' : '#0ff',
            fillOpacity: 0.9
        }).addTo(state.map);

        marker.bindPopup(`<strong>${Math.round(speed)} km/t</strong><br>${new Date(timestamp).toLocaleTimeString('no-NO', { hour: '2-digit', minute: '2-digit' })}`);
        state.speedCheckpointLayers.push(marker);
    }

    renderSpeedCheckpoints();
}


export function initMap() {
    if (typeof L === 'undefined') {
        const statusText = document.getElementById('status');
        if (statusText) {
            statusText.innerText = 'Kartbiblioteket kunne ikke lastes. Prøv å laste siden på nytt.';
        }
        logEvent('Kartbiblioteket kunne ikke lastes.');
        return;
    }

    // Setter startposisjon midt i Norge med et standard zoom-nivå
    state.map = L.map('map').setView([60.472, 8.468], 5);

    // Henter kartfliser fra OpenStreetMap
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors'
    }).addTo(state.map);

    // Klargjør streken som skal tegne ruten
    // (state.routePolyline er beholdt for bakoverkompatibilitet hvis brukt andre steder, men nå tegnes segmenter manuelt for fargekoding)
    state.routePolyline = L.polyline([], {color: 'red', weight: 4}).addTo(state.map);
    logEvent('Kart lastet inn.');
}

// Kjøres automatisk når nettsiden er ferdig lastet
window.addEventListener('DOMContentLoaded', initApp);

// --- Start / Stopp Sporing ---

export function initRideDetailsMap(ride) {
    const mapContainer = document.getElementById('ride-details-map');
    if (!mapContainer) return;

    if (state.rideDetailsMap) {
        state.rideDetailsMap.remove();
        state.rideDetailsMap = null;
    }

    state.rideDetailsMarkers.forEach((marker) => marker.remove());
    state.rideDetailsMarkers = [];

    state.rideDetailsMap = L.map('ride-details-map').setView([60.472, 8.468], 5);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors'
    }).addTo(state.rideDetailsMap);

    if (ride.coordinates && ride.coordinates.length > 1) {
        state.rideDetailsPolyline = L.polyline(ride.coordinates, { color: 'red', weight: 4 }).addTo(state.rideDetailsMap);
        state.rideDetailsMap.fitBounds(state.rideDetailsPolyline.getBounds());
    }

    if (ride.topSpeedPoint) {
        const topSpeedMarker = L.circleMarker([ride.topSpeedPoint.lat, ride.topSpeedPoint.lon], {
            radius: 8,
            color: '#ff0',
            fillColor: '#ff0',
            fillOpacity: 0.9
        }).addTo(state.rideDetailsMap);
        topSpeedMarker.bindPopup('Toppfart');
        state.rideDetailsMarkers.push(topSpeedMarker);
    }

    (ride.speedCheckpoints || []).forEach((checkpoint) => {
        const marker = L.circleMarker([checkpoint.lat, checkpoint.lon], {
            radius: 5,
            color: '#0ff',
            fillColor: '#0ff',
            fillOpacity: 0.9
        }).addTo(state.rideDetailsMap);
        marker.bindPopup(`${checkpoint.speed} km/t`);
        state.rideDetailsMarkers.push(marker);
    });
}

// --- Slette en enkelt tur ---
