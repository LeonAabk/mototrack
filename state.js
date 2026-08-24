export const state = {
    isTracking: null,
    watchId: null,
    startTime: null,
    timerInterval: null,
    wakeLock: null,
    backgroundTrackingEnabled: null,
    totalDistance: null,
    maxSpeed: null,
    lastPosition: null,
    topSpeedPoint: null,
    speedCheckpoints: null,
    speedCheckpointLayers: null,
    lastCheckpointTime: null,
    speedSamples: null,
    isPaused: null,
    pauseStartTime: null,
    tripSummary: null,
    tripModeEnabled: null,
    pauseCount: null,
    pauseDurationSeconds: null,
    pauseActiveSince: null,
    routeSamples: null,
    CHECKPOINT_INTERVAL_MS: null,
    PAUSE_THRESHOLD_SPEED: null,
    RESUME_THRESHOLD_SPEED: null,
    PAUSE_DELAY_MS: null,
    batteryLevel: null,
    isBatteryLow: null,
    lastBatteryWarning: null,
    adaptiveAccuracyMode: null,
    backgroundKeepAliveInterval: null,
    lastWakeLockRequest: null,
    map: null,
    currentMarker: null,
    routePolyline: null,
    routeSegments: null,
    activeSegmentColor: null,
    routeCoordinates: null,
    rideDetailsMap: null,
    rideDetailsPolyline: null,
    rideDetailsMarkers: null,
};

// Initialize constants and default values
state.isTracking = false;
state.backgroundTrackingEnabled = false;
state.totalDistance = 0;
state.maxSpeed = 0;
state.speedCheckpoints = [];
state.speedCheckpointLayers = [];
state.speedSamples = [];
state.isPaused = false;
state.tripSummary = { maxAltitude: null, minAltitude: null, altitudeGain: 0, lastAltitude: null };
state.tripModeEnabled = false;
state.pauseCount = 0;
state.pauseDurationSeconds = 0;
state.routeSamples = [];
state.CHECKPOINT_INTERVAL_MS = 20000;
state.PAUSE_THRESHOLD_SPEED = 5;
state.RESUME_THRESHOLD_SPEED = 8;
state.PAUSE_DELAY_MS = 10000;
state.batteryLevel = 100;
state.isBatteryLow = false;
state.lastBatteryWarning = 0;
state.adaptiveAccuracyMode = false;
state.lastWakeLockRequest = 0;
state.routeSegments = [];
state.routeCoordinates = [];
state.rideDetailsMarkers = [];
