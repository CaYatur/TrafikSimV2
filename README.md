# TrafikSimV2

> 🇹🇷 Türkçe aşağıda · 🇬🇧 English below

## 🇹🇷 Türkçe

**TrafikSimV2**, bir kavşaktaki trafiği simüle eden, **sunucu yetkili (authoritative)** bir trafik simülasyonudur. Simülasyon Node.js sunucusunda çalışır; birden fazla tarayıcı (kontrol, izleme, harita, operatör, kokpit) aynı simülasyona canlı bağlanır. Bu proje, önceki tek sayfalık *TrafikSim* sürümünün ikinci (V2) hâlidir.

### Özellikler
- Sunucuda 60 Hz simülasyon döngüsü, istemcilere WebSocket (30 Hz) ve Server-Sent Events (20 Hz) ile yayın.
- **Uyarlanabilir trafik ışıkları**: yoğunluğa göre yeşil süresini değiştirir; elle ışık kontrolü (override).
- Araç tipleri: otomobil, otobüs, kamyon; acil durum araçları (ambulans, itfaiye, polis) elle eklenebilir.
- Hava durumu (açık, yağmur, kar) ve gün saati (sabah, öğle, akşam, gece) döngüsü veya sabit seçim.
- Ayarlanabilir trafik yoğunluğu, ışık süresi, hız çarpanı, ivme, çarpışma mesafesi; durdur/devam/sıfırla.
- Arayüzler: `index.html` (Kontrol), `monitor.html` (İzleme), `map.html` (Harita), `operator.html` (Operatör: görevdeki aracı ve başlangıç şeridini seçme), `dashboard.html` (Kokpit).
- Ters proxy arkasında çalışmak için `BASE_PATH` desteği.
- Kök klasördeki `index.html` + `script.js` + `style.css`: sunucusuz, tek sayfalık eski sürüm.

### Teknolojiler
Node.js, Express, ws (WebSocket), HTML5 Canvas, düz JavaScript.

### Kurulum ve çalıştırma
```bash
npm install
npm start
```
- Kontrol: http://localhost:3000/
- İzleme: http://localhost:3000/monitor.html
- Harita / Operatör / Kokpit: `map.html`, `operator.html`, `dashboard.html`

Ortam değişkenleri: `PORT` (varsayılan 3000), `BASE_PATH` (varsayılan `/trafiksimv2`; boş veya `/` vererek kapatılır).

### API
- `GET /api/state` – anlık durum
- `GET /api/stream?role=...` – SSE akışı
- `POST /api/command` – komut (ayar, durdur, devam, sıfırla, araç ekle, ışık override)
- `ws://.../ws?role=...` – WebSocket

### Proje yapısı
```
server/server.js      Express + WebSocket sunucusu, API
server/simulation.js  Simülasyon motoru
public/               Kontrol, izleme, harita, operatör ve kokpit arayüzleri
index.html, script.js Eski tek sayfalık sürüm
```

### Bilinen sorunlar
- Kimlik doğrulama yoktur; bağlanan herkes simülasyonu kontrol edebilir.
- Simülasyon durumu bellekte tutulur, sunucu yeniden başlayınca sıfırlanır.

### Proje tarihleri
- Oluşturma: 1 Mayıs 2026
- Son güncelleme: 12 Mayıs 2026

### Lisans
Lisans belirtilmemiştir.

---

## 🇬🇧 English

**TrafikSimV2** is a **server-authoritative** traffic intersection simulation. The simulation runs on a Node.js server and multiple browser views (control, monitor, map, operator, cockpit) connect to the same live simulation. It is the second version (V2) of the earlier single-page *TrafikSim*.

### Features
- 60 Hz server tick, broadcast over WebSocket (30 Hz) and Server-Sent Events (20 Hz).
- **Adaptive traffic lights** based on queue load, plus manual light override.
- Cars, buses, trucks; emergency vehicles (ambulance, fire truck, police) can be spawned manually.
- Weather (clear, rain, snow) and time of day (morning, noon, evening, night), cycling or fixed.
- Tunable density, light duration, speed multiplier, acceleration, collision distance; pause/resume/reset.
- Views: Control, Monitor, Map, Operator (pick the active vehicle and start lane), Cockpit dashboard.
- `BASE_PATH` support for running behind a reverse proxy.
- Root `index.html` + `script.js`: the older standalone single-page version.

### Tech
Node.js, Express, ws, HTML5 Canvas, vanilla JavaScript.

### Run
```bash
npm install
npm start   # http://localhost:3000/
```
Env vars: `PORT` (default 3000), `BASE_PATH` (default `/trafiksimv2`).

### Known issues
- No authentication; anyone connected can control the simulation.
- State is in memory and resets on restart.

### Project dates
- Created: 1 May 2026
- Last updated: 12 May 2026

### License
No license specified.
