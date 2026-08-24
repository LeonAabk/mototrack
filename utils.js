import { state } from "./state.js";

export function logEvent(message) {
    const logElement = document.getElementById('log-output');
    if (!logElement) return;

    const timeString = new Date().toLocaleTimeString('no-NO');
    logElement.innerText = `[${timeString}] ${message}\n` + logElement.innerText;
}


export function isSecureGeolocationContext() {
    return window.isSecureContext || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
}


export function formatDuration(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}


export function calculateDistance(lat1, lon1, lat2, lon2) {
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
