const path = require('path');
const http = require('http');
const express = require('express');
const { WebSocketServer } = require('ws');
const { Simulation } = require('./simulation');

const PORT = process.env.PORT || 3000;
const TICK_HZ = 60;
const BROADCAST_HZ = 30;
const STREAM_HZ = 20;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const BASE_PATH = normalizeBasePath(process.env.BASE_PATH || process.env.PUBLIC_BASE_PATH || '/trafiksimv2');

const app = express();
app.use(express.json({ limit: '32kb' }));

function normalizeBasePath(value) {
    if (!value) return '';
    let normalized = String(value).trim();
    if (!normalized || normalized === '/') return '';
    if (!normalized.startsWith('/')) normalized = '/' + normalized;
    return normalized.replace(/\/+$/, '');
}

if (BASE_PATH) {
    app.use((req, res, next) => {
        if (req.path === BASE_PATH) return res.redirect(308, BASE_PATH + '/');
        next();
    });
    app.use(BASE_PATH, express.static(PUBLIC_DIR));
}
app.use(express.static(PUBLIC_DIR));

const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

const sim = new Simulation();
const streamClients = new Set();

const apiRouter = express.Router();
apiRouter.get('/state', (req, res) => {
    res.json({ ok: true, snapshot: sim.snapshot() });
});
apiRouter.get('/stream', (req, res) => {
    const role = normalizeRole(req.query && req.query.role);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    if (typeof res.flushHeaders === 'function') res.flushHeaders();

    const client = { res, role };
    streamClients.add(client);
    sendStream(client, { type: 'hello', role, snapshot: sim.snapshot() });

    const keepAlive = setInterval(() => {
        try { res.write(': keepalive\n\n'); } catch (_) {}
    }, 15000);

    req.on('close', () => {
        clearInterval(keepAlive);
        streamClients.delete(client);
    });
});
apiRouter.post('/command', (req, res) => {
    const role = normalizeRole(req.body && req.body.role);
    const msg = Object.assign({}, req.body);
    delete msg.role;
    const result = handleCommand(msg, { role, readyState: 0, send() {} }) || {};
    res.json({ ok: true, ...result, snapshot: sim.snapshot() });
});
app.use('/api', apiRouter);
if (BASE_PATH) app.use(BASE_PATH + '/api', apiRouter);

server.on('upgrade', (req, socket, head) => {
    const pathname = new URL(req.url || '/', 'http://localhost').pathname.replace(/\/+$/, '');
    if (pathname !== '/ws' && !pathname.endsWith('/ws')) {
        socket.destroy();
        return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req);
    });
});

wss.on('connection', (ws, req) => {
    const m = req.url && req.url.match(/[?&]role=([a-z0-9_-]+)/i);
    const role = normalizeRole(m && m[1]);
    ws.role = role;
    console.log(`[ws] connected (${role}) — total: ${wss.clients.size}`);

    ws.send(JSON.stringify({ type: 'hello', role, snapshot: sim.snapshot() }));

    ws.on('message', (raw) => {
        let msg;
        try { msg = JSON.parse(raw.toString()); } catch { return; }
        const result = handleCommand(msg, ws);
        if (result && result.ack && ws.readyState === 1) {
            ws.send(JSON.stringify(result.ack));
        }
    });

    ws.on('close', () => {
        console.log(`[ws] closed (${ws.role}) — total: ${wss.clients.size}`);
    });
});

function normalizeRole(value) {
    const role = String(value || 'unknown').toLowerCase();
    return /^[a-z0-9_-]+$/.test(role) ? role : 'unknown';
}

function handleCommand(msg, ws) {
    if (!msg || typeof msg.type !== 'string') return;

    switch (msg.type) {
        case 'setting':
            if (sim.updateSetting(msg.key, msg.value)) {
                const event = { type: 'event', event: 'setting', key: msg.key, value: sim.settings[msg.key], by: ws.role };
                broadcastEvent(event);
                return { event };
            }
            break;
        case 'pause':
            sim.setPaused(true);
            return broadcastCommandEvent({ type: 'event', event: 'pause', by: ws.role });
        case 'resume':
            sim.setPaused(false);
            return broadcastCommandEvent({ type: 'event', event: 'resume', by: ws.role });
        case 'togglePause':
            sim.setPaused(!sim.paused);
            return broadcastCommandEvent({ type: 'event', event: sim.paused ? 'pause' : 'resume', by: ws.role });
        case 'reset':
            sim.reset();
            return broadcastCommandEvent({ type: 'event', event: 'reset', by: ws.role });
        case 'spawnEmergency': {
            const id = sim.spawnEmergency(msg.dir, msg.lane, msg.vehicleType);
            let event = null;
            if (id !== null) {
                event = {
                    type: 'event', event: 'emergency',
                    dir: msg.dir, lane: msg.lane, vehicleType: msg.vehicleType, carId: id, by: ws.role,
                };
                broadcastEvent(event);
            }
            // İsteyen client'a doğrudan ack — kendi aracını takip edebilsin
            return {
                event,
                ack: {
                    type: 'spawnAck',
                    requestId: msg.requestId || null,
                    carId: id,
                    ok: id !== null,
                },
            };
        }
        case 'overrideLight':
            if (sim.overrideLight(msg.dir, msg.state)) {
                const event = { type: 'event', event: 'override', dir: msg.dir, state: msg.state, by: ws.role };
                broadcastEvent(event);
                return { event };
            }
            break;
    }
}

function broadcastCommandEvent(event) {
    broadcastEvent(event);
    return { event };
}

function broadcast(payload) {
    const data = JSON.stringify(payload);
    for (const client of wss.clients) {
        if (client.readyState === 1) client.send(data);
    }
}

function sendStream(client, payload) {
    try {
        client.res.write(`data: ${JSON.stringify(payload)}\n\n`);
    } catch (_) {
        streamClients.delete(client);
    }
}

function broadcastStream(payload) {
    for (const client of Array.from(streamClients)) sendStream(client, payload);
}

function broadcastEvent(evt) {
    broadcast(evt);
    broadcastStream(evt);
}

setInterval(() => sim.tick(), 1000 / TICK_HZ);
setInterval(() => broadcast({ type: 'state', snapshot: sim.snapshot() }), 1000 / BROADCAST_HZ);
setInterval(() => broadcastStream({ type: 'state', snapshot: sim.snapshot() }), 1000 / STREAM_HZ);

server.listen(PORT, () => {
    console.log(`TrafikSim server: http://localhost:${PORT}`);
    console.log(`  Kontrol arayuzu : http://localhost:${PORT}/`);
    if (BASE_PATH) console.log(`  Proxy base path : http://localhost:${PORT}${BASE_PATH}/`);
    console.log(`  Izleme arayuzu  : http://localhost:${PORT}/monitor.html`);
});
