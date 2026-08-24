const LEADERBOARD_STORAGE_KEY = "mc_leaderboard_entries";
import { state } from "./state.js";
import { logEvent } from "./utils.js";

export function loadRiderName() {
    return localStorage.getItem('mc_rider_name') || '';
}


export function saveRiderName() {
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


export function buildLeaderboardShareUrl(entry) {
    const url = new URL(window.location.href);
    url.searchParams.set('share', encodeURIComponent(JSON.stringify(entry)));
    return url.toString();
}


export async function shareLeaderboardEntry() {
    const name = loadRiderName();
    if (!name) {
        alert('Skriv inn et navn først.');
        return;
    }

    const entry = {
        name,
        speed: Number(state.maxSpeed) || 0,
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


export function getLocalLeaderboardEntries() {
    try {
        const stored = localStorage.getItem(LEADERBOARD_STORAGE_KEY);
        return stored ? JSON.parse(stored) : [];
    } catch (error) {
        return [];
    }
}


export function saveLocalLeaderboardEntries(entries) {
    localStorage.setItem(LEADERBOARD_STORAGE_KEY, JSON.stringify(entries));
    return entries;
}


export function addLocalLeaderboardEntry(entry) {
    const entries = getLocalLeaderboardEntries();
    entries.push(entry);
    entries.sort((a, b) => b.speed - a.speed);
    return saveLocalLeaderboardEntries(entries.slice(0, 10));
}


export function loadSharedLeaderboardEntryFromUrl() {
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


export function renderLeaderboard(entries) {
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


export function fetchLeaderboard() {
    const localEntries = getLocalLeaderboardEntries();
    renderLeaderboard(localEntries);
    return localEntries;
}


export function submitScoreToLeaderboard(rideData) {
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


export function initLeaderboardUI() {
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
