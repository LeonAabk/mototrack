// --- Globale variabler for å holde styr på turen ---
let isTracking = false;
let watchId = null; // ID-en til GPS-lytteren
let startTime = null;
let timerInterval = null;

let totalDistance = 0; // I kilometer
let maxSpeed = 0; // I km/t
let lastPosition = null; // Forrige GPS-koordinat

// --- Kartvariabler (Leaflet) ---
let map = null;
let currentMarker = null;
let routePolyline = null;
let routeCoordinates = [];

// --- Hjelpefunksjon: Logg hendelser til skjermen ---
function logEvent(message) {
    const logElement = document.getElementById('log-output');
    const timeString = new Date().toLocaleTimeString('no-NO');
    logElement.innerText = `[${timeString}] ${message}\n` + logElement.innerText;
}

// --- Initialiser Kartet ---
function initMap() {
    // Setter startposisjon midt i Norge med et standard zoom-nivå
    map = L.map('map').setView([60.472, 8.468], 5);
    
    // Henter kartfliser fra OpenStreetMap
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors'
    }).addTo(map);

    // Klargjør streken som skal tegne ruten
    routePolyline = L.polyline([], {color: 'red', weight: 4}).addTo(map);
    logEvent("Kart lastet inn.");
}

// Kjøres automatisk når nettsiden er ferdig lastet
window.onload = initMap;
// Kjøres automatisk når nettsiden er ferdig lastet
window.onload = function() {
    initMap();
    loadSavedRides(); // Henter frem tidligere lagrede turer
};
// --- Start / Stopp Sporing ---
function toggleTracking() {
    const btn = document.getElementById('btn-toggle');
    const statusText = document.getElementById('status');

    if (isTracking) {
        // STOPP SPORING
        isTracking = false;
        navigator.geolocation.clearWatch(watchId);
        clearInterval(timerInterval);
        
        btn.classList.remove('active');
        btn.textContent = 'Start Sporing';
        statusText.innerText = 'Sporing stoppet.';
        logEvent("Sporing stoppet.");
        saveCurrentRide();
    } else {
        // START SPORING
        if (!navigator.geolocation) {
            alert("Nettleseren din støtter ikke GPS-sporing.");
            return;
        }

        isTracking = true;
        if (!startTime) startTime = Date.now(); // Start tiden kun hvis det er en ny tur
        
        btn.classList.add('active');
        btn.textContent = 'Stopp Sporing';
        statusText.innerText = 'Henter posisjon...';
        logEvent("Sporing startet. Venter på GPS...");

        // Start tidtakeren
        timerInterval = setInterval(updateTimer, 1000);

        // Start lytting på GPS
        watchId = navigator.geolocation.watchPosition(
            handlePositionUpdate, 
            handlePositionError, 
            { enableHighAccuracy: true, maximumAge: 0 } // Krever nøyaktig GPS
        );
    }
}

// --- Håndter nye GPS-data ---
function handlePositionUpdate(position) {
    const coords = position.coords;
    const lat = coords.latitude;
    const lon = coords.longitude;
    
    // Konverter fart fra meter per sekund (m/s) til km/t
    // Hvis coords.speed er null (ofte tilfelle når man står stille på iOS), bruk 0
    let currentSpeed = (coords.speed || 0) * 3.6; 
    
    // Oppdater maksfart
    if (currentSpeed > maxSpeed) {
        maxSpeed = currentSpeed;
        document.getElementById('max-speed').innerText = `Maks: ${Math.round(maxSpeed)} km/t`;
    }

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
    
    if (coords.altitude !== null) {
        document.getElementById('altitude').innerText = Math.round(coords.altitude);
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
    routePolyline.setLatLngs(routeCoordinates); // Tegn streken

    // Flytt markøren og sentrer kartet
    if (!currentMarker) {
        currentMarker = L.marker(currentLatLng).addTo(map);
        map.setView(currentLatLng, 15);
    } else {
        currentMarker.setLatLng(currentLatLng);
        map.panTo(currentLatLng);
    }
}

// --- Feilhåndtering for GPS ---
function handlePositionError(error) {
    let msg = "Ukjent GPS-feil.";
    if (error.code === 1) msg = "Du avslo tilgang til posisjon.";
    if (error.code === 2) msg = "Posisjon utilgjengelig (ingen signal).";
    if (error.code === 3) msg = "Tidsavbrudd på GPS-signal.";
    
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
    if(confirm("Er du sikker på at du vil slette turen?")) {
        // Hvis vi sporer, stopp det først
        if (isTracking) toggleTracking();

        // Nullstill variabler
        startTime = null;
        totalDistance = 0;
        maxSpeed = 0;
        lastPosition = null;
        routeCoordinates = [];

        // Nullstill UI
        document.getElementById('speed').innerText = "0";
        document.getElementById('max-speed').innerText = "Maks: 0 km/t";
        document.getElementById('distance').innerText = "0.00";
        document.getElementById('avg-speed').innerText = "0";
        document.getElementById('time').innerText = "00:00";
        document.getElementById('altitude').innerText = "0";
        document.getElementById('log-output').innerText = "Tur nullstilt.\n";
        document.getElementById('status').innerText = "Venter på GPS-signal...";

        // Fjern ruten fra kartet
        if (routePolyline) routePolyline.setLatLngs([]);
        if (currentMarker) {
            map.removeLayer(currentMarker);
            currentMarker = null;
        }
        
        logEvent("Tur nullstilt.");
    }
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
    if (totalDistance === 0 && routeCoordinates.length === 0) {
        alert("Ingen turdata å lagre ennå.");
        return;
    }

    const rideData = {
        id: Date.now(), // Unik ID basert på tidspunkt
        date: new Date().toLocaleDateString('no-NO') + ' ' + new Date().toLocaleTimeString('no-NO', {hour: '2-digit', minute:'2-digit'}),
        distance: totalDistance.toFixed(2),
        maxSpeed: Math.round(maxSpeed),
        duration: document.getElementById('time').innerText,
        coordinates: routeCoordinates
    };

    // Hent eksisterende turer fra localStorage (eller opprett tom liste hvis ingen finnes)
    let rides = JSON.parse(localStorage.getItem('mc_rides')) || [];
    
    // Legg den nye turen øverst i listen
    rides.unshift(rideData);

    // Lagre den oppdaterte listen tilbake til localStorage
    localStorage.setItem('mc_rides', JSON.stringify(rides));

    logEvent("Tur lagret i historikk!");
    loadSavedRides(); // Oppdater visningen på skjermen
}

// --- Les inn og vis lagrede turer fra LocalStorage ---
function loadSavedRides() {
    const ridesContainer = document.getElementById('saved-rides-list');
    const rides = JSON.parse(localStorage.getItem('mc_rides')) || [];

    if (rides.length === 0) {
        ridesContainer.innerHTML = "<p style='color: #888;'>Ingen lagrede turer ennå.</p>";
        return;
    }

    let html = '';
    rides.forEach(ride => {
        html += `
            <div style="background: #111; padding: 10px; margin-bottom: 10px; border-radius: 5px; border: 1px solid #444;">
                <strong>📅 ${ride.date}</strong><br>
                <span>Distanse: <b>${ride.distance} km</b> | Maks: <b>${ride.maxSpeed} km/t</b> | Tid: <b>${ride.duration}</b></span><br>
                <button onclick="deleteRide(${ride.id})" style="padding: 5px 10px; font-size: 0.8rem; background: #600; margin-top: 5px;">Slett</button>
            </div>
        `;
    });

    ridesContainer.innerHTML = html;
}

// --- Slette en enkelt tur ---
function deleteRide(id) {
    if (confirm("Vil du slette denne turen fra historikken?")) {
        let rides = JSON.parse(localStorage.getItem('mc_rides')) || [];
        rides = rides.filter(ride => ride.id !== id);
        localStorage.setItem('mc_rides', JSON.stringify(rides));
        loadSavedRides();
        logEvent("En tur ble slettet fra historikken.");
    }
}