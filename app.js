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

const italyCenter = [41.8719, 12.5674];
let map, currentUserPos = null;
let currentReportId = null; 

const markers = {}; // ✅ store markers

// --- DEVICE IDENTITY ENGINE ---
const getDeviceID = () => {
    let id = localStorage.getItem('asti_user_id');
    if (!id) {
        id = crypto.randomUUID(); // ✅ improved
        localStorage.setItem('asti_user_id', id);
    }
    return id;
};

// 2. INITIALIZATION
function initApp() {
    try {
        map = L.map('map', { 
            zoomControl: false,
            minZoom: 9 
        }).setView([44.90, 8.20], 13);

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { 
            maxZoom: 19 
        }).addTo(map);

        addAstiBoundary();
        setTimeout(() => { map.invalidateSize(); }, 500);

        map.on('click', (e) => processLocation(e.latlng, 'manual'));
        
        // ✅ REAL-TIME WITHOUT RELOAD
        reportsRef.on('child_added', (snapshot) => {
            addMarkerToMap(snapshot.val(), snapshot.key);
        });

        reportsRef.on('child_changed', (snapshot) => {
            updateMarker(snapshot.key, snapshot.val());
        });

        reportsRef.on('child_removed', (snapshot) => {
            removeMarker(snapshot.key);
        });

        requestLocation(false);
    } catch (e) { 
        console.error("Initialization Error:", e); 
    }
}

// 3. GEOGRAPHICAL BOUNDARIES
function addAstiBoundary() {
    const url = "https://nominatim.openstreetmap.org/search?format=geojson&q=Provincia+di+Asti&polygon_geojson=1&limit=1";
    fetch(url).then(res => res.json()).then(data => {
        if (data && data.features.length > 0) {
            L.geoJSON(data.features[0], {
                style: { 
                    color: "#f1c40f", 
                    weight: 3, 
                    fillColor: "#f1c40f",
                    fillOpacity: 0.1, 
                    interactive: false 
                }
            }).addTo(map);
            const bounds = L.geoJSON(data.features[0]).getBounds();
            map.fitBounds(bounds);
        }
    }).catch(err => console.error("Boundary error:", err));
}

// 4. CORE PROCESSING (SAFE OSRM)
async function processLocation(latlng, type, imageData = null) {
    try {
        let snappedLatLng = latlng;

        try {
            const res = await fetch(`https://router.project-osrm.org/nearest/v1/driving/${latlng.lng},${latlng.lat}?number=1`);
            const data = await res.json();

            if (data.waypoints && data.waypoints.length > 0) {
                const snapped = data.waypoints[0].location;
                snappedLatLng = { lat: snapped[1], lng: snapped[0] };
            }
        } catch (e) {
            console.warn("OSRM failed, using raw location");
        }
        
        const roadRes = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${snappedLatLng.lat}&lon=${snappedLatLng.lng}&zoom=18&addressdetails=1`);
        const roadData = await roadRes.json();
        const addr = roadData.address || {};
        
        const isAsti = (addr.postcode && addr.postcode.startsWith("14")) || (addr.county && addr.county.includes("Asti"));

        if (type === 'manual') {
            showManualPopup(snappedLatLng, addr.road || "Strada ad Asti", isAsti);
        } else {
            if (!isAsti) {
                alert("🛑 Reports blocked: You are outside the Province of Asti boundary.");
                return;
            }
            reportsRef.push({ 
                lat: snappedLatLng.lat, 
                lng: snappedLatLng.lng, 
                road: addr.road || "Strada ad Asti", 
                note: "Photo Report", 
                image: imageData, 
                status: "active",
                severity: "medio",
                timestamp: Date.now(),
                ownerID: getDeviceID()
            });
            alert("✅ Report saved!");
        }
    } catch (err) { 
        console.error("Process Error:", err); 
    }
}

// 5. UI COMPONENTS (SAFE BUTTON)
function showManualPopup(latlng, roadName, isAsti) {
    const buttonStyle = isAsti ? "background:#34C759;" : "background:#bdc3c7; cursor:not-allowed;";
    const buttonText = isAsti ? "Salva Segnalazione" : "Fuori Area Asti";
    const disabledAttr = isAsti ? "" : "disabled";

    const formHtml = `
        <div class="popup-form" style="padding:10px; min-width:240px;">
            <span class="road-label"><b>📍 ${roadName}</b></span><br><br>

            <textarea id="manualNote" placeholder="Dettagli..."></textarea><br><br>

            <select id="manualSeverity">
                <option value="none">🟢 Nessun danno</option>
                <option value="lieve">🟡 Lieve</option>
                <option value="medio" selected>🟠 Medio</option>
                <option value="grave">🔴 Grave</option>
                <option value="critico">⚫ Critico</option>
            </select><br><br>

            <input type="file" id="manualPhoto"><br><br>

            <button id="manualSaveBtn" ${disabledAttr} style="${buttonStyle}">
                ${buttonText}
            </button>
        </div>`;

    L.popup().setLatLng(latlng).setContent(formHtml).openOn(map);

    setTimeout(() => {
        const btn = document.getElementById('manualSaveBtn');
        if (btn && isAsti) {
            btn.addEventListener('click', () => {
                handleManualSave(latlng.lat, latlng.lng, roadName);
            });
        }
    }, 100);
}

// 6. MARKERS (RESTORED PHOTO LOGIC)
function addMarkerToMap(data, key) {
    const myID = getDeviceID();
    const isOwner = (data.ownerID === myID);
    
    let ringColor = "#86868B";
    if(data.severity === "none") ringColor = "#34C759";
    if(data.severity === "lieve") ringColor = "#FFCC00";
    if(data.severity === "medio") ringColor = "#FF9500";
    if(data.severity === "grave") ringColor = "#FF3B30";
    if(data.severity === "critico") ringColor = "#1D1D1F";

    const iconHtml = data.image 
        ? `<div style="
            width:42px;
            height:42px;
            border-radius:50%;
            border:3px solid ${ringColor};
            background-image:url('${data.image}');
            background-size:cover;
            background-position:center;
            box-shadow:0 4px 8px rgba(0,0,0,0.3);
        "></div>`
        : `<div style="
            width:24px;
            height:24px;
            background-color:${ringColor};
            border-radius:50%;
            border:2px solid white;
        "></div>`;

    const customIcon = L.divIcon({
        html: iconHtml,
        className: 'custom-icon',
        iconSize: [42, 42],
        iconAnchor: [21, 21]
    });

    const marker = L.marker([data.lat, data.lng], { icon: customIcon }).addTo(map);

    markers[key] = marker;

    marker.on('click', () => { 
        openLightbox(key, data.image, data.road, data.severity, isOwner); 
    });
}

function updateMarker(key, data) {
    if (markers[key]) {
        map.removeLayer(markers[key]);
    }
    addMarkerToMap(data, key);
}

function removeMarker(key) {
    if (markers[key]) {
        map.removeLayer(markers[key]);
        delete markers[key];
    }
}

// 7. UTILS (UNCHANGED)
async function handleManualSave(lat, lng, roadName) {
    const note = document.getElementById('manualNote').value;
    const severity = document.getElementById('manualSeverity').value;
    const fileInput = document.getElementById('manualPhoto');
    const saveBtn = document.getElementById('manualSaveBtn');

    saveBtn.disabled = true;
    saveBtn.innerText = "Invio...";

    try {
        let imageData = null;
        if (fileInput.files && fileInput.files[0]) {
            imageData = await new Promise((resolve) => {
                const reader = new FileReader();
                reader.onload = (e) => resolve(e.target.result);
                reader.readAsDataURL(fileInput.files[0]);
            });
        }

        await reportsRef.push({
            lat,
            lng,
            road: roadName,
            note,
            severity,
            image: imageData,
            status: "active",
            timestamp: Date.now(),
            ownerID: getDeviceID()
        });

        map.closePopup();
    } catch (error) {
        alert("Errore salvataggio!");
        saveBtn.disabled = false;
    }
}

function requestLocation(doFly) {
    navigator.geolocation.getCurrentPosition((pos) => {
        currentUserPos = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        if (doFly) map.flyTo([currentUserPos.lat, currentUserPos.lng], 17);
    });
}

// 8. LAUNCH
window.onload = initApp;