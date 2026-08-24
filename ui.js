import { state } from "./state.js";
import { logEvent, formatDuration } from "./utils.js";
import { calculateBestSegment } from "./storage.js";

export function updateTrackingButton(isActive) {
    const btn = document.getElementById('btn-toggle');
    if (!btn) return;

    btn.classList.toggle('active', isActive);
    btn.textContent = isActive ? 'Stopp Sporing' : 'Start Sporing';
}


export function renderTripSummary() {
    const container = document.getElementById('trip-summary-content');
    if (!container) return;

    const stateLabel = state.isPaused ? 'Pauset' : 'Aktiv';
    const altitudeMax = state.tripSummary.maxAltitude !== null ? `${Math.round(state.tripSummary.maxAltitude)} m` : '—';
    const altitudeMin = state.tripSummary.minAltitude !== null ? `${Math.round(state.tripSummary.minAltitude)} m` : '—';
    const altitudeGain = state.tripSummary.altitudeGain > 0 ? `${Math.round(state.tripSummary.altitudeGain)} m` : '0 m';
    const bestSegment = calculateBestSegment();
    const bestSegmentText = bestSegment ? `${Math.round(bestSegment.speed)} km/t` : '—';

    container.innerHTML = `
        <div class="summary-grid">
            <div class="summary-card"><span>Status</span><strong>${stateLabel}</strong></div>
            <div class="summary-card"><span>Topphastighet</span><strong>${state.maxSpeed > 0 ? `${Math.round(state.maxSpeed)} km/t` : '0 km/t'}</strong></div>
            <div class="summary-card"><span>Avstand</span><strong>${state.totalDistance.toFixed(2)} km</strong></div>
            <div class="summary-card"><span>Snittfart</span><strong>${document.getElementById('avg-speed').innerText} km/t</strong></div>
            <div class="summary-card"><span>Høyeste punkt</span><strong>${altitudeMax}</strong></div>
            <div class="summary-card"><span>Laveste punkt</span><strong>${altitudeMin}</strong></div>
            <div class="summary-card"><span>Stigning</span><strong>${altitudeGain}</strong></div>
            <div class="summary-card"><span>Beste del</span><strong>${bestSegmentText}</strong></div>
            <div class="summary-card"><span>Pause-tid</span><strong>${formatDuration(state.pauseDurationSeconds)}</strong></div>
            <div class="summary-card"><span>Antall pauser</span><strong>${state.pauseCount}</strong></div>
            <div class="summary-card"><span>Rute punkter</span><strong>${state.routeCoordinates.length}</strong></div>
            <div class="summary-card"><span>Fartspunkter</span><strong>${state.speedCheckpoints.length}</strong></div>
        </div>
    `;
}


export function renderSpeedGraph() {
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

    if (state.speedSamples.length < 2) {
        ctx.fillStyle = '#888';
        ctx.font = '14px Arial';
        ctx.fillText('Ingen hastighetsdata ennå', 20, height / 2);
        return;
    }


    const minSpeed = 0;
    const chartWidth = width - 40;
    const chartHeight = height - 40;

    ctx.strokeStyle = '#0f0';
    ctx.lineWidth = 2;
    ctx.beginPath();

    state.speedSamples.forEach((sample, index) => {
        const x = 20 + (index / (state.speedSamples.length - 1)) * chartWidth;
        const y = height - 20 - ((sample - minSpeed) / (state.maxSpeed - minSpeed)) * chartHeight;
        if (index === 0) {
            ctx.moveTo(x, y);
        } else {
            ctx.lineTo(x, y);
        }
    });

    ctx.stroke();

    ctx.fillStyle = '#ff0';
    state.speedSamples.forEach((sample, index) => {
        const x = 20 + (index / (state.speedSamples.length - 1)) * chartWidth;
        const y = height - 20 - ((sample - minSpeed) / (state.maxSpeed - minSpeed)) * chartHeight;
        ctx.beginPath();
        ctx.arc(x, y, 3, 0, Math.PI * 2);
        ctx.fill();
    });
}


export function toggleTripMode() {
    state.tripModeEnabled = !state.tripModeEnabled;
    const button = document.getElementById('btn-trip-mode');
    const panel = document.getElementById('trip-mode-panel');
    if (button) {
        button.textContent = state.tripModeEnabled ? 'Turmodus: På' : 'Turmodus: Av';
        button.classList.toggle('active', state.tripModeEnabled);
    }
    if (panel) {
        panel.style.display = state.tripModeEnabled ? 'block' : 'none';
    }
    if (state.tripModeEnabled) {
        updateTripShareText();
    }
}


export function updateTripShareText() {
    const textElement = document.getElementById('trip-share-text');
    if (!textElement) return;

    const distance = state.totalDistance.toFixed(2);
    const speed = state.maxSpeed > 0 ? Math.round(state.maxSpeed) : 0;
    const duration = document.getElementById('time') ? document.getElementById('time').innerText : '00:00';
    const bestSegment = calculateBestSegment();
    const bestSegmentText = bestSegment ? `${Math.round(bestSegment.speed)} km/t` : '—';
    textElement.innerText = `Tur: ${distance} km • Maks ${speed} km/t • Tid ${duration} • Beste del ${bestSegmentText} • Pauset ${formatDuration(state.pauseDurationSeconds)}`;
}


export function copyTripSummary() {
    const text = document.getElementById('trip-share-text')?.innerText || '';
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
        logEvent('Oppsummering kopiert til utklippstavlen.');
    }).catch(() => {
        logEvent('Kunne ikke kopiere oppsummering.');
    });
}
