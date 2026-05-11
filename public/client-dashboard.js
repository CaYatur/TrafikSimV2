// Kokpit — N adet acil aracı yan yana gösterir.

const client = new SimClient('dashboard');
const $ = (id) => document.getElementById(id);

const DIR_NAMES = { 0: 'Kuzey', 1: 'Batı', 2: 'Güney', 3: 'Doğu' };
const VEHICLE_LABEL = {
    ambulance: 'Ambulans',
    firetruck: 'İtfaiye',
    police:    'Polis',
};
const LANE_NAMES = ['Sol', 'Düz', 'Sağ'];
const SPEED_TO_KMH = 30;

// Saat
function tickClock() {
    const now = new Date();
    $('dash-clock').textContent =
        String(now.getHours()).padStart(2, '0') + ':' +
        String(now.getMinutes()).padStart(2, '0') + ':' +
        String(now.getSeconds()).padStart(2, '0');
    requestAnimationFrame(tickClock);
}
tickClock();

function setConn(connected) {
    $('conn-pill').className = 'conn-pill ' + (connected ? 'connected' : 'disconnected');
}
client.on('open', () => setConn(true));
client.on('close', () => setConn(false));

// ==================== KART YÖNETIMI ====================

const cards = new Map(); // carId -> { el, gaugeCanvas, displaySpeed, targetSpeed }

function makeCard(car) {
    const el = document.createElement('div');
    el.className = 'v-card ' + car.t;
    el.dataset.carId = car.id;
    el.innerHTML = `
        <div class="v-card-header">
            <div class="v-title"><span class="v-dot"></span><span class="v-type">${VEHICLE_LABEL[car.t] || car.t}</span></div>
            <div class="v-id">#${car.id}</div>
        </div>
        <div class="v-card-body">
            <div class="v-gauge-wrap">
                <canvas class="v-gauge" width="320" height="180"></canvas>
                <div class="v-gauge-meta">
                    <span><b class="v-kmh">0</b> km/sa</span>
                    <span>·</span>
                    <span><b class="v-raw">0.00</b> px/tick</span>
                </div>
            </div>
            <div class="v-light">
                <div class="v-light-stack">
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
    return {
        el,
        gaugeCanvas: el.querySelector('.v-gauge'),
        displaySpeed: 0,
        targetSpeed: 0,
        type: car.t,
    };
}

function removeCard(carId) {
    const c = cards.get(carId);
    if (!c) return;
    c.el.remove();
    cards.delete(carId);
}

// ==================== GAUGE ====================

function drawGauge(canvas, speedPxTick, maxPxTick) {
    const g = canvas.getContext('2d');
    const W = canvas.width;
    const H = canvas.height;
    const cx = W / 2;
    const cy = H * 0.92;
    const radius = Math.min(W * 0.42, H * 0.85);

    g.clearRect(0, 0, W, H);

    const startAngle = Math.PI * 1.15;
    const endAngle = Math.PI * 1.85;

    // Arka yay (zayıf)
    g.strokeStyle = 'rgba(255, 255, 255, 0.06)';
    g.lineWidth = 6;
    g.lineCap = 'round';
    g.beginPath();
    g.arc(cx, cy, radius, startAngle, endAngle);
    g.stroke();

    // Doluluk yayı
    const ratio = Math.max(0, Math.min(1, speedPxTick / maxPxTick));
    const speedAngle = startAngle + (endAngle - startAngle) * ratio;
    g.strokeStyle = ratio > 0.85 ? '#e5484d' : (ratio > 0.6 ? '#e5a93a' : '#e8e9ec');
    g.lineWidth = 6;
    g.beginPath();
    g.arc(cx, cy, radius, startAngle, speedAngle);
    g.stroke();
    g.lineCap = 'butt';

    // Tick'ler — yalnızca min, %50, max
    g.strokeStyle = 'rgba(255,255,255,0.12)';
    g.lineWidth = 1;
    [0, 0.5, 1].forEach(t => {
        const a = startAngle + (endAngle - startAngle) * t;
        const r1 = radius - 12;
        const r2 = radius + 4;
        g.beginPath();
        g.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
        g.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2);
        g.stroke();
    });

    // Sayı (büyük)
    g.fillStyle = '#e8e9ec';
    g.font = '600 36px Inter, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(Math.round(speedPxTick * SPEED_TO_KMH), cx, cy - 30);
    g.fillStyle = '#6b6f78';
    g.font = '500 11px Inter, sans-serif';
    g.fillText('KM/SA', cx, cy - 6);
}

// ==================== STATE → UI ====================

client.on('state', (snap) => {
    const emergencyCars = snap.emergency.active
        ? snap.cars.filter(c => c.t !== 'normal')
        : [];

    if (emergencyCars.length === 0) {
        $('dash-standby').style.display = 'flex';
        $('dash-active').style.display = 'none';
        // Mevcut kartları temizle
        for (const id of Array.from(cards.keys())) removeCard(id);
        return;
    }

    $('dash-standby').style.display = 'none';
    $('dash-active').style.display = 'flex';
    $('banner-count-num').textContent = emergencyCars.length;

    const grid = $('vehicle-grid');
    const presentIds = new Set();

    for (const car of emergencyCars) {
        presentIds.add(car.id);
        let entry = cards.get(car.id);
        if (!entry) {
            entry = makeCard(car);
            cards.set(car.id, entry);
            grid.appendChild(entry.el);
        }
        updateCard(entry, car, snap);
    }

    // Sahnede olmayan kartları sil
    for (const id of Array.from(cards.keys())) {
        if (!presentIds.has(id)) removeCard(id);
    }
});

function updateCard(entry, car, snap) {
    entry.targetSpeed = car.s;
    const el = entry.el;

    const kmh = Math.round(car.s * SPEED_TO_KMH);
    el.querySelector('.v-kmh').textContent = kmh;
    el.querySelector('.v-raw').textContent = car.s.toFixed(2);

    // Işık (aracın yönündeki)
    const myLight = snap.lights[car.d];
    el.querySelector('.v-bulb-red').className    = 'bulb v-bulb-red'    + (myLight === 0 ? ' on red'    : '');
    el.querySelector('.v-bulb-yellow').className = 'bulb v-bulb-yellow' + (myLight === 1 ? ' on yellow' : '');
    el.querySelector('.v-bulb-green').className  = 'bulb v-bulb-green'  + (myLight === 2 ? ' on green'  : '');

    // Mesafe
    const distEl = el.querySelector('.v-dist-val');
    if (car.dToE !== undefined) {
        if (car.dToE > 0) {
            distEl.textContent = Math.round(car.dToE) + ' px';
            distEl.style.color = '';
        } else {
            distEl.textContent = 'kavşakta';
            distEl.style.color = 'var(--yellow)';
        }
    }

    // Footer
    el.querySelector('.v-direction').textContent = DIR_NAMES[car.d] || '—';
    el.querySelector('.v-lane').textContent = LANE_NAMES[car.l] || '—';
    el.querySelector('.v-position').textContent = `${Math.round(car.x)}, ${Math.round(car.y)}`;
    const progress = car.progress !== undefined ? car.progress : 0;
    el.querySelector('.v-progress-pct').textContent = (progress * 100).toFixed(0) + '%';
    el.querySelector('.v-progress-fill').style.width = (progress * 100) + '%';
}

// Yumuşak ibre — her frame'de displaySpeed → targetSpeed
function animateGauges() {
    const snap = client.snapshot;
    const maxSpeed = snap ? 4 * (snap.settings.carSpeedMultiplier || 1) : 4;
    for (const entry of cards.values()) {
        entry.displaySpeed += (entry.targetSpeed - entry.displaySpeed) * 0.18;
        drawGauge(entry.gaugeCanvas, entry.displaySpeed, maxSpeed);
    }
    requestAnimationFrame(animateGauges);
}
animateGauges();
