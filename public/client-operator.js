// Operatör — 3 fazlı: select → place → cockpit → (araç bittiğinde) select.

const client = new SimClient('operator');
const $ = (id) => document.getElementById(id);

const DIR_NAMES = { 0: 'Kuzey', 1: 'Batı', 2: 'Güney', 3: 'Doğu' };
const VEHICLE_LABEL = { ambulance: 'Ambulans', firetruck: 'İtfaiye', police: 'Polis' };
const LANE_NAMES = ['Sol', 'Düz', 'Sağ'];
const SPEED_TO_KMH = 30;

let phase = 'select';        // 'select' | 'place' | 'cockpit'
let chosenType = null;
let myCarId = null;
let mySeenAtLeastOnce = false;
let pendingRequestId = null;
let lastPlaceRenderTime = 0;
const TARGET_FRAME_MS = 0;

const opMapCanvas = $('opMapCanvas');
const opMapCtx = opMapCanvas.getContext('2d', { alpha: false });

function setConn(connected) {
    $('conn-pill').className = 'conn-pill ' + (connected ? 'connected' : 'disconnected');
}
client.on('open', () => setConn(true));
client.on('close', () => setConn(false));

// ==================== FAZ YÖNETİMİ ====================

function setPhase(p) {
    phase = p;
    $('phase-select').style.display   = p === 'select'  ? 'flex' : 'none';
    $('phase-place').style.display    = p === 'place'   ? 'flex' : 'none';
    $('phase-cockpit').style.display  = p === 'cockpit' ? 'flex' : 'none';
    const labels = { select: 'Araç seçimi', place: 'Konum seçimi', cockpit: 'Görev aktif' };
    $('op-phase-label').textContent = labels[p] || '';
}

function resetToSelect() {
    chosenType = null;
    myCarId = null;
    mySeenAtLeastOnce = false;
    pendingRequestId = null;
    setPhase('select');
}

// FAZ 1 — Araç seçim butonları
document.querySelectorAll('.op-vehicle-card').forEach(btn => {
    btn.addEventListener('click', () => {
        chosenType = btn.dataset.type;
        $('place-title').textContent = `${VEHICLE_LABEL[chosenType]} için başlangıç şeridini seçin`;
        setPhase('place');
    });
});

// FAZ 2 — Vazgeç
$('place-cancel').addEventListener('click', () => resetToSelect());

// FAZ 2 — Haritaya tıklama
opMapCanvas.addEventListener('mousedown', handlePlaceClick);
opMapCanvas.addEventListener('touchstart', (e) => {
    if (e.touches.length === 0) return;
    const t = e.touches[0];
    handlePlaceClick({ clientX: t.clientX, clientY: t.clientY });
    e.preventDefault();
}, { passive: false });

function handlePlaceClick(e) {
    if (phase !== 'place' || !chosenType) return;
    const pick = simRender.pickLaneFromClick(opMapCanvas, e.clientX, e.clientY);
    if (!pick) return;
    pendingRequestId = 'op-' + Date.now();
    client.send({
        type: 'spawnEmergency',
        dir: pick.dir, lane: pick.lane,
        vehicleType: chosenType,
        requestId: pendingRequestId,
    });
}

// Server'dan ack — kendi aracımızın id'sini öğreniyoruz
client.on('spawnAck', (msg) => {
    if (msg.requestId !== pendingRequestId) return;
    if (!msg.ok) {
        pendingRequestId = null;
        return;
    }
    myCarId = msg.carId;
    mySeenAtLeastOnce = false;
    setPhase('cockpit');
    buildCockpit();
});

// ==================== FAZ 2 RENDER ====================

function renderPlaceMap(now = performance.now()) {
    if (phase !== 'place') return requestAnimationFrame(renderPlaceMap);
    if (now - lastPlaceRenderTime < TARGET_FRAME_MS) {
        requestAnimationFrame(renderPlaceMap);
        return;
    }
    lastPlaceRenderTime = now;

    const snap = client.getRenderSnapshot();
    opMapCtx.clearRect(0, 0, SIM.WIDTH, SIM.HEIGHT);
    simRender.drawRoads(opMapCtx, snap && snap.settings);
    simRender.drawLaneHighlights(opMapCtx, chosenType);
    if (snap) {
        simRender.drawLights(opMapCtx, snap.lights, snap.msUntilChange, snap.currentGreen);
        for (const car of snap.cars) simRender.drawCar(opMapCtx, car);
    }
    simRender.drawWeather(opMapCtx, snap && snap.settings);
    requestAnimationFrame(renderPlaceMap);
}
renderPlaceMap();

// ==================== FAZ 3 — KOKPIT ====================

let cockpit = null; // { gauge, displaySpeed, targetSpeed }

function buildCockpit() {
    const root = $('op-vcard');
    root.className = 'v-card op-card-large ' + (chosenType || '');
    root.innerHTML = `
        <div class="v-card-header">
            <div class="v-title"><span class="v-dot"></span><span>${VEHICLE_LABEL[chosenType] || ''}</span></div>
            <div class="v-id">#${myCarId ?? '—'}</div>
        </div>
        <div class="v-card-body">
            <div class="v-gauge-wrap">
                <canvas class="v-gauge" width="520" height="300"></canvas>
                <div class="v-gauge-meta">
                    <span><b class="v-kmh">0</b> km/sa</span><span>·</span>
                    <span><b class="v-raw">0.00</b> px/tick</span>
                </div>
            </div>
            <div class="v-light">
                <div class="v-light-stack op-stack-large">
                    <div class="bulb v-bulb-red"></div>
                    <div class="bulb v-bulb-yellow"></div>
                    <div class="bulb v-bulb-green"></div>
                </div>
                <div class="v-dist">
                    <div class="lbl">Kavşağa</div>
                    <div class="val v-dist-val">—</div>
                </div>
            </div>
        </div>
        <div class="v-card-footer">
            <div class="v-stat"><div class="lbl">Yön</div><div class="val v-direction">—</div></div>
            <div class="v-stat"><div class="lbl">Şerit</div><div class="val v-lane">—</div></div>
            <div class="v-stat"><div class="lbl">Konum</div><div class="val v-position">—</div></div>
            <div class="v-stat"><div class="lbl">İlerleme</div><div class="val v-progress-pct">0%</div></div>
            <div class="progress-track"><div class="progress-fill v-progress-fill" style="width:0%"></div></div>
        </div>
    `;
    cockpit = {
        canvas: root.querySelector('.v-gauge'),
        displaySpeed: 0,
        targetSpeed: 0,
        root,
    };
}

function updateCockpit(car, snap) {
    if (!cockpit) return;
    cockpit.targetSpeed = car.s;
    const root = cockpit.root;
    root.querySelector('.v-kmh').textContent = Math.round(car.s * SPEED_TO_KMH);
    root.querySelector('.v-raw').textContent = car.s.toFixed(2);

    const myLight = snap.lights[car.d];
    root.querySelector('.v-bulb-red').className    = 'bulb v-bulb-red'    + (myLight === 0 ? ' on red'    : '');
    root.querySelector('.v-bulb-yellow').className = 'bulb v-bulb-yellow' + (myLight === 1 ? ' on yellow' : '');
    root.querySelector('.v-bulb-green').className  = 'bulb v-bulb-green'  + (myLight === 2 ? ' on green'  : '');

    const distEl = root.querySelector('.v-dist-val');
    if (car.dToE !== undefined) {
        if (car.dToE > 0) { distEl.textContent = Math.round(car.dToE) + ' px'; distEl.style.color = ''; }
        else { distEl.textContent = 'kavşakta'; distEl.style.color = 'var(--yellow)'; }
    }
    root.querySelector('.v-direction').textContent = DIR_NAMES[car.d] || '—';
    root.querySelector('.v-lane').textContent = LANE_NAMES[car.l] || '—';
    root.querySelector('.v-position').textContent = `${Math.round(car.x)}, ${Math.round(car.y)}`;
    const progress = car.progress !== undefined ? car.progress : 0;
    root.querySelector('.v-progress-pct').textContent = (progress * 100).toFixed(0) + '%';
    root.querySelector('.v-progress-fill').style.width = (progress * 100) + '%';
}

function drawGauge(canvas, speedPxTick, maxPxTick) {
    const g = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    const cx = W / 2, cy = H * 0.92;
    const radius = Math.min(W * 0.42, H * 0.85);
    g.clearRect(0, 0, W, H);
    const startAngle = Math.PI * 1.15, endAngle = Math.PI * 1.85;

    g.strokeStyle = 'rgba(255,255,255,0.06)';
    g.lineWidth = 8; g.lineCap = 'round';
    g.beginPath(); g.arc(cx, cy, radius, startAngle, endAngle); g.stroke();

    const ratio = Math.max(0, Math.min(1, speedPxTick / maxPxTick));
    const speedAngle = startAngle + (endAngle - startAngle) * ratio;
    g.strokeStyle = ratio > 0.85 ? '#e5484d' : (ratio > 0.6 ? '#e5a93a' : '#e8e9ec');
    g.lineWidth = 8;
    g.beginPath(); g.arc(cx, cy, radius, startAngle, speedAngle); g.stroke();
    g.lineCap = 'butt';

    g.strokeStyle = 'rgba(255,255,255,0.12)';
    g.lineWidth = 1;
    [0, 0.5, 1].forEach(t => {
        const a = startAngle + (endAngle - startAngle) * t;
        const r1 = radius - 14, r2 = radius + 6;
        g.beginPath();
        g.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
        g.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2);
        g.stroke();
    });

    g.fillStyle = '#e8e9ec';
    g.font = '600 64px Inter, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(Math.round(speedPxTick * SPEED_TO_KMH), cx, cy - 50);
    g.fillStyle = '#6b6f78';
    g.font = '500 14px Inter, sans-serif';
    g.fillText('KM/SA', cx, cy - 14);
}

// ==================== STATE TAKİBİ ====================

client.on('state', (snap) => {
    if (phase !== 'cockpit' || myCarId === null) return;
    const me = snap.cars.find(c => c.id === myCarId);
    if (me) {
        mySeenAtLeastOnce = true;
        updateCockpit(me, snap);
    } else if (mySeenAtLeastOnce) {
        // Aracım sahneden çıktı → araç seçimine dön
        resetToSelect();
    }
});

function animateGauge() {
    if (cockpit && phase === 'cockpit') {
        const snap = client.snapshot;
        const maxSpeed = snap ? 4 * (snap.settings.carSpeedMultiplier || 1) : 4;
        cockpit.displaySpeed += (cockpit.targetSpeed - cockpit.displaySpeed) * 0.18;
        drawGauge(cockpit.canvas, cockpit.displaySpeed, maxSpeed);
    }
    requestAnimationFrame(animateGauge);
}
animateGauge();
