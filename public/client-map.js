// Salt harita — yalnızca render, kontrol yok.

const canvas = document.getElementById('trafficCanvas');
const ctx = canvas.getContext('2d', { alpha: false });
const client = new SimClient('map');
const $ = (id) => document.getElementById(id);
let lastRenderTime = 0;
const TARGET_FRAME_MS = 0;

function setConn(connected) {
    $('conn-pill').className = 'conn-pill ' + (connected ? 'connected' : 'disconnected');
}
client.on('open', () => setConn(true));
client.on('close', () => setConn(false));

function render(now = performance.now()) {
    if (now - lastRenderTime < TARGET_FRAME_MS) {
        requestAnimationFrame(render);
        return;
    }
    lastRenderTime = now;

    const snap = client.getRenderSnapshot();
    ctx.clearRect(0, 0, SIM.WIDTH, SIM.HEIGHT);
    simRender.drawRoads(ctx, snap && snap.settings);
    if (snap) {
        simRender.drawLights(ctx, snap.lights, snap.msUntilChange, snap.currentGreen);
        for (const car of snap.cars) simRender.drawCar(ctx, car);
    }
    simRender.drawWeather(ctx, snap && snap.settings);
    requestAnimationFrame(render);
}
render();
