// İzleme arayüzü — render + ışık geri sayımları + acil araç paneli + müdahale.

const canvas = document.getElementById('trafficCanvas');
const ctx = canvas.getContext('2d', { alpha: false });
const client = new SimClient('monitor');

const $ = (id) => document.getElementById(id);

const DIR_NAMES = ['Alt', 'Sağ', 'Üst', 'Sol'];
const VEHICLE_NAMES = { ambulance: 'Ambulans', firetruck: 'İtfaiye', police: 'Polis' };
const STATE_NAMES = { 0: 'Kırmızı', 1: 'Sarı', 2: 'Yeşil' };
const STATE_CLASS = { 0: 'red', 1: 'yellow', 2: 'green' };

let pendingEmergencyType = null;
let frameCount = 0;
let lastFpsTime = Date.now();
let lastRenderTime = 0;
let fps = 0;
const TARGET_FRAME_MS = 0;

function buildLightsPanel() {
    const grid = $('lights-grid');
    grid.innerHTML = '';
    for (let i = 0; i < 4; i++) {
        const card = document.createElement('div');
        card.className = 'light-card';
        card.id = `light-card-${i}`;
        card.innerHTML = `
            <div class="light-dir">${DIR_NAMES[i]}</div>
            <div class="light-state" id="light-state-${i}">--</div>
            <div class="light-queue" id="light-queue-${i}">Bekleyen: 0</div>
            <div class="light-timer" id="light-timer-${i}">--</div>
        `;
        grid.appendChild(card);
    }
}
buildLightsPanel();

function setConn(connected) {
    $('conn-pill').className = 'conn-pill ' + (connected ? 'connected' : 'disconnected');
}
client.on('open', () => setConn(true));
client.on('close', () => setConn(false));

client.on('state', (snap) => {
    $('car-count').textContent = snap.cars.length;
    $('tick').textContent = client.getLatencyText();
    $('paused-state').textContent = snap.paused ? 'DURAKLATILDI' : (snap.emergency.active ? 'ACİL' : 'AKTİF');

    const btn = $('pause-btn');
    if (snap.paused) { btn.textContent = 'Devam Et'; btn.classList.add('paused'); btn.classList.remove('primary'); }
    else { btn.textContent = 'Duraklat'; btn.classList.add('primary'); btn.classList.remove('paused'); }

    for (let i = 0; i < 4; i++) {
        const state = snap.lights[i];
        const card = $(`light-card-${i}`);
        const stateEl = $(`light-state-${i}`);
        const queueEl = $(`light-queue-${i}`);
        const timerEl = $(`light-timer-${i}`);
        const demand = snap.trafficDemand || { queues: [0, 0, 0, 0], scores: [0, 0, 0, 0] };
        card.className = `light-card state-${STATE_CLASS[state]}`;
        if (snap.emergency.active && i === snap.emergency.direction) card.classList.add('emergency');
        if (snap.currentGreen === i) card.classList.add('current');
        stateEl.textContent = STATE_NAMES[state];
        queueEl.textContent = snap.settings.adaptiveLights
            ? `Bekleyen: ${demand.queues[i] || 0}`
            : 'Zamanlı mod';

        if (i === snap.currentGreen && snap.msUntilChange !== null) {
            const suffix = snap.settings.adaptiveLights ? 'sonra karar' : 'sonra değişecek';
            timerEl.textContent = `${(snap.msUntilChange / 1000).toFixed(1)} sn ${suffix}`;
        } else if (snap.emergency.active && i === snap.emergency.direction) {
            timerEl.textContent = 'Acil araç geçene kadar';
        } else {
            timerEl.textContent = '—';
        }
    }

    const ep = $('emergency-panel');
    const emergencyCars = snap.cars.filter(c => c.t !== 'normal');
    if (snap.emergency.active && emergencyCars.length > 0) {
        ep.className = 'emergency-panel active';
        $('emergency-title-text').textContent = `Acil durum · ${emergencyCars.length} araç`;
        const blocks = emergencyCars.map(c => {
            const lines = [
                `<b>#${c.id} ${VEHICLE_NAMES[c.t] || c.t}</b>`,
                `Yön: ${DIR_NAMES[c.d]} · Şerit: ${['Sol','Düz','Sağ'][c.l]}`,
                `Hız: ${c.s.toFixed(2)} · Konum: (${Math.round(c.x)}, ${Math.round(c.y)})`,
            ];
            if (c.dToE !== undefined) {
                lines.push(`Kavşak: ${c.dToE > 0 ? Math.round(c.dToE) + ' px' : 'içinde'} · İlerleme: ${((c.progress || 0) * 100).toFixed(0)}%`);
            }
            return lines.join('<br>');
        });
        $('emergency-details').innerHTML = blocks.join('<br><br>');
    } else {
        ep.className = 'emergency-panel idle';
        $('emergency-title-text').textContent = 'Sakin';
        $('emergency-details').textContent = 'Acil durum yok.';
    }

    document.querySelectorAll('button[data-override]').forEach(b => {
        b.disabled = snap.emergency.active;
    });
});

client.on('event', (evt) => {
    if (evt.event === 'reset') pendingEmergencyType = null;
});

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

$('pause-btn').addEventListener('click', () => client.send({ type: 'togglePause' }));
$('reset-btn').addEventListener('click', () => client.send({ type: 'reset' }));

document.querySelectorAll('button[data-override]').forEach(btn => {
    btn.addEventListener('click', () => {
        const dir = parseInt(btn.dataset.override, 10);
        client.send({ type: 'overrideLight', dir, state: SIM.GREEN });
    });
});

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
