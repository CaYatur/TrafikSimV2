// Ortak istemci kodu: WebSocket bağlantısı, render (yol/ışık/araç), siren.
// Hem kontrol hem izleme arayüzü tarafından kullanılır.

const SIM = {
    WIDTH: 1000,
    HEIGHT: 1000,
    LANE_WIDTH: 30,
    LANE_COUNT: 3,
    ARM_WIDTH: 30 * 3,
    CX: 500,
    CY: 500,
    CAR_WIDTH: 22,
    CAR_LENGTH: 44,
    RED: 0,
    YELLOW: 1,
    GREEN: 2,
};

// ==================== SIREN ====================

const SIREN_PROFILES = {
    ambulance: { minFreq: 700, maxFreq: 1100, sweepDuration: 0.9, volume: 0.18 },
    firetruck: { minFreq: 450, maxFreq: 800, sweepDuration: 1.2, volume: 0.16 },
    police:    { minFreq: 550, maxFreq: 950, sweepDuration: 0.5, volume: 0.14 },
    default:   { minFreq: 600, maxFreq: 900, sweepDuration: 1.0, volume: 0.15 },
};

class SirenInstance {
    constructor(context, profile) {
        this.context = context;
        this.profile = profile;
        this.oscillator = null;
        this.gainNode = null;
        this.sweepTimeout = null;
        this.targetVolume = profile.volume;
        this.muted = false;
    }
    start(muted = false) {
        if (!this.context) return;
        this.oscillator = this.context.createOscillator();
        this.oscillator.type = 'triangle';
        this.gainNode = this.context.createGain();
        this.gainNode.gain.value = 0;
        this.oscillator.connect(this.gainNode);
        this.gainNode.connect(this.context.destination);
        this.oscillator.start();
        this.setMuted(muted, true);
        this.scheduleSweep();
    }
    scheduleSweep() {
        if (!this.oscillator || !this.context) return;
        const { minFreq, maxFreq, sweepDuration } = this.profile;
        const now = this.context.currentTime;
        this.oscillator.frequency.cancelScheduledValues(now);
        this.oscillator.frequency.setValueAtTime(minFreq, now);
        this.oscillator.frequency.linearRampToValueAtTime(maxFreq, now + sweepDuration / 2);
        this.oscillator.frequency.linearRampToValueAtTime(minFreq, now + sweepDuration);
        if (this.sweepTimeout) clearTimeout(this.sweepTimeout);
        this.sweepTimeout = setTimeout(() => this.scheduleSweep(), sweepDuration * 1000);
    }
    setMuted(mute, immediate = false) {
        this.muted = mute;
        if (!this.gainNode || !this.context) return;
        const now = this.context.currentTime;
        const target = mute ? 0 : this.targetVolume;
        this.gainNode.gain.cancelScheduledValues(now);
        const ramp = immediate ? 0.05 : 0.2;
        this.gainNode.gain.linearRampToValueAtTime(target, now + ramp);
    }
    stop() {
        if (this.sweepTimeout) { clearTimeout(this.sweepTimeout); this.sweepTimeout = null; }
        if (this.gainNode && this.context) {
            const now = this.context.currentTime;
            this.gainNode.gain.cancelScheduledValues(now);
            this.gainNode.gain.linearRampToValueAtTime(0, now + 0.2);
        }
        if (this.oscillator) {
            const osc = this.oscillator;
            setTimeout(() => { try { osc.stop(); } catch (_) {} osc.disconnect(); }, 250);
        }
        if (this.gainNode) this.gainNode.disconnect();
        this.oscillator = null;
        this.gainNode = null;
    }
}

const sirenController = {
    context: null,
    sirens: new Map(),
    init() {
        if (this.context) return true;
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return false;
        this.context = new AudioCtx();
        return true;
    },
    start(carId, type, muted = false) {
        if (!this.init()) return;
        const profile = SIREN_PROFILES[type] || SIREN_PROFILES.default;
        const existing = this.sirens.get(carId);
        if (existing) existing.stop();
        if (this.context.state === 'suspended') this.context.resume();
        const siren = new SirenInstance(this.context, profile);
        siren.start(muted);
        this.sirens.set(carId, siren);
    },
    stop(carId) {
        const siren = this.sirens.get(carId);
        if (!siren) return;
        siren.stop();
        this.sirens.delete(carId);
    },
    stopAll() { this.sirens.forEach(s => s.stop()); this.sirens.clear(); },
    setPaused(paused) { this.sirens.forEach(s => s.setMuted(paused)); },
};

// ==================== WEATHER SOUNDS ====================

const weatherSoundController = {
    context: null,       // sirenController ile paylaşılan tek AudioContext
    sourceNode: null,
    gainNode: null,
    filterNode: null,
    currentWeather: null,
    _desiredWeather: 'clear',
    _desiredPaused: false,

    _createNoiseBuffer() {
        const ctx = this.context;
        const bufLen = ctx.sampleRate * 4;
        const buffer = ctx.createBuffer(1, bufLen, ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufLen; i++) data[i] = Math.random() * 2 - 1;
        return buffer;
    },

    _startSound(weather) {
        if (!this.context || this.context.state !== 'running') return;
        this._stopImmediate();

        const source = this.context.createBufferSource();
        source.buffer = this._createNoiseBuffer();
        source.loop = true;

        const filter = this.context.createBiquadFilter();
        const gain = this.context.createGain();
        gain.gain.value = 0;

        if (weather === 'rain') {
            filter.type = 'bandpass';
            filter.frequency.value = 1400;
            filter.Q.value = 0.5;
            gain.gain.setTargetAtTime(0.03, this.context.currentTime, 0.8);
        } else if (weather === 'snow') {
            filter.type = 'lowpass';
            filter.frequency.value = 360;
            filter.Q.value = 0.7;
            gain.gain.setTargetAtTime(0.04, this.context.currentTime, 1.5);
        }

        source.connect(filter);
        filter.connect(gain);
        gain.connect(this.context.destination);
        source.start();

        this.sourceNode = source;
        this.filterNode = filter;
        this.gainNode = gain;
    },

    _stopImmediate() {
        if (this.sourceNode) {
            const src = this.sourceNode;
            try { src.stop(); } catch (_) {}
            src.disconnect();
            this.sourceNode = null;
        }
        if (this.gainNode)   { this.gainNode.disconnect();   this.gainNode   = null; }
        if (this.filterNode) { this.filterNode.disconnect(); this.filterNode = null; }
    },

    _stopGraceful() {
        if (!this.gainNode || !this.context) { this._stopImmediate(); return; }
        const now = this.context.currentTime;
        this.gainNode.gain.cancelScheduledValues(now);
        this.gainNode.gain.setTargetAtTime(0, now, 0.6);
        const src = this.sourceNode, gain = this.gainNode, filter = this.filterNode;
        this.sourceNode = null; this.gainNode = null; this.filterNode = null;
        setTimeout(() => {
            try { src.stop(); } catch (_) {}
            try { src.disconnect(); } catch (_) {}
            try { gain.disconnect(); } catch (_) {}
            try { filter.disconnect(); } catch (_) {}
        }, 1200);
    },

    // Sadece istenen durumu kaydet; sesi _applyDesired ile başlat
    setWeather(weather, paused = false) {
        this._desiredWeather = weather;
        this._desiredPaused = paused;
        // context yoksa (henüz kullanıcı etkileşimi olmadı) sadece kaydet, bekle
        if (!this.context || this.context.state !== 'running') return;
        this._applyDesired();
    },

    // Context 'running' olduğunda çağrılır
    _applyDesired() {
        const weather = this._desiredWeather || 'clear';
        const paused  = this._desiredPaused;
        if (weather === this.currentWeather && this.sourceNode) {
            this.setPaused(paused);
            return;
        }
        this.currentWeather = weather;
        if (weather === 'rain' || weather === 'snow') {
            this._startSound(weather);
            if (paused) this.setPaused(true);
        } else {
            this._stopGraceful();
        }
    },

    setPaused(paused) {
        if (!this.gainNode || !this.context) return;
        const now = this.context.currentTime;
        this.gainNode.gain.cancelScheduledValues(now);
        if (paused) {
            this.gainNode.gain.setTargetAtTime(0, now, 0.3);
        } else {
            const target = this.currentWeather === 'rain' ? 0.03 : 0.04;
            this.gainNode.gain.setTargetAtTime(target, now, 0.5);
        }
    },
};

// İlk kullanıcı etkileşiminde sesi aç (tarayıcı otomatik çalma politikası)
// Tek bir AudioContext oluşturulur; siren ve hava durumu sesi bunu paylaşır.
function unlockAudio() {
    // sirenController her zaman context oluşturur
    sirenController.init();
    // weatherSoundController aynı context'i kullanır — asla ayrı context açmaz
    weatherSoundController.context = sirenController.context;

    const ctx = sirenController.context;
    if (!ctx) return;

    const apply = () => weatherSoundController._applyDesired();

    if (ctx.state === 'suspended') {
        ctx.resume().then(apply).catch(() => {});
    } else {
        apply();
    }
}
['click', 'keydown', 'touchstart'].forEach(ev =>
    window.addEventListener(ev, unlockAudio, { once: true })
);

// ==================== RENDER ====================

let cachedRoadLayer = null;
let cachedTreeLayer = null;

const TIME_PROFILES = {
    morning: { grass: '#55b85b', tint: 'rgba(255, 196, 106, 0.10)', darkness: 0.02 },
    noon:    { grass: '#4fb65a', tint: 'rgba(255, 240, 190, 0.04)', darkness: 0.00 },
    day:     { grass: '#49ad50', tint: 'rgba(255, 255, 255, 0.00)', darkness: 0.00 },
    evening: { grass: '#3f9450', tint: 'rgba(255, 132, 74, 0.18)', darkness: 0.16 },
    night:   { grass: '#244e37', tint: 'rgba(72, 111, 180, 0.10)', darkness: 0.48 },
};

const TREE_DATA = Array.from({ length: 92 }, (_, i) => {
    let seed = (i + 1) * 9301 + 49297;
    function rand() {
        seed = (seed * 233 + 17) % 9973;
        return seed / 9973;
    }

    let x = rand() * SIM.WIDTH;
    let y = rand() * SIM.HEIGHT;
    const onVerticalRoad = x > SIM.CX - SIM.ARM_WIDTH - 35 && x < SIM.CX + SIM.ARM_WIDTH + 35;
    const onHorizontalRoad = y > SIM.CY - SIM.ARM_WIDTH - 35 && y < SIM.CY + SIM.ARM_WIDTH + 35;
    if (onVerticalRoad || onHorizontalRoad) {
        if (Math.abs(x - SIM.CX) < Math.abs(y - SIM.CY)) x = rand() < 0.5 ? 50 + rand() * 240 : 710 + rand() * 240;
        else y = rand() < 0.5 ? 45 + rand() * 250 : 705 + rand() * 250;
    }

    return {
        x,
        y,
        r: 9 + rand() * 13,
        trunk: 5 + rand() * 4,
        hue: 95 + rand() * 30,
    };
});

const WEATHER_PARTICLES = Array.from({ length: 220 }, (_, i) => {
    let seed = (i + 3) * 7919;
    function rand() {
        seed = (seed * 48271) % 2147483647;
        return seed / 2147483647;
    }
    return {
        x: rand() * SIM.WIDTH,
        y: rand() * SIM.HEIGHT,
        speed: 0.5 + rand() * 1.2,
        size: 1 + rand() * 2.0,
        drift: -0.5 + rand(),
        opacity: 0.35 + rand() * 0.45,
        len: 22 + rand() * 22,
    };
});

// Sabit birikinti konumları (yol olmayan alanlarda)
const PUDDLE_DATA = Array.from({ length: 28 }, (_, i) => {
    let seed = (i + 77) * 13337;
    function rand() {
        seed = (seed * 1664525 + 1013904223) & 0x7fffffff;
        return seed / 0x7fffffff;
    }
    // Yol merkezinden uzak konumlar için tekrar dene
    let x, y;
    for (let attempt = 0; attempt < 20; attempt++) {
        x = 30 + rand() * (SIM.WIDTH - 60);
        y = 30 + rand() * (SIM.HEIGHT - 60);
        const onV = x > SIM.CX - SIM.ARM_WIDTH - 20 && x < SIM.CX + SIM.ARM_WIDTH + 20;
        const onH = y > SIM.CY - SIM.ARM_WIDTH - 20 && y < SIM.CY + SIM.ARM_WIDTH + 20;
        if (!onV && !onH) break;
    }
    return {
        x,
        y,
        rx: 14 + rand() * 28,
        ry: 5 + rand() * 10,
        angle: rand() * Math.PI,
        rippleOffset: rand() * 3000,
    };
});

function sceneSettings(settings = {}) {
    settings = settings || {};
    const scene = settings.scene || {};
    const weather = scene.weather || settings.effectiveWeather || settings.weather || 'clear';
    const timeOfDay = scene.timeOfDay || settings.effectiveTimeOfDay || settings.timeOfDay || 'day';

    return {
        weather: weather === 'auto' ? 'clear' : weather,
        timeOfDay: timeOfDay === 'auto' ? 'noon' : timeOfDay,
    };
}

function drawGround(ctx, settings = {}) {
    const scene = sceneSettings(settings);
    const profile = TIME_PROFILES[scene.timeOfDay] || TIME_PROFILES.day;
    ctx.fillStyle = scene.weather === 'snow' ? '#d8eadf' : profile.grass;
    ctx.fillRect(0, 0, SIM.WIDTH, SIM.HEIGHT);
}

function drawTreeLayer(ctx) {
    if (!cachedTreeLayer) {
        cachedTreeLayer = document.createElement('canvas');
        cachedTreeLayer.width = SIM.WIDTH;
        cachedTreeLayer.height = SIM.HEIGHT;
        const tctx = cachedTreeLayer.getContext('2d');
        for (const tree of TREE_DATA) {
            tctx.fillStyle = '#6b3f21';
            tctx.fillRect(tree.x - tree.trunk / 2, tree.y, tree.trunk, tree.r * 1.25);
            tctx.fillStyle = `hsl(${tree.hue}, 45%, 31%)`;
            tctx.beginPath();
            tctx.arc(tree.x, tree.y, tree.r, 0, Math.PI * 2);
            tctx.fill();
            tctx.fillStyle = `hsl(${tree.hue + 8}, 48%, 39%)`;
            tctx.beginPath();
            tctx.arc(tree.x - tree.r * 0.45, tree.y + tree.r * 0.15, tree.r * 0.72, 0, Math.PI * 2);
            tctx.arc(tree.x + tree.r * 0.5, tree.y + tree.r * 0.12, tree.r * 0.68, 0, Math.PI * 2);
            tctx.fill();
        }
    }
    ctx.drawImage(cachedTreeLayer, 0, 0);
}

function drawRoadLayer(ctx) {
    const { WIDTH, HEIGHT, LANE_WIDTH, LANE_COUNT, ARM_WIDTH, CX, CY } = SIM;
    ctx.fillStyle = '#555';
    ctx.fillRect(CX - ARM_WIDTH, 0, ARM_WIDTH * 2, HEIGHT);
    ctx.fillRect(0, CY - ARM_WIDTH, WIDTH, ARM_WIDTH * 2);
    ctx.fillRect(CX - ARM_WIDTH, CY - ARM_WIDTH, ARM_WIDTH * 2, ARM_WIDTH * 2);

    ctx.strokeStyle = '#FFF';
    ctx.lineWidth = 2;
    ctx.setLineDash([20, 20]);

    for (let i = 1; i < LANE_COUNT * 2; i++) {
        const x = CX - ARM_WIDTH + i * LANE_WIDTH;
        if (i === LANE_COUNT) {
            ctx.strokeStyle = '#FFD700';
            ctx.setLineDash([]);
            ctx.beginPath();
            ctx.moveTo(x, 0); ctx.lineTo(x, CY - ARM_WIDTH);
            ctx.moveTo(x, CY + ARM_WIDTH); ctx.lineTo(x, HEIGHT);
            ctx.stroke();
            ctx.strokeStyle = '#FFF';
            ctx.setLineDash([20, 20]);
        } else {
            ctx.beginPath();
            ctx.moveTo(x, 0); ctx.lineTo(x, CY - ARM_WIDTH);
            ctx.moveTo(x, CY + ARM_WIDTH); ctx.lineTo(x, HEIGHT);
            ctx.stroke();
        }
    }
    for (let i = 1; i < LANE_COUNT * 2; i++) {
        const y = CY - ARM_WIDTH + i * LANE_WIDTH;
        if (i === LANE_COUNT) {
            ctx.strokeStyle = '#FFD700';
            ctx.setLineDash([]);
            ctx.beginPath();
            ctx.moveTo(0, y); ctx.lineTo(CX - ARM_WIDTH, y);
            ctx.moveTo(CX + ARM_WIDTH, y); ctx.lineTo(WIDTH, y);
            ctx.stroke();
            ctx.strokeStyle = '#FFF';
            ctx.setLineDash([20, 20]);
        } else {
            ctx.beginPath();
            ctx.moveTo(0, y); ctx.lineTo(CX - ARM_WIDTH, y);
            ctx.moveTo(CX + ARM_WIDTH, y); ctx.lineTo(WIDTH, y);
            ctx.stroke();
        }
    }
    ctx.setLineDash([]);

    ctx.strokeStyle = '#FFF';
    ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(CX, CY + ARM_WIDTH); ctx.lineTo(CX + ARM_WIDTH, CY + ARM_WIDTH); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(CX + ARM_WIDTH, CY); ctx.lineTo(CX + ARM_WIDTH, CY - ARM_WIDTH); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(CX, CY - ARM_WIDTH); ctx.lineTo(CX - ARM_WIDTH, CY - ARM_WIDTH); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(CX - ARM_WIDTH, CY); ctx.lineTo(CX - ARM_WIDTH, CY + ARM_WIDTH); ctx.stroke();
}

function drawRoads(ctx, settings = {}) {
    drawGround(ctx, settings);
    drawTreeLayer(ctx);
    if (!cachedRoadLayer) {
        cachedRoadLayer = document.createElement('canvas');
        cachedRoadLayer.width = SIM.WIDTH;
        cachedRoadLayer.height = SIM.HEIGHT;
        drawRoadLayer(cachedRoadLayer.getContext('2d'));
    }
    ctx.drawImage(cachedRoadLayer, 0, 0);
}

function drawLights(ctx, lightStates, msUntilChange = null, currentGreen = -1) {
    const { CX, CY, ARM_WIDTH } = SIM;
    const positions = [
        { x: CX + ARM_WIDTH + 20, y: CY + ARM_WIDTH + 20 },
        { x: CX + ARM_WIDTH + 20, y: CY - ARM_WIDTH - 120 },
        { x: CX - ARM_WIDTH - 60, y: CY - ARM_WIDTH - 120 },
        { x: CX - ARM_WIDTH - 60, y: CY + ARM_WIDTH + 20 },
    ];
    for (let i = 0; i < 4; i++) {
        drawLight(ctx, positions[i].x, positions[i].y, lightStates[i]);
        if (msUntilChange !== null && i === currentGreen) {
            ctx.fillStyle = '#FFF';
            ctx.font = 'bold 16px Arial';
            ctx.textAlign = 'center';
            ctx.fillText(`${(msUntilChange / 1000).toFixed(1)}s`, positions[i].x + 20, positions[i].y + 118);
        }
    }
}

function drawLight(ctx, x, y, state) {
    ctx.fillStyle = '#000';
    ctx.fillRect(x, y, 40, 100);
    ctx.fillStyle = state === SIM.RED ? '#F00' : '#500';
    ctx.beginPath(); ctx.arc(x + 20, y + 20, 10, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = state === SIM.YELLOW ? '#FF0' : '#550';
    ctx.beginPath(); ctx.arc(x + 20, y + 50, 10, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = state === SIM.GREEN ? '#0F0' : '#050';
    ctx.beginPath(); ctx.arc(x + 20, y + 80, 10, 0, Math.PI * 2); ctx.fill();
}

const VEHICLE_DIMENSIONS = {
    sedan: { l: 44, w: 22 },
    hatchback: { l: 38, w: 21 },
    van: { l: 52, w: 24 },
    pickup: { l: 50, w: 23 },
    taxi: { l: 44, w: 22 },
    bus: { l: 66, w: 25 },
    truck: { l: 62, w: 25 },
};

function drawCar(ctx, car) {
    const { CAR_LENGTH, CAR_WIDTH } = SIM;
    const isEmergency = car.t !== 'normal';
    const body = car.b || 'sedan';
    const dims = VEHICLE_DIMENSIONS[body] || VEHICLE_DIMENSIONS.sedan;
    const length = isEmergency ? CAR_LENGTH * 1.2 : dims.l;
    const w = isEmergency ? CAR_WIDTH * 1.1 : dims.w;

    ctx.save();
    ctx.translate(car.x, car.y);
    ctx.rotate(car.r);

    ctx.fillStyle = car.c;
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = 5;
    ctx.fillRect(-length / 2, -w / 2, length, w);
    ctx.shadowBlur = 0;

    if (car.t === 'ambulance') {
        // Türk Kızılayı amblemi: beyaz zemin üzerine kırmızı hilâl
        const r = Math.min(length, w) * 0.34;
        ctx.fillStyle = '#E30A17';
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#FFFFFF';
        ctx.beginPath();
        ctx.arc(r * 0.32, 0, r * 0.82, 0, Math.PI * 2);
        ctx.fill();
    } else if (car.t === 'police') {
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(-length / 4, -w / 2 + 2, length / 2, w - 4);
    } else if (car.t === 'firetruck') {
        ctx.fillStyle = '#CCCCCC';
        ctx.fillRect(-length / 3, -w / 4, length / 1.5, w / 2);
    } else if (body === 'bus') {
        ctx.fillStyle = '#101820';
        for (let x = -length / 2 + 8; x < length / 2 - 8; x += 12) {
            ctx.fillRect(x, -w / 2 + 3, 7, 6);
            ctx.fillRect(x, w / 2 - 9, 7, 6);
        }
        ctx.fillStyle = '#111';
        ctx.fillRect(length / 2 - 9, -w / 2 + 2, 5, w - 4);
    } else if (body === 'truck') {
        ctx.fillStyle = 'rgba(0,0,0,0.18)';
        ctx.fillRect(-length / 2 + 4, -w / 2 + 3, length * 0.5, w - 6);
        ctx.fillStyle = '#dbeafe';
        ctx.fillRect(length * 0.08, -w / 2 + 3, 8, w - 6);
    } else if (body === 'van') {
        ctx.fillStyle = '#dbeafe';
        ctx.fillRect(length / 4, -w / 2 + 3, 7, w - 6);
        ctx.fillStyle = 'rgba(0,0,0,0.14)';
        ctx.fillRect(-length / 3, -w / 2 + 3, length / 3, w - 6);
    } else if (body === 'pickup') {
        ctx.fillStyle = 'rgba(0,0,0,0.22)';
        ctx.fillRect(-length / 2 + 5, -w / 2 + 4, length * 0.38, w - 8);
        ctx.fillStyle = '#dbeafe';
        ctx.fillRect(length / 5, -w / 2 + 3, 7, w - 6);
    } else if (body === 'taxi') {
        ctx.fillStyle = '#111';
        ctx.fillRect(-5, -w / 2 - 3, 10, 4);
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        for (let x = -length / 3; x < length / 3; x += 8) {
            ctx.fillRect(x, -2, 4, 4);
        }
    } else {
        ctx.fillStyle = 'rgba(0,0,0,0.2)';
        ctx.fillRect(-length / 4, -w / 2 + 2, length / 2, w - 4);
    }

    ctx.fillStyle = '#88CCFF';
    ctx.fillRect(length / 4, -w / 2 + 2, 5, w - 4);
    ctx.fillRect(-length / 4 - 5, -w / 2 + 2, 5, w - 4);

    ctx.fillStyle = '#FFFF00';
    ctx.beginPath();
    ctx.arc(length / 2, -w / 2 + 4, 3, 0, Math.PI * 2);
    ctx.arc(length / 2, w / 2 - 4, 3, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#FF0000';
    ctx.beginPath();
    ctx.arc(-length / 2, -w / 2 + 4, 3, 0, Math.PI * 2);
    ctx.arc(-length / 2, w / 2 - 4, 3, 0, Math.PI * 2);
    ctx.fill();

    if (isEmergency) {
        const flash = Math.floor(Date.now() / 200) % 2 === 0;
        if (car.t === 'police') {
            ctx.fillStyle = flash ? '#FF0000' : '#0000FF';
            ctx.beginPath(); ctx.arc(0, -w / 2, 5, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = !flash ? '#FF0000' : '#0000FF';
            ctx.beginPath(); ctx.arc(0, w / 2, 5, 0, Math.PI * 2); ctx.fill();
        } else if (flash) {
            ctx.fillStyle = '#FF0000';
            ctx.shadowColor = '#FF0000';
            ctx.shadowBlur = 10;
            ctx.beginPath(); ctx.arc(0, 0, 6, 0, Math.PI * 2); ctx.fill();
            ctx.shadowBlur = 0;
        }
    }

    ctx.restore();
}

// Tıklamadan dir/lane çıkar (control + monitor müdahale için ortak)
function pickLaneFromClick(canvas, clientX, clientY) {
    const { CX, CY, ARM_WIDTH, LANE_WIDTH } = SIM;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = (clientX - rect.left) * scaleX;
    const y = (clientY - rect.top) * scaleY;

    let dir = -1, lane = -1;
    if (x >= CX && x <= CX + ARM_WIDTH && y >= CY + ARM_WIDTH) {
        dir = 0; lane = Math.floor((x - CX) / LANE_WIDTH);
    } else if (x >= CX + ARM_WIDTH && y >= CY - ARM_WIDTH && y <= CY) {
        dir = 1; lane = Math.floor((CY - y) / LANE_WIDTH);
    } else if (x >= CX - ARM_WIDTH && x <= CX && y <= CY - ARM_WIDTH) {
        dir = 2; lane = Math.floor((CX - x) / LANE_WIDTH);
    } else if (x <= CX - ARM_WIDTH && y >= CY && y <= CY + ARM_WIDTH) {
        dir = 3; lane = Math.floor((y - CY) / LANE_WIDTH);
    }
    if (dir === -1 || lane < 0 || lane > 2) return null;
    return { dir, lane };
}

// Spawn moduyken seçilebilir şeritleri vurgular
function drawLaneHighlights(ctx, vehicleType) {
    const { CX, CY, ARM_WIDTH, LANE_WIDTH, WIDTH, HEIGHT } = SIM;
    ctx.save();
    const alpha = 0.3 + Math.sin(Date.now() / 150) * 0.15;
    if (vehicleType === 'ambulance') {
        ctx.fillStyle = `rgba(231, 76, 60, ${alpha})`;
        ctx.strokeStyle = `rgba(231, 76, 60, ${alpha + 0.3})`;
    } else if (vehicleType === 'police') {
        ctx.fillStyle = `rgba(52, 152, 219, ${alpha})`;
        ctx.strokeStyle = `rgba(52, 152, 219, ${alpha + 0.3})`;
    } else {
        ctx.fillStyle = `rgba(243, 156, 18, ${alpha})`;
        ctx.strokeStyle = `rgba(243, 156, 18, ${alpha + 0.3})`;
    }
    ctx.lineWidth = 3;

    function highlight(x, y, w, h) { ctx.fillRect(x, y, w, h); ctx.strokeRect(x, y, w, h); }
    highlight(CX, CY + ARM_WIDTH, ARM_WIDTH, HEIGHT - (CY + ARM_WIDTH));
    highlight(CX + ARM_WIDTH, CY - ARM_WIDTH, WIDTH - (CX + ARM_WIDTH), ARM_WIDTH);
    highlight(CX - ARM_WIDTH, 0, ARM_WIDTH, CY - ARM_WIDTH);
    highlight(0, CY, CX - ARM_WIDTH, ARM_WIDTH);

    ctx.beginPath();
    for (let i = 1; i < 3; i++) {
        let x = CX + i * LANE_WIDTH;
        ctx.moveTo(x, CY + ARM_WIDTH); ctx.lineTo(x, HEIGHT);
    }
    for (let i = 1; i < 3; i++) {
        let y = CY - i * LANE_WIDTH;
        ctx.moveTo(CX + ARM_WIDTH, y); ctx.lineTo(WIDTH, y);
    }
    for (let i = 1; i < 3; i++) {
        let x = CX - i * LANE_WIDTH;
        ctx.moveTo(x, 0); ctx.lineTo(x, CY - ARM_WIDTH);
    }
    for (let i = 1; i < 3; i++) {
        let y = CY + i * LANE_WIDTH;
        ctx.moveTo(0, y); ctx.lineTo(CX - ARM_WIDTH, y);
    }
    ctx.stroke();
    ctx.restore();
}

// ==================== WS BAĞLANTISI ====================

function drawWeather(ctx, settings = {}) {
    const scene = sceneSettings(settings);
    const profile = TIME_PROFILES[scene.timeOfDay] || TIME_PROFILES.day;
    const now = performance.now();

    if (profile.tint) {
        ctx.fillStyle = profile.tint;
        ctx.fillRect(0, 0, SIM.WIDTH, SIM.HEIGHT);
    }

    if (profile.darkness > 0) {
        ctx.fillStyle = `rgba(3, 8, 20, ${profile.darkness})`;
        ctx.fillRect(0, 0, SIM.WIDTH, SIM.HEIGHT);
    }

    if (scene.weather === 'rain') {
        // --- Birikintiler (puddle) ---
        ctx.save();
        for (const p of PUDDLE_DATA) {
            const rippleT = ((now + p.rippleOffset) % 1800) / 1800; // 0..1 döngüsü
            const rippleR = rippleT * 1.6;                          // maksimum genleşme çarpanı

            // Birikinti gövdesi
            ctx.save();
            ctx.translate(p.x, p.y);
            ctx.rotate(p.angle);
            const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, p.rx);
            grad.addColorStop(0, 'rgba(140, 190, 230, 0.55)');
            grad.addColorStop(1, 'rgba(120, 170, 210, 0.18)');
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.ellipse(0, 0, p.rx, p.ry, 0, 0, Math.PI * 2);
            ctx.fill();

            // Halka efekti
            const rippleAlpha = (1 - rippleT) * 0.5;
            ctx.strokeStyle = `rgba(190, 220, 255, ${rippleAlpha})`;
            ctx.lineWidth = 1.2;
            ctx.beginPath();
            ctx.ellipse(0, 0, p.rx * (0.4 + rippleR * 0.55), p.ry * (0.4 + rippleR * 0.55), 0, 0, Math.PI * 2);
            ctx.stroke();

            // İkinci (gecikmiş) halka
            const r2T = ((now + p.rippleOffset + 900) % 1800) / 1800;
            const r2Alpha = (1 - r2T) * 0.3;
            ctx.strokeStyle = `rgba(190, 220, 255, ${r2Alpha})`;
            ctx.beginPath();
            ctx.ellipse(0, 0, p.rx * (0.4 + r2T * 1.6 * 0.55), p.ry * (0.4 + r2T * 1.6 * 0.55), 0, 0, Math.PI * 2);
            ctx.stroke();

            ctx.restore();
        }
        ctx.restore();

        // --- Yağmur damlaları ---
        ctx.save();
        for (const p of WEATHER_PARTICLES) {
            const y = (p.y + now * p.speed * 0.9) % (SIM.HEIGHT + 80) - 40;
            const x = (p.x + now * 0.055 + y * 0.14) % (SIM.WIDTH + 80) - 40;
            ctx.strokeStyle = `rgba(185, 216, 255, ${p.opacity})`;
            ctx.lineWidth = 0.8 + (p.size - 1) * 0.35;
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.lineTo(x - p.len * 0.32, y + p.len);
            ctx.stroke();
        }
        ctx.restore();

        // Hafif mavi-gri sis
        ctx.fillStyle = 'rgba(160, 200, 225, 0.06)';
        ctx.fillRect(0, 0, SIM.WIDTH, SIM.HEIGHT);
    } else if (scene.weather === 'snow') {
        ctx.save();
        ctx.fillStyle = 'rgba(255, 255, 255, 0.82)';
        for (let i = 0; i < 105; i++) {
            const p = WEATHER_PARTICLES[i];
            const y = (p.y + now * p.speed * 0.18) % (SIM.HEIGHT + 20) - 10;
            const x = (p.x + Math.sin((now * 0.0015) + p.y) * 16 + p.drift * y * 0.05) % SIM.WIDTH;
            ctx.beginPath();
            ctx.arc(x < 0 ? x + SIM.WIDTH : x, y, p.size, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.restore();
    }
}

function getAppBasePath() {
    const base = document.querySelector('base[href]');
    const url = base ? new URL(base.getAttribute('href'), window.location.href) : new URL('.', window.location.href);
    return url.pathname.endsWith('/') ? url.pathname : url.pathname + '/';
}

function buildWsUrls(role) {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const basePath = getAppBasePath().replace(/\/$/, '');
    const urls = [];

    function add(path) {
        const wsPath = path.replace(/\/{2,}/g, '/');
        const url = new URL(wsPath, `${proto}//${location.host}`);
        url.searchParams.set('role', role);
        const value = url.toString();
        if (!urls.includes(value)) urls.push(value);
    }

    add(basePath + '/ws');
    add('/ws');
    return urls;
}

function buildHttpUrls(path, params = {}) {
    const basePath = getAppBasePath().replace(/\/$/, '');
    const urls = [];

    function add(route) {
        const apiPath = route.replace(/\/{2,}/g, '/');
        const url = new URL(apiPath, location.origin);
        Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
        const value = url.toString();
        if (!urls.includes(value)) urls.push(value);
    }

    add(basePath + path);
    add(path);
    return urls;
}

function getInitialTransport() {
    const params = new URLSearchParams(location.search);
    const transport = params.get('transport');
    if (transport === 'ws') return 'ws';
    if (transport === 'http' || transport === 'poll') return 'http';
    if (transport === 'sse' || transport === 'stream') return 'sse';

    // Reverse proxy deployments often block Upgrade; avoid noisy browser WS errors there.
    return location.protocol === 'http:' ? 'ws' : 'sse';
}

class SimClient {
    constructor(role) {
        this.role = role;
        this.ws = null;
        this.es = null;
        this.snapshot = null;
        this._snapshotReceivedAt = 0;
        this.latencyMs = null;
        this.handlers = { state: [], event: [], hello: [], open: [], close: [], spawnAck: [] };
        this.knownEmergencyCars = new Map(); // id -> type
        this._wsUrls = buildWsUrls(role);
        this._wsUrlIndex = 0;
        this._reconnectDelay = 1000;
        this._pollTimer = null;
        this._httpConnected = false;
        this._transport = 'ws';
        const initialTransport = getInitialTransport();
        if (initialTransport === 'ws') this.connect();
        else if (initialTransport === 'sse') this._startSse();
        else this._startHttpFallback();
    }

    connect() {
        let opened = false;
        this.ws = new WebSocket(this._wsUrls[this._wsUrlIndex]);

        this.ws.addEventListener('open', () => {
            opened = true;
            this._transport = 'ws';
            this._reconnectDelay = 1000;
            this.handlers.open.forEach(h => h());
        });
        this.ws.addEventListener('message', (e) => {
            let msg;
            try { msg = JSON.parse(e.data); } catch { return; }
            this._handleMessage(msg);
        });
        this.ws.addEventListener('close', () => {
            let delay = this._reconnectDelay;
            if (!opened) {
                if (this._wsUrlIndex < this._wsUrls.length - 1) {
                    this._wsUrlIndex += 1;
                    setTimeout(() => this.connect(), 250);
                } else {
                    this._startHttpFallback();
                }
                return;
            }

            this.handlers.close.forEach(h => h());
            if (this._transport === 'ws') {
                setTimeout(() => this.connect(), delay);
                this._reconnectDelay = Math.min(this._reconnectDelay * 1.5, 5000);
            } else {
                this._startHttpFallback();
            }
        });
        this.ws.addEventListener('error', () => { try { this.ws.close(); } catch {} });
    }

    on(eventName, handler) { if (this.handlers[eventName]) this.handlers[eventName].push(handler); }

    send(msg) {
        if (this.ws && this.ws.readyState === 1) {
            this.ws.send(JSON.stringify(msg));
            return;
        }
        if (this._transport === 'http' || this._transport === 'sse') this._sendHttp(msg);
    }

    getRenderSnapshot() {
        if (!this.snapshot) return null;
        const elapsed = performance.now() - this._snapshotReceivedAt;
        const maxLead = this._transport === 'http' ? 180 : 70;
        const ticksAhead = Math.max(0, Math.min(maxLead, elapsed)) / (1000 / 60);
        if (ticksAhead <= 0) return this.snapshot;

        return {
            ...this.snapshot,
            cars: this.snapshot.cars.map(car => {
                if (!car.s) return car;
                return {
                    ...car,
                    x: car.x + Math.cos(car.r) * car.s * ticksAhead,
                    y: car.y + Math.sin(car.r) * car.s * ticksAhead,
                };
            }),
        };
    }

    getLatencyText() {
        if (this._transport === 'sse' && this.latencyMs === null) return 'Canlı';
        return this.latencyMs === null ? '--' : `${this.latencyMs}ms`;
    }

    _handleMessage(msg) {
        if (msg.type === 'state' || msg.type === 'hello') {
            this.snapshot = msg.snapshot;
            this._snapshotReceivedAt = performance.now();
            this._syncSirens(msg.snapshot);
            this._syncWeather(msg.snapshot);
            this.handlers.state.forEach(h => h(msg.snapshot));
            if (msg.type === 'hello') this.handlers.hello.forEach(h => h(msg));
        } else if (msg.type === 'event') {
            this.handlers.event.forEach(h => h(msg));
        } else if (msg.type === 'spawnAck') {
            this.handlers.spawnAck.forEach(h => h(msg));
        }
    }

    _startHttpFallback() {
        if (this._transport === 'http') return;
        this._transport = 'http';
        this.ws = null;
        if (this.es) {
            this.es.close();
            this.es = null;
        }
        this._httpConnected = false;
        this._pollHttp();
    }

    _startSse() {
        if (this._transport === 'sse') return;
        this._transport = 'sse';
        this.ws = null;
        this._httpConnected = false;

        const urls = buildHttpUrls('/api/stream', { role: this.role });
        let index = 0;
        const connectStream = () => {
            if (this._transport !== 'sse') return;
            let opened = false;
            const source = new EventSource(urls[index]);
            this.es = source;

            source.onopen = () => {
                opened = true;
                if (!this._httpConnected) {
                    this._httpConnected = true;
                    this.handlers.open.forEach(h => h());
                }
            };

            source.onmessage = (e) => {
                let msg;
                try { msg = JSON.parse(e.data); } catch { return; }
                this._handleMessage(msg);
            };

            source.onerror = () => {
                source.close();
                if (this.es === source) this.es = null;
                if (opened && this._httpConnected) {
                    this._httpConnected = false;
                    this.handlers.close.forEach(h => h());
                }

                if (!opened && index < urls.length - 1) {
                    index += 1;
                    setTimeout(connectStream, 300);
                } else {
                    this._startHttpFallback();
                }
            };
        };

        connectStream();
    }

    async _requestHttp(path, options = {}) {
        let lastError = null;
        for (const url of buildHttpUrls(path, { role: this.role })) {
            const startedAt = performance.now();
            try {
                const res = await fetch(url, {
                    cache: 'no-store',
                    ...options,
                    headers: {
                        ...(options.headers || {}),
                    },
                });
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                this.latencyMs = Math.round(performance.now() - startedAt);
                return await res.json();
            } catch (err) {
                lastError = err;
            }
        }
        throw lastError || new Error('HTTP fallback failed');
    }

    async _pollHttp() {
        if (this._transport !== 'http') return;
        try {
            const data = await this._requestHttp('/api/state');
            if (!this._httpConnected) {
                this._httpConnected = true;
                this.handlers.open.forEach(h => h());
                this._handleMessage({ type: 'hello', role: this.role, snapshot: data.snapshot });
            } else {
                this._handleMessage({ type: 'state', snapshot: data.snapshot });
            }
        } catch (_) {
            if (this._httpConnected) {
                this._httpConnected = false;
                this.handlers.close.forEach(h => h());
            }
        } finally {
            this._pollTimer = setTimeout(() => this._pollHttp(), this._httpConnected ? 500 : 1500);
        }
    }

    async _sendHttp(msg) {
        try {
            const data = await this._requestHttp('/api/command', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...msg, role: this.role }),
            });
            if (data.event) this._handleMessage(data.event);
            if (data.ack) this._handleMessage(data.ack);
            if (data.snapshot) this._handleMessage({ type: 'state', snapshot: data.snapshot });
        } catch (_) {}
    }

    _syncSirens(snap) {
        if (!snap) return;
        const present = new Map();
        for (const c of snap.cars) {
            if (c.t !== 'normal') present.set(c.id, c.t);
        }
        // Yeni acil araçlar
        for (const [id, type] of present) {
            if (!this.knownEmergencyCars.has(id)) {
                sirenController.start(id, type, snap.paused);
            }
        }
        // Kaybolanlar
        for (const id of this.knownEmergencyCars.keys()) {
            if (!present.has(id)) sirenController.stop(id);
        }
        this.knownEmergencyCars = present;
        sirenController.setPaused(!!snap.paused);
    }

    _syncWeather(snap) {
        if (!snap) return;
        const weather = snap.scene?.weather || snap.settings?.effectiveWeather || snap.settings?.weather || 'clear';
        weatherSoundController.setWeather(weather, !!snap.paused);
    }
}

window.SimClient = SimClient;
window.SIM = SIM;
window.simRender = { drawRoads, drawLights, drawCar, drawLaneHighlights, drawWeather, pickLaneFromClick };
window.sirenController = sirenController;
window.weatherSoundController = weatherSoundController;
