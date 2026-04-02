// 1. CONFIGURATION
const firebaseConfig = {
    apiKey: "AIzaSyCOzpc3cX32FQL8vZxNMi5nAvfdlWwLKrU",
    authDomain: "italy-road-reporter.firebaseapp.com",
    projectId: "italy-road-reporter",
    databaseURL: "https://italy-road-reporter-default-rtdb.europe-west1.firebasedatabase.app/",
    storageBucket: "italy-road-reporter.firebasestorage.app",
    messagingSenderId: "480453082341",
    appId: "1:480453082341:web:7cd51e2256747f1003280c"
};

firebase.initializeApp(firebaseConfig);
const database = firebase.database();
const reportsRef = database.ref('reports');

let map, currentUserPos = null;
let currentReportId = null;
const markers = {}; // ✅ marker store

// --- DEVICE ID ---
const getDeviceID = () => {
    let id = localStorage.getItem('asti_user_id');
    if (!id) {
        id = crypto.randomUUID(); // ✅ improved
        localStorage.setItem('asti_user_id', id);
    }
    return id;
};

// 2. INIT
function initApp() {
    try {
        map = L.map('map', { zoomControl: false, minZoom: 9 })
            .setView([44.90, 8.20], 13);

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { 
            maxZoom: 19 
        }).addTo(map);

        addAstiBoundary();
        setTimeout(() => map.invalidateSize(), 500);

        map.on('click', (e) => processLocation(e.latlng, 'manual'));

        // ✅ REAL-TIME (no reload)
        reportsRef.on('child_added', (snap) => {
            addMarkerToMap(snap.val(), snap.key);
        });

        reportsRef.on('child_changed', (snap) => {
            updateMarker(snap.key, snap.val());
        });

        reportsRef.on('child_removed', (snap) => {
            removeMarker(snap.key);
        });

        requestLocation(false);
    } catch (e) {
        console.error("Init error:", e);
    }
}

// 3. ASTI BOUNDARY
function addAstiBoundary() {
    fetch("https://nominatim.openstreetmap.org/search?format=geojson&q=Provincia+di+Asti&polygon_geojson=1&limit=1")
        .then(res => res.json())
        .then(data => {
            if (data.features?.length) {
                const geo = L.geoJSON(data.features[0], {
                    style: {
                        color: "#f1c40f",
                        weight: 3,
                        fillOpacity: 0.1,
                        interactive: false
                    }
                }).addTo(map);
                map.fitBounds(geo.getBounds());
            }
        });
}

// 4. PROCESS LOCATION
async function processLocation(latlng, type, imageData = null) {
    try {
        let snappedLatLng = latlng;

        // ✅ SAFE OSRM
        try {
            const res = await fetch(`https://router.project-osrm.org/nearest/v1/driving/${latlng.lng},${latlng.lat}?number=1`);
            const data = await res.json();

            if (data.waypoints?.length) {
                const s = data.waypoints[0].location;
                snappedLatLng = { lat: s[1], lng: s[0] };
            }
        } catch {
            console.warn("OSRM failed, using raw coords");
        }

        const roadRes = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${snappedLatLng.lat}&lon=${snappedLatLng.lng}`);
        const roadData = await roadRes.json();
        const addr = roadData.address || {};

        const isAsti = (addr.postcode?.startsWith("14")) || (addr.county?.includes("Asti"));

        if (type === 'manual') {
            showManualPopup(snappedLatLng, addr.road || "Strada", isAsti);
            return;
        }

        if (!isAsti) return alert("Fuori Asti!");

        reportsRef.push({
            ...snappedLatLng,
            road: addr.road || "Strada",
            severity: "medio",
            image: imageData,
            timestamp: Date.now(),
            ownerID: getDeviceID()
        });

    } catch (e) {
        console.error(e);
    }
}

// 5. POPUP
function showManualPopup(latlng, roadName, isAsti) {
    const popup = L.popup().setLatLng(latlng).setContent(`
        <div style="padding:10px;">
            <b>📍 ${roadName}</b><br><br>

            <textarea id="manualNote" placeholder="Note..." style="width:100%;"></textarea><br><br>

            <select id="manualSeverity" style="width:100%;">
                <option value="none">🟢 Nessun danno</option>
                <option value="lieve">🟡 Lieve</option>
                <option value="medio" selected>🟠 Medio</option>
                <option value="grave">🔴 Grave</option>
                <option value="critico">⚫ Critico</option>
            </select><br><br>

            <input type="file" id="manualPhoto"><br><br>

            <button id="manualSaveBtn" ${!isAsti ? "disabled" : ""}>
                ${isAsti ? "Salva" : "Fuori area"}
            </button>
        </div>
    `).openOn(map);

    // ✅ SAFE EVENT
    setTimeout(() => {
        const btn = document.getElementById('manualSaveBtn');
        if (!btn || !isAsti) return;

        btn.onclick = async () => {
            const note = document.getElementById('manualNote').value;
            const severity = document.getElementById('manualSeverity').value;
            const file = document.getElementById('manualPhoto').files[0];

            let imageData = null;

            if (file) {
                imageData = await new Promise(res => {
                    const reader = new FileReader();
                    reader.onload = e => res(e.target.result);
                    reader.readAsDataURL(file);
                });
            }

            reportsRef.push({
                lat: latlng.lat,
                lng: latlng.lng,
                road: roadName,
                note,
                severity,
                image: imageData,
                timestamp: Date.now(),
                ownerID: getDeviceID()
            });

            map.closePopup();
        };
    }, 100);
}

// 6. MARKERS
function addMarkerToMap(data, key) {
    const colors = {
        none: "#34C759",
        lieve: "#FFCC00",
        medio: "#FF9500",
        grave: "#FF3B30",
        critico: "#1D1D1F"
    };

    const color = colors[data.severity] || "#999";

    const icon = L.divIcon({
        html: `<div style="width:20px;height:20px;border-radius:50%;background:${color};border:2px solid white;"></div>`,
        className: ''
    });

    const marker = L.marker([data.lat, data.lng], { icon }).addTo(map);

    markers[key] = marker; // ✅ store

    marker.on('click', () => {
        currentReportId = key;
        alert(`${data.road} (${data.severity})`);
    });
}

function updateMarker(key, data) {
    removeMarker(key);
    addMarkerToMap(data, key);
}

function removeMarker(key) {
    if (markers[key]) {
        map.removeLayer(markers[key]);
        delete markers[key];
    }
}

// 7. LOCATION
function requestLocation(fly) {
    navigator.geolocation.getCurrentPosition(pos => {
        currentUserPos = {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude
        };
        if (fly) map.flyTo([currentUserPos.lat, currentUserPos.lng], 17);
    });
}

// 8. START
window.onload = initApp;