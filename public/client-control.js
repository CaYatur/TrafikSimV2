// Kontrol arayüzü — render + ayarlar + acil araç spawn.

const canvas = document.getElementById('trafficCanvas');
const ctx = canvas.getContext('2d', { alpha: false });
const client = new SimClient('control');

let pendingEmergencyType = null;
let frameCount = 0;
let lastFpsTime = Date.now();
let lastRenderTime = 0;
let fps = 0;
const TARGET_FRAME_MS = 0;

const $ = (id) => document.getElementById(id);
const WEATHER_LABELS = { auto: 'Otomatik', clear: 'Açık', rain: 'Yağmur', snow: 'Kar' };
const TIME_LABELS = { auto: 'Otomatik', morning: 'Sabah', noon: 'Öğle', day: 'Gündüz', evening: 'Akşam', night: 'Gece' };

// Bağlantı durumu
function setConn(connected) {
    $('conn-pill').className = 'conn-pill ' + (connected ? 'connected' : 'disconnected');
}
client.on('open', () => setConn(true));
client.on('close', () => setConn(false));

// Hello — server'dan ayarları çek
client.on('hello', (msg) => {
    const s = msg.snapshot.settings;
    $('traffic-density').value = Math.round(s.trafficDensity * 100);
    $('density-value').textContent = Math.round(s.trafficDensity * 100) + '%';
    $('light-duration').value = Math.round(s.lightDuration / 1000);
    $('duration-value').textContent = Math.round(s.lightDuration / 1000) + 's';
    $('adaptive-lights').checked = !!s.adaptiveLights;
    $('adaptive-value').textContent = s.adaptiveLights ? 'Açık' : 'Kapalı';
    $('car-speed').value = s.carSpeedMultiplier;
    $('speed-value').textContent = s.carSpeedMultiplier + 'x';
    $('car-acceleration').value = s.acceleration;
    $('acceleration-value').textContent = s.acceleration;
    $('collision-distance').value = s.collisionDistance;
    $('collision-value').textContent = s.collisionDistance + 'px';
    syncEnvironmentControls(s);
    setPauseButton(msg.snapshot.paused);
});

client.on('state', (snap) => {
    $('car-count').textContent = snap.cars.length;
    $('tick').textContent = client.getLatencyText();
    syncEnvironmentControls(snap.settings);
    $('run-state').textContent = snap.paused ? 'DURAKLATILDI' : (snap.emergency.active ? 'ACİL' : 'AKTİF');
    $('adaptive-lights').checked = !!snap.settings.adaptiveLights;
    $('adaptive-value').textContent = snap.settings.adaptiveLights ? 'Açık' : 'Kapalı';
    setPauseButton(snap.paused);
});

function syncEnvironmentControls(settings) {
    settings = settings || {};
    const weather = settings.weather || 'auto';
    const timeOfDay = settings.timeOfDay || 'auto';
    if ($('weather-mode')) $('weather-mode').value = weather;
    if ($('weather-value')) $('weather-value').textContent = WEATHER_LABELS[weather] || weather;
    if ($('time-of-day')) $('time-of-day').value = timeOfDay;
    if ($('time-value')) $('time-value').textContent = TIME_LABELS[timeOfDay] || timeOfDay;
}

function setPauseButton(paused) {
    const btn = $('pause-btn');
    if (paused) { btn.textContent = 'Devam Et'; btn.classList.add('paused'); btn.classList.remove('primary'); }
    else { btn.textContent = 'Duraklat'; btn.classList.add('primary'); btn.classList.remove('paused'); }
}

// ==================== RENDER LOOP ====================

function render(frameTime = performance.now()) {
    if (frameTime - lastRenderTime < TARGET_FRAME_MS) {
        requestAnimationFrame(render);
        return;
    }
    lastRenderTime = frameTime;

    const snap = client.getRenderSnapshot();
    ctx.clearRect(0, 0, SIM.WIDTH, SIM.HEIGHT);
    simRender.drawRoads(ctx, snap && snap.settings);

    if (pendingEmergencyType) simRender.drawLaneHighlights(ctx, pendingEmergencyType);

    if (snap) {
        simRender.drawLights(ctx, snap.lights, snap.msUntilChange, snap.currentGreen);
        for (const car of snap.cars) simRender.drawCar(ctx, car);
    }
    simRender.drawWeather(ctx, snap && snap.settings);

    if (pendingEmergencyType) {
        ctx.save();
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 28px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.shadowColor = 'rgba(0,0,0,0.8)';
        ctx.shadowBlur = 8;
        ctx.fillText('Lütfen aracın geleceği şeride tıklayın', SIM.WIDTH / 2, SIM.HEIGHT / 2);
        ctx.restore();
    }

    frameCount++;
    const now = Date.now();
    if (now - lastFpsTime >= 1000) {
        fps = frameCount;
        frameCount = 0;
        lastFpsTime = now;
        $('fps').textContent = fps;
    }
    requestAnimationFrame(render);
}
render();

// ==================== KONTROLLER ====================

function bindRange(id, valueId, suffix, send) {
    const el = $(id);
    const throttledSend = throttleLatest(send, 140);
    el.addEventListener('input', () => {
        $(valueId).textContent = el.value + suffix;
        throttledSend(el.value);
    });
}

function throttleLatest(fn, wait) {
    let timer = null;
    let latestValue = null;
    return (value) => {
        latestValue = value;
        if (timer) return;
        timer = setTimeout(() => {
            timer = null;
            fn(latestValue);
        }, wait);
    };
}

function bindSelect(id, valueId, labels, key) {
    const el = $(id);
    if (!el) return;
    el.addEventListener('change', () => {
        $(valueId).textContent = labels[el.value] || el.value;
        client.send({ type: 'setting', key, value: el.value });
    });
}

bindRange('traffic-density', 'density-value', '%', (v) => client.send({ type: 'setting', key: 'trafficDensity', value: v / 100 }));
bindRange('light-duration', 'duration-value', 's', (v) => client.send({ type: 'setting', key: 'lightDuration', value: v * 1000 }));
bindRange('car-speed', 'speed-value', 'x', (v) => client.send({ type: 'setting', key: 'carSpeedMultiplier', value: parseFloat(v) }));
bindRange('car-acceleration', 'acceleration-value', '', (v) => client.send({ type: 'setting', key: 'acceleration', value: parseFloat(v) }));
bindRange('collision-distance', 'collision-value', 'px', (v) => client.send({ type: 'setting', key: 'collisionDistance', value: parseInt(v) }));
bindSelect('weather-mode', 'weather-value', WEATHER_LABELS, 'weather');
bindSelect('time-of-day', 'time-value', TIME_LABELS, 'timeOfDay');

$('adaptive-lights').addEventListener('change', () => {
    const enabled = $('adaptive-lights').checked;
    $('adaptive-value').textContent = enabled ? 'Açık' : 'Kapalı';
    client.send({ type: 'setting', key: 'adaptiveLights', value: enabled ? 1 : 0 });
});

$('pause-btn').addEventListener('click', () => client.send({ type: 'togglePause' }));
$('reset-btn').addEventListener('click', () => client.send({ type: 'reset' }));

document.querySelectorAll('button[data-emergency]').forEach(btn => {
    btn.addEventListener('click', () => {
        pendingEmergencyType = btn.dataset.emergency;
        canvas.style.cursor = 'crosshair';
    });
});

canvas.addEventListener('mousedown', (e) => {
    if (!pendingEmergencyType) return;
    const pick = simRender.pickLaneFromClick(canvas, e.clientX, e.clientY);
    if (pick) {
        client.send({ type: 'spawnEmergency', dir: pick.dir, lane: pick.lane, vehicleType: pendingEmergencyType });
        pendingEmergencyType = null;
        canvas.style.cursor = 'default';
    }
});
