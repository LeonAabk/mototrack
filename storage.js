import { state } from "./state.js";
import { logEvent, calculateDistance } from "./utils.js";
import { initRideDetailsMap } from "./map.js";
import { submitScoreToLeaderboard } from "./leaderboard.js";

export function calculateBestSegment() {
    if (state.routeSamples.length < 2) return null;

    let best = null;

    for (let i = 0; i < state.routeSamples.length - 1; i++) {
        const start = state.routeSamples[i];
        const end = state.routeSamples[i + 1];
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


export function exportGpx() {
    if (!state.routeSamples || state.routeSamples.length === 0) {
        alert('Ingen rute å eksportere ennå.');
        return;
    }

    const trackPoints = state.routeSamples.map(sample => {
        const timeIso = new Date(sample.timestamp).toISOString();
        let extension = '';
        if (sample.speed !== undefined) {
            extension = `\n        <extensions>\n          <speed>${(sample.speed / 3.6).toFixed(2)}</speed>\n        </extensions>`;
        }
        return `      <trkpt lat="${sample.lat}" lon="${sample.lon}">\n        <time>${timeIso}</time>${extension}\n      </trkpt>`;
    }).join('\n');

    const gpxContent = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="MotoTrack" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <name>Tur ${new Date().toLocaleDateString('no-NO')}</name>
    <trkseg>
${trackPoints}
    </trkseg>
  </trk>
</gpx>`;

    const blob = new Blob([gpxContent], { type: 'application/gpx+xml' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `mototrack-${Date.now()}.gpx`;
    link.click();
    URL.revokeObjectURL(url);
    logEvent('GPX-fil eksportert.');
}


export function saveCurrentRide() {
    if (state.routeCoordinates.length === 0 && state.totalDistance === 0) {
        alert('Ingen turdata å lagre ennå.');
        return;
    }

    const rideData = {
        id: Date.now(), // Unik ID basert på tidspunkt
        date: new Date().toLocaleDateString('no-NO') + ' ' + new Date().toLocaleTimeString('no-NO', {hour: '2-digit', minute:'2-digit'}),
        distance: state.totalDistance.toFixed(2),
        maxSpeed: Math.round(state.maxSpeed),
        duration: document.getElementById('time').innerText,
        coordinates: state.routeCoordinates,
        topSpeedPoint: state.topSpeedPoint,
        state.speedCheckpoints
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

export function loadSavedRides() {
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


export function showRideDetails(rideId) {
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


export function deleteRide(id) {
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
