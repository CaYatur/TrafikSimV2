// Authoritative trafik simülasyonu — DOM/canvas bağımlılığı yoktur, Node tarafında çalışır.

const WIDTH = 1000;
const HEIGHT = 1000;
const LANE_WIDTH = 30;
const LANE_COUNT = 3;
const ARM_WIDTH = LANE_WIDTH * LANE_COUNT;
const CX = WIDTH / 2;
const CY = HEIGHT / 2;

const RED = 0;
const YELLOW = 1;
const GREEN = 2;
const YELLOW_DURATION_MS = 1400;

const DEFAULT_SETTINGS = {
    trafficDensity: 0.02,
    lightDuration: 10000,
    adaptiveLights: 1,
    carSpeedMultiplier: 1.0,
    acceleration: 0.05,
    collisionDistance: 150,
    weather: 'auto',
    timeOfDay: 'auto',
};

const STRING_SETTINGS = {
    weather: ['auto', 'clear', 'rain', 'snow'],
    timeOfDay: ['auto', 'morning', 'noon', 'day', 'evening', 'night'],
};

const WEATHER_CYCLE = ['clear', 'rain', 'clear', 'snow', 'clear'];
const TIME_OF_DAY_CYCLE = ['morning', 'noon', 'evening', 'night'];
const WEATHER_PHASE_MS = 30000;
const TIME_OF_DAY_PHASE_MS = 20000;

const NORMAL_VEHICLES = [
    { body: 'sedan', colors: ['#2d7dd2', '#d64045', '#41a85f', '#7f52ff', '#f2a541'], speed: 2.7 },
    { body: 'hatchback', colors: ['#00a6a6', '#ef476f', '#6a994e', '#3a86ff'], speed: 2.9 },
    { body: 'van', colors: ['#f1f5f9', '#94a3b8', '#f97316', '#38bdf8'], speed: 2.25 },
    { body: 'pickup', colors: ['#64748b', '#92400e', '#166534', '#1d4ed8'], speed: 2.35 },
    { body: 'taxi', colors: ['#facc15'], speed: 2.6 },
    { body: 'bus', colors: ['#f59e0b', '#16a34a', '#2563eb'], speed: 1.9 },
    { body: 'truck', colors: ['#dc2626', '#475569', '#ea580c'], speed: 1.8 },
];

const ADAPTIVE_DETECTION_DISTANCE = 420;
const MIN_ADAPTIVE_GREEN_MS = 3000;
const MAX_ADAPTIVE_GREEN_MULTIPLIER = 1.8;
const OLD_QUEUE_PRIORITY_RATIO = 0.75;
const OLD_QUEUE_SCORE_WEIGHT = 2.25;

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function pickRandom(list) {
    return list[Math.floor(Math.random() * list.length)];
}

class Car {
    constructor(sim, id, direction, lane, type = 'normal') {
        this.sim = sim;
        this.id = id;
        this.direction = direction;
        this.lane = lane;
        this.type = type;
        this.isEmergency = type !== 'normal';
        this.profile = this.isEmergency ? null : pickRandom(NORMAL_VEHICLES);
        this.bodyStyle = this.isEmergency ? type : this.profile.body;
        this.speed = 0;
        this.maxSpeed = (this.isEmergency ? 4 : this.profile.speed + Math.random() * 0.35) * sim.settings.carSpeedMultiplier;
        this.acceleration = this.isEmergency ? 0.1 : sim.settings.acceleration;
        this.distance = 0;
        this.path = this.generatePath();
        this.x = 0;
        this.y = 0;
        this.rotation = 0;

        if (type === 'ambulance') this.color = '#FFFFFF';
        else if (type === 'firetruck') this.color = '#FF0000';
        else if (type === 'police') this.color = '#0000FF';
        else this.color = pickRandom(this.profile.colors);

        this.removed = false;

        const pos = this.getPositionAt(0);
        if (pos) {
            this.x = pos.x;
            this.y = pos.y;
            this.rotation = pos.angle;
        }
    }

    generatePath() {
        const offset = (this.lane + 0.5) * LANE_WIDTH;
        const outOffset = offset;
        let startX, startY, entryX, entryY, exitX, exitY, endX, endY;

        if (this.direction === 0) {
            startX = CX + offset; startY = HEIGHT;
            entryX = CX + offset; entryY = CY + ARM_WIDTH;
            if (this.lane === 1) {
                endX = CX + offset; endY = 0;
                return [
                    { type: 'line', x1: startX, y1: startY, x2: entryX, y2: entryY },
                    { type: 'line', x1: entryX, y1: entryY, x2: endX, y2: endY },
                ];
            } else if (this.lane === 2) {
                exitX = CX + ARM_WIDTH; exitY = CY + outOffset;
                endX = WIDTH; endY = CY + outOffset;
                return [
                    { type: 'line', x1: startX, y1: startY, x2: entryX, y2: entryY },
                    { type: 'quadratic', x1: entryX, y1: entryY, cx: CX + ARM_WIDTH, cy: CY + ARM_WIDTH, x2: exitX, y2: exitY },
                    { type: 'line', x1: exitX, y1: exitY, x2: endX, y2: endY },
                ];
            } else {
                exitX = CX - ARM_WIDTH; exitY = CY - outOffset;
                endX = 0; endY = CY - outOffset;
                return [
                    { type: 'line', x1: startX, y1: startY, x2: entryX, y2: entryY },
                    { type: 'quadratic', x1: entryX, y1: entryY, cx: CX + 10, cy: CY - 10, x2: exitX, y2: exitY },
                    { type: 'line', x1: exitX, y1: exitY, x2: endX, y2: endY },
                ];
            }
        } else if (this.direction === 1) {
            startX = WIDTH; startY = CY - offset;
            entryX = CX + ARM_WIDTH; entryY = CY - offset;
            if (this.lane === 1) {
                endX = 0; endY = CY - offset;
                return [
                    { type: 'line', x1: startX, y1: startY, x2: entryX, y2: entryY },
                    { type: 'line', x1: entryX, y1: entryY, x2: endX, y2: endY },
                ];
            } else if (this.lane === 2) {
                exitX = CX + outOffset; exitY = CY - ARM_WIDTH;
                endX = CX + outOffset; endY = 0;
                return [
                    { type: 'line', x1: startX, y1: startY, x2: entryX, y2: entryY },
                    { type: 'quadratic', x1: entryX, y1: entryY, cx: CX + ARM_WIDTH, cy: CY - ARM_WIDTH, x2: exitX, y2: exitY },
                    { type: 'line', x1: exitX, y1: exitY, x2: endX, y2: endY },
                ];
            } else {
                exitX = CX - outOffset; exitY = CY + ARM_WIDTH;
                endX = CX - outOffset; endY = HEIGHT;
                return [
                    { type: 'line', x1: startX, y1: startY, x2: entryX, y2: entryY },
                    { type: 'quadratic', x1: entryX, y1: entryY, cx: CX - 10, cy: CY - 10, x2: exitX, y2: exitY },
                    { type: 'line', x1: exitX, y1: exitY, x2: endX, y2: endY },
                ];
            }
        } else if (this.direction === 2) {
            startX = CX - offset; startY = 0;
            entryX = CX - offset; entryY = CY - ARM_WIDTH;
            if (this.lane === 1) {
                endX = CX - offset; endY = HEIGHT;
                return [
                    { type: 'line', x1: startX, y1: startY, x2: entryX, y2: entryY },
                    { type: 'line', x1: entryX, y1: entryY, x2: endX, y2: endY },
                ];
            } else if (this.lane === 2) {
                exitX = CX - ARM_WIDTH; exitY = CY - outOffset;
                endX = 0; endY = CY - outOffset;
                return [
                    { type: 'line', x1: startX, y1: startY, x2: entryX, y2: entryY },
                    { type: 'quadratic', x1: entryX, y1: entryY, cx: CX - ARM_WIDTH, cy: CY - ARM_WIDTH, x2: exitX, y2: exitY },
                    { type: 'line', x1: exitX, y1: exitY, x2: endX, y2: endY },
                ];
            } else {
                exitX = CX + ARM_WIDTH; exitY = CY + outOffset;
                endX = WIDTH; endY = CY + outOffset;
                return [
                    { type: 'line', x1: startX, y1: startY, x2: entryX, y2: entryY },
                    { type: 'quadratic', x1: entryX, y1: entryY, cx: CX + 10, cy: CY + 10, x2: exitX, y2: exitY },
                    { type: 'line', x1: exitX, y1: exitY, x2: endX, y2: endY },
                ];
            }
        } else if (this.direction === 3) {
            startX = 0; startY = CY + offset;
            entryX = CX - ARM_WIDTH; entryY = CY + offset;
            if (this.lane === 1) {
                endX = WIDTH; endY = CY + offset;
                return [
                    { type: 'line', x1: startX, y1: startY, x2: entryX, y2: entryY },
                    { type: 'line', x1: entryX, y1: entryY, x2: endX, y2: endY },
                ];
            } else if (this.lane === 2) {
                exitX = CX - outOffset; exitY = CY + ARM_WIDTH;
                endX = CX - outOffset; endY = HEIGHT;
                return [
                    { type: 'line', x1: startX, y1: startY, x2: entryX, y2: entryY },
                    { type: 'quadratic', x1: entryX, y1: entryY, cx: CX - ARM_WIDTH, cy: CY + ARM_WIDTH, x2: exitX, y2: exitY },
                    { type: 'line', x1: exitX, y1: exitY, x2: endX, y2: endY },
                ];
            } else {
                exitX = CX + outOffset; exitY = CY - ARM_WIDTH;
                endX = CX + outOffset; endY = 0;
                return [
                    { type: 'line', x1: startX, y1: startY, x2: entryX, y2: entryY },
                    { type: 'quadratic', x1: entryX, y1: entryY, cx: CX + 10, cy: CY - 10, x2: exitX, y2: exitY },
                    { type: 'line', x1: exitX, y1: exitY, x2: endX, y2: endY },
                ];
            }
        }
        return [];
    }

    getDistanceToEntry() {
        const seg = this.path[0];
        if (!seg) return Infinity;
        const len = Math.sqrt((seg.x2 - seg.x1) ** 2 + (seg.y2 - seg.y1) ** 2);
        return len - this.distance;
    }

    getPositionAt(dist) {
        let currentDist = 0;
        for (const seg of this.path) {
            let len;
            if (seg.type === 'line') {
                len = Math.sqrt((seg.x2 - seg.x1) ** 2 + (seg.y2 - seg.y1) ** 2);
                if (dist <= currentDist + len) {
                    const t = (dist - currentDist) / len;
                    return {
                        x: seg.x1 + (seg.x2 - seg.x1) * t,
                        y: seg.y1 + (seg.y2 - seg.y1) * t,
                        angle: Math.atan2(seg.y2 - seg.y1, seg.x2 - seg.x1),
                    };
                }
            } else {
                const chord = Math.sqrt((seg.x2 - seg.x1) ** 2 + (seg.y2 - seg.y1) ** 2);
                len = chord * 1.2;
                if (dist <= currentDist + len) {
                    const t = (dist - currentDist) / len;
                    const mt = 1 - t;
                    const x = mt * mt * seg.x1 + 2 * mt * t * seg.cx + t * t * seg.x2;
                    const y = mt * mt * seg.y1 + 2 * mt * t * seg.cy + t * t * seg.y2;
                    const dx = 2 * mt * (seg.cx - seg.x1) + 2 * t * (seg.x2 - seg.cx);
                    const dy = 2 * mt * (seg.cy - seg.y1) + 2 * t * (seg.y2 - seg.cy);
                    return { x, y, angle: Math.atan2(dy, dx) };
                }
            }
            currentDist += len;
        }
        return null;
    }

    update() {
        const sim = this.sim;
        const settings = sim.settings;
        const lights = sim.trafficLights;
        const distToEntry = this.getDistanceToEntry();

        let targetSpeed = this.maxSpeed;

        if (lights[this.direction].state !== GREEN) {
            if (distToEntry > 0 && distToEntry < 300) {
                if (distToEntry < 20) targetSpeed = 0;
                else targetSpeed = Math.min(targetSpeed, (distToEntry - 20) * 0.05);
            }
        }

        for (const other of sim.cars) {
            if (other === this) continue;
            const dx = other.x - this.x;
            const dy = other.y - this.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist === 0) continue;

            const dirX = Math.cos(this.rotation);
            const dirY = Math.sin(this.rotation);
            const toLen = dist;
            const tx = dx / toLen;
            const ty = dy / toLen;
            const dotForward = dirX * tx + dirY * ty;

            if (other.direction === this.direction && other.lane === this.lane) {
                if (dotForward > 0.7 && dist < settings.collisionDistance) {
                    if (dist < 80) targetSpeed = 0;
                    else targetSpeed = Math.min(targetSpeed, (dist - 80) * 0.06);
                }
            }
        }

        if (this.speed < targetSpeed) this.speed += this.acceleration;
        else this.speed -= this.acceleration * 2;
        if (this.speed < 0) this.speed = 0;

        this.distance += this.speed;
        const pos = this.getPositionAt(this.distance);
        if (!pos) {
            this.removed = true;
            return;
        }
        this.x = pos.x;
        this.y = pos.y;
        this.rotation = pos.angle;

        if (this.x < -100 || this.x > WIDTH + 100 || this.y < -100 || this.y > HEIGHT + 100) {
            this.removed = true;
        }
    }

    pathTotalLength() {
        let total = 0;
        for (const seg of this.path) {
            if (seg.type === 'line') {
                total += Math.sqrt((seg.x2 - seg.x1) ** 2 + (seg.y2 - seg.y1) ** 2);
            } else {
                total += Math.sqrt((seg.x2 - seg.x1) ** 2 + (seg.y2 - seg.y1) ** 2) * 1.2;
            }
        }
        return total;
    }

    snapshot() {
        const base = {
            id: this.id,
            x: +this.x.toFixed(2),
            y: +this.y.toFixed(2),
            r: +this.rotation.toFixed(3),
            t: this.type,
            c: this.color,
            b: this.bodyStyle,
            d: this.direction,
            l: this.lane,
            s: +this.speed.toFixed(2),
        };
        if (this.isEmergency) {
            const total = this.pathTotalLength();
            base.dToE = +this.getDistanceToEntry().toFixed(1);
            base.progress = total > 0 ? +Math.min(1, this.distance / total).toFixed(3) : 0;
        }
        return base;
    }
}

class Simulation {
    constructor() {
        this.startedAt = Date.now();
        this.settings = { ...DEFAULT_SETTINGS };
        this.trafficLights = [
            { state: GREEN }, { state: RED }, { state: RED }, { state: RED },
        ];
        this.currentGreen = 0;
        this.lastLightChange = Date.now();
        this.emergencyActive = false;
        this.emergencyDirection = -1;
        this.emergencyType = null;
        this.cars = [];
        this.carIdCounter = 0;
        this.paused = false;
        this.tickCount = 0;
        this.lightOverride = null;
        this.yellowTransition = null;
        this.trafficDemand = { queues: [0, 0, 0, 0], scores: [0, 0, 0, 0], waitingMs: [0, 0, 0, 0] };
        this.lastServedAt = Array(4).fill(this.lastLightChange);
        this.queueFirstSeenAt = Array(4).fill(null);
    }

    updateSetting(key, value) {
        if (!(key in this.settings)) return false;
        if (key in STRING_SETTINGS) {
            const text = String(value || '').toLowerCase();
            if (!STRING_SETTINGS[key].includes(text)) return false;
            this.settings[key] = text;
            return true;
        }
        const num = Number(value);
        if (Number.isNaN(num)) return false;
        this.settings[key] = num;
        return true;
    }

    setPaused(paused) {
        this.paused = !!paused;
        if (!this.paused) this.lastLightChange = Date.now();
    }

    getCycleValue(values, phaseMs, now = Date.now()) {
        const elapsed = Math.max(0, now - this.startedAt);
        const index = Math.floor(elapsed / phaseMs) % values.length;
        return values[index];
    }

    getScene(now = Date.now()) {
        const weather = this.settings.weather === 'auto'
            ? this.getCycleValue(WEATHER_CYCLE, WEATHER_PHASE_MS, now)
            : this.settings.weather;
        const timeOfDay = this.settings.timeOfDay === 'auto'
            ? this.getCycleValue(TIME_OF_DAY_CYCLE, TIME_OF_DAY_PHASE_MS, now)
            : this.settings.timeOfDay;

        return {
            weather: weather === 'auto' ? 'clear' : weather,
            timeOfDay: timeOfDay === 'auto' ? 'noon' : timeOfDay,
        };
    }

    reset() {
        this.startedAt = Date.now();
        this.cars = [];
        this.trafficLights = [
            { state: GREEN }, { state: RED }, { state: RED }, { state: RED },
        ];
        this.currentGreen = 0;
        this.lastLightChange = Date.now();
        this.emergencyActive = false;
        this.emergencyDirection = -1;
        this.emergencyType = null;
        this.paused = false;
        this.lightOverride = null;
        this.yellowTransition = null;
        this.trafficDemand = { queues: [0, 0, 0, 0], scores: [0, 0, 0, 0], waitingMs: [0, 0, 0, 0] };
        this.lastServedAt = Array(4).fill(this.lastLightChange);
        this.queueFirstSeenAt = Array(4).fill(null);
    }

    spawnRandomCar() {
        const dir = Math.floor(Math.random() * 4);
        const lane = Math.floor(Math.random() * 3);
        for (const c of this.cars) {
            if (c.direction === dir && c.lane === lane && c.distance < 120) return;
        }
        this.cars.push(new Car(this, ++this.carIdCounter, dir, lane));
    }

    spawnEmergency(dir, lane, type) {
        if (dir < 0 || dir > 3 || lane < 0 || lane > 2) return null;
        if (!['ambulance', 'firetruck', 'police'].includes(type)) return null;

        this.emergencyActive = true;
        this.emergencyDirection = dir;
        this.emergencyType = type;
        this.yellowTransition = null;
        for (let i = 0; i < 4; i++) {
            this.trafficLights[i].state = i === dir ? GREEN : RED;
        }
        const car = new Car(this, ++this.carIdCounter, dir, lane, type);
        this.cars.push(car);
        return car.id;
    }

    overrideLight(dir, state) {
        if (dir < 0 || dir > 3) return false;
        if (![RED, YELLOW, GREEN].includes(state)) return false;
        if (this.emergencyActive) return false;
        this.lightOverride = { dir, state, until: Date.now() + this.settings.lightDuration };
        this.yellowTransition = null;
        for (let i = 0; i < 4; i++) {
            this.trafficLights[i].state = i === dir ? state : RED;
        }
        if (state === GREEN) this.currentGreen = dir;
        this.lastLightChange = Date.now();
        if (state === GREEN) {
            this.lastServedAt[dir] = this.lastLightChange;
            this.queueFirstSeenAt[dir] = null;
        }
        return true;
    }

    setGreenDirection(dir, now = Date.now()) {
        if (dir < 0 || dir > 3) return;
        for (let i = 0; i < 4; i++) {
            this.trafficLights[i].state = i === dir ? GREEN : RED;
        }
        this.currentGreen = dir;
        this.lastLightChange = now;
        this.lastServedAt[dir] = now;
        this.queueFirstSeenAt[dir] = null;
    }

    beginYellowToDirection(dir, now = Date.now()) {
        if (dir < 0 || dir > 3) return;
        if (dir === this.currentGreen) {
            this.setGreenDirection(dir, now);
            return;
        }
        if (this.yellowTransition) return;

        for (let i = 0; i < 4; i++) {
            this.trafficLights[i].state = i === this.currentGreen ? YELLOW : RED;
        }
        this.yellowTransition = {
            from: this.currentGreen,
            to: dir,
            phase: 1,
            until: now + YELLOW_DURATION_MS,
        };
    }

    finishYellowTransition(now = Date.now()) {
        if (!this.yellowTransition) return;
        const { to, phase } = this.yellowTransition;
        if (phase === 1) {
            // Faz 1 bitti: eski yön RED oldu. Şimdi yeni yön YELLOW'a geçiyor (faz 2).
            for (let i = 0; i < 4; i++) {
                this.trafficLights[i].state = i === to ? YELLOW : RED;
            }
            this.yellowTransition = {
                from: this.yellowTransition.from,
                to,
                phase: 2,
                until: now + Math.round(YELLOW_DURATION_MS * 0.7),
            };
        } else {
            // Faz 2 bitti: yeni yön GREEN'e geçiyor.
            this.yellowTransition = null;
            this.setGreenDirection(to, now);
        }
    }

    getAdaptiveTimings() {
        const duration = Math.max(1000, this.settings.lightDuration);
        return {
            minGreen: clamp(duration * 0.35, MIN_ADAPTIVE_GREEN_MS, duration),
            maxGreen: Math.max(duration, duration * MAX_ADAPTIVE_GREEN_MULTIPLIER),
        };
    }

    measureTrafficDemand(now = Date.now()) {
        const queues = [0, 0, 0, 0];
        const scores = [0, 0, 0, 0];
        const waitingMs = [0, 0, 0, 0];

        for (const car of this.cars) {
            if (car.isEmergency) continue;

            const distanceToEntry = car.getDistanceToEntry();
            if (distanceToEntry <= 0 || distanceToEntry > ADAPTIVE_DETECTION_DISTANCE) continue;

            const direction = car.direction;
            const proximity = 1 - (distanceToEntry / ADAPTIVE_DETECTION_DISTANCE);
            const slowBonus = car.speed < 0.35 ? 0.75 : 0;

            queues[direction]++;
            scores[direction] += 1 + proximity + slowBonus;
        }

        const servedDirection = this.emergencyActive ? this.emergencyDirection : this.currentGreen;
        for (let i = 0; i < 4; i++) {
            if (i === servedDirection || queues[i] === 0) {
                this.queueFirstSeenAt[i] = null;
                continue;
            }

            if (this.queueFirstSeenAt[i] === null) {
                this.queueFirstSeenAt[i] = now;
            }
            waitingMs[i] = now - this.queueFirstSeenAt[i];
        }

        this.trafficDemand = {
            queues,
            scores: scores.map(score => +score.toFixed(2)),
            waitingMs,
        };
        return this.trafficDemand;
    }

    chooseAdaptiveDirection(now, demand) {
        const nextInCycle = (this.currentGreen + 1) % 4;
        let bestDir = nextInCycle;
        let bestScore = -Infinity;
        let oldestDir = -1;
        let oldestWait = -1;

        for (let i = 0; i < 4; i++) {
            if (i === this.currentGreen) continue;
            if (demand.queues[i] <= 0) continue;

            if (demand.waitingMs[i] > oldestWait) {
                oldestWait = demand.waitingMs[i];
                oldestDir = i;
            }
        }

        const oldQueueThreshold = Math.max(MIN_ADAPTIVE_GREEN_MS, this.settings.lightDuration * OLD_QUEUE_PRIORITY_RATIO);
        if (oldestDir !== -1 && oldestWait >= oldQueueThreshold) {
            return {
                dir: oldestDir,
                score: demand.scores[oldestDir] + (oldestWait / Math.max(1, this.settings.lightDuration)) * OLD_QUEUE_SCORE_WEIGHT,
                reason: 'oldest-waiting',
            };
        }

        for (let i = 0; i < 4; i++) {
            if (i === this.currentGreen) continue;
            if (demand.queues[i] <= 0) continue;

            const waitedSinceGreen = now - (this.lastServedAt[i] || now);
            const queueAge = demand.waitingMs[i] || 0;
            const waitBoost = Math.min(2, waitedSinceGreen / Math.max(1, this.settings.lightDuration)) * 0.35;
            const queueAgeBoost = Math.min(2.5, queueAge / Math.max(1, this.settings.lightDuration)) * OLD_QUEUE_SCORE_WEIGHT;
            const score = demand.scores[i] + waitBoost;
            const priority = score + queueAgeBoost;

            if (
                priority > bestScore ||
                (priority === bestScore && i === nextInCycle)
            ) {
                bestScore = priority;
                bestDir = i;
            }
        }

        return { dir: bestDir, score: bestScore, reason: 'weighted' };
    }

    updateAdaptiveLights(now) {
        const demand = this.measureTrafficDemand(now);
        const elapsed = now - this.lastLightChange;
        const { minGreen, maxGreen } = this.getAdaptiveTimings();
        if (elapsed < minGreen) return;

        const currentScore = demand.scores[this.currentGreen];
        const bestOther = this.chooseAdaptiveDirection(now, demand);
        const bestOtherScore = bestOther.score;
        const bestOtherHasQueue = demand.queues[bestOther.dir] > 0;
        const allQueuesEmpty = demand.queues.every(count => count === 0);
        const oldestWaitingShouldPass = bestOther.reason === 'oldest-waiting';

        if (allQueuesEmpty) {
            if (elapsed >= this.settings.lightDuration) {
                this.beginYellowToDirection((this.currentGreen + 1) % 4, now);
            }
            return;
        }

        const currentIsEmpty = currentScore <= 0;
        const otherClearlyBusier = bestOtherScore > currentScore + 0.75;

        if (
            (currentIsEmpty && bestOtherHasQueue) ||
            (oldestWaitingShouldPass && bestOtherHasQueue) ||
            (elapsed >= maxGreen && bestOtherHasQueue) ||
            (elapsed >= this.settings.lightDuration && otherClearlyBusier)
        ) {
            this.beginYellowToDirection(bestOther.dir, now);
        }
    }

    updateTimedLights(now) {
        this.measureTrafficDemand(now);
        if (now - this.lastLightChange > this.settings.lightDuration) {
            this.beginYellowToDirection((this.currentGreen + 1) % 4, now);
        }
    }

    updateLights() {
        const now = Date.now();
        if (this.emergencyActive) {
            const stillActive = this.cars.some(c => c.isEmergency);
            if (!stillActive) {
                this.emergencyActive = false;
                this.emergencyDirection = -1;
                this.emergencyType = null;
                this.yellowTransition = null;
                this.lastLightChange = now;
                for (let i = 0; i < 4; i++) this.trafficLights[i].state = RED;
                this.trafficLights[this.currentGreen].state = GREEN;
                this.lastServedAt[this.currentGreen] = this.lastLightChange;
            } else {
                for (let i = 0; i < 4; i++) {
                    this.trafficLights[i].state = i === this.emergencyDirection ? GREEN : RED;
                }
                this.measureTrafficDemand();
                return;
            }
        }

        if (this.lightOverride && now >= this.lightOverride.until) {
            this.lightOverride = null;
            this.yellowTransition = null;
            this.setGreenDirection(this.currentGreen, now);
        }
        if (this.lightOverride) return;

        if (this.yellowTransition) {
            if (now >= this.yellowTransition.until) this.finishYellowTransition(now);
            else {
                this.measureTrafficDemand(now);
                return;
            }
        }

        if (this.settings.adaptiveLights) this.updateAdaptiveLights(now);
        else this.updateTimedLights(now);
    }

    getMsUntilLightDecision(now) {
        if (this.yellowTransition) {
            return Math.max(0, this.yellowTransition.until - now);
        }

        if (!this.settings.adaptiveLights) {
            return Math.max(0, this.settings.lightDuration - (now - this.lastLightChange));
        }

        const elapsed = now - this.lastLightChange;
        const { minGreen, maxGreen } = this.getAdaptiveTimings();
        const demand = this.trafficDemand || this.measureTrafficDemand(now);
        const currentScore = demand.scores[this.currentGreen] || 0;
        const bestOther = this.chooseAdaptiveDirection(now, demand);

        if (demand.queues.every(count => count === 0)) {
            return Math.max(0, this.settings.lightDuration - elapsed);
        }
        if (elapsed < minGreen) return minGreen - elapsed;
        if (bestOther.reason === 'oldest-waiting' && demand.queues[bestOther.dir] > 0) return 0;
        if (currentScore <= 0 && demand.queues[bestOther.dir] > 0) return 0;
        if (elapsed < this.settings.lightDuration) return this.settings.lightDuration - elapsed;
        if (elapsed < maxGreen && currentScore >= bestOther.score) return maxGreen - elapsed;
        return 0;
    }

    tick() {
        if (this.paused) return;
        this.tickCount++;
        this.updateLights();
        if (Math.random() < this.settings.trafficDensity) this.spawnRandomCar();
        for (const car of this.cars) car.update();
        this.cars = this.cars.filter(c => !c.removed);
    }

    snapshot() {
        const now = Date.now();
        const scene = this.getScene(now);
        let msUntilChange = null;
        if (!this.emergencyActive && !this.lightOverride) {
            msUntilChange = this.getMsUntilLightDecision(now);
        } else if (this.lightOverride) {
            msUntilChange = Math.max(0, this.lightOverride.until - now);
        }

        return {
            tick: this.tickCount,
            paused: this.paused,
            settings: {
                ...this.settings,
                effectiveWeather: scene.weather,
                effectiveTimeOfDay: scene.timeOfDay,
                scene,
            },
            scene,
            currentGreen: this.currentGreen,
            lights: this.trafficLights.map(l => l.state),
            msUntilChange,
            trafficDemand: this.trafficDemand,
            emergency: {
                active: this.emergencyActive,
                direction: this.emergencyDirection,
                type: this.emergencyType,
            },
            override: this.lightOverride ? { dir: this.lightOverride.dir, state: this.lightOverride.state } : null,
            cars: this.cars.map(c => c.snapshot()),
        };
    }
}

module.exports = {
    Simulation,
    constants: { WIDTH, HEIGHT, LANE_WIDTH, LANE_COUNT, ARM_WIDTH, CX, CY, RED, YELLOW, GREEN },
};
