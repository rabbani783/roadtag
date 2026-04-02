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

// --- DEVICE IDENTITY ENGINE ---
// Generates a unique ID for the phone to allow "Owner-Only" editing
const getDeviceID = () => {
    let id = localStorage.getItem('asti_user_id');
    if (!id) {
        id = 'user_' + Math.random().toString(36).substr(2, 9);
        localStorage.setItem('asti_user_id', id);
    }
    return id;
};

// 2. INITIALIZATION
function initApp() {
    try {
        // Initialize Map centered on Asti
        map = L.map('map', { 
            zoomControl: false,
            minZoom: 9 
        }).setView([44.90, 8.20], 13);

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { 
            maxZoom: 19 
        }).addTo(map);

        addAstiBoundary();
        setTimeout(() => { map.invalidateSize(); }, 500);

        // Map Click Listener for snapping to roads
        map.on('click', (e) => processLocation(e.latlng, 'manual'));
        
        // Firebase Listeners for Real-time updates
        reportsRef.on('child_added', (snapshot) => {
            addMarkerToMap(snapshot.val(), snapshot.key);
        });

        reportsRef.on('child_changed', () => { location.reload(); });
        reportsRef.on('child_removed', () => { location.reload(); });

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

// 4. CORE PROCESSING (Includes Road Snapping)
async function processLocation(latlng, type, imageData = null) {
    try {
        // OSRM Road Snapping Logic
        const res = await fetch(`https://router.project-osrm.org/nearest/v1/driving/${latlng.lng},${latlng.lat}?number=1`);
        const data = await res.json();
        const snapped = data.waypoints[0].location;
        const snappedLatLng = { lat: snapped[1], lng: snapped[0] };
        
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
                severity: "medio", // Default severity
                timestamp: Date.now(),
                ownerID: getDeviceID() // Locked to this phone
            });
            alert("✅ Report saved!");
        }
    } catch (err) { 
        console.error("Process Error:", err); 
    }
}

// 5. UI COMPONENTS
function showManualPopup(latlng, roadName, isAsti) {
    const buttonStyle = isAsti ? "background:#34C759;" : "background:#bdc3c7; cursor:not-allowed;";
    const buttonText = isAsti ? "Salva Segnalazione" : "Fuori Area Asti";
    const disabledAttr = isAsti ? "" : "disabled";

    const formHtml = `
        <div class="popup-form" style="padding:10px; min-width:200px;">
            <span class="road-label" style="font-weight:bold; color:#e74c3c; display:block; margin-bottom:5px;">📍 ${roadName}</span>
            <textarea id="manualNote" placeholder="Note (es. buca profonda)" style="width:100%; height:50px; border-radius:8px; border:1px solid #ddd; padding:5px; margin-bottom:10px;"></textarea>
            <input type="file" id="manualPhoto" accept="image/*" style="width:100%; margin-bottom:10px;">
            <button id="manualSaveBtn" class="save-btn" ${disabledAttr} 
                style="${buttonStyle} color:white; border:none; padding:12px; width:100%; border-radius:12px; font-weight:bold; cursor:pointer;"
                onclick="handleManualSave(${latlng.lat}, ${latlng.lng}, '${roadName.replace(/'/g, "\\'")}')">
                ${buttonText}
            </button>
        </div>`;
    L.popup().setLatLng(latlng).setContent(formHtml).openOn(map);
}

function addMarkerToMap(data, key) {
    const myID = getDeviceID();
    const isOwner = (data.ownerID === myID);
    
    // UI Color Logic
    let ringColor = data.status === "resolved" ? "#34C759" : "#FF9500";
    if(data.severity === "lieve") ringColor = "#34C759";
    if(data.severity === "grave") ringColor = "#FF3B30";
    if(data.severity === "critico") ringColor = "#1D1D1F";

    const iconHtml = data.image 
        ? `<div style="width:40px; height:40px; border-radius:50%; border:3px solid ${ringColor}; background-image:url('${data.image}'); background-size:cover; background-position:center; box-shadow: 0 2px 5px rgba(0,0,0,0.3);"></div>`
        : `<div style="width:20px; height:20px; background-color:${ringColor}; border-radius:50%; border:2px solid white; box-shadow: 0 2px 5px rgba(0,0,0,0.2);"></div>`;

    const customIcon = L.divIcon({
        html: iconHtml,
        className: 'custom-icon',
        iconSize: [40, 40],
        iconAnchor: [20, 20]
    });

    const marker = L.marker([data.lat, data.lng], { icon: customIcon }).addTo(map);

    // OPEN LIGHTBOX ON CLICK
    marker.on('click', () => { 
        openLightbox(key, data.image, data.road, data.severity, isOwner); 
    });
}

// 6. LIGHTBOX & SEVERITY LOCK
function openLightbox(id, imageUrl, roadName, currentSev, isOwner) {
    currentReportId = id;
    const lightbox = document.getElementById('lightbox');
    const fullPhoto = document.getElementById('fullPhoto');
    const modalInfo = document.getElementById('modalInfo');

    if (!lightbox || !fullPhoto) return;

    fullPhoto.src = imageUrl || "";
    modalInfo.innerText = roadName || "Segnalazione Asti";
    
    // SEVERITY LOCK: Disable buttons if severity is already set to something specific
    const sevContainer = document.querySelector('.severity-grid');
    if (sevContainer) {
        if (currentSev && currentSev !== "medio") {
            sevContainer.style.opacity = "0.5";
            sevContainer.style.pointerEvents = "none";
        } else {
            sevContainer.style.opacity = "1";
            sevContainer.style.pointerEvents = "auto";
        }
    }

    // Highlighting selection logic
    document.querySelectorAll('.sev-btn').forEach(btn => {
        const btnLevel = btn.getAttribute('onclick').match(/'([^']+)'/)[1];
        btn.style.border = (btnLevel === currentSev) ? '3px solid currentColor' : '2px solid transparent';
    });

    // OWNER DELETE BUTTON: Shows only if this phone created the report
    let delBtn = document.getElementById('ownerDelBtn');
    if (delBtn) delBtn.remove();
    
    if (isOwner) {
        delBtn = document.createElement('button');
        delBtn.id = 'ownerDelBtn';
        delBtn.innerText = "🗑️ Elimina la mia segnalazione";
        delBtn.style = "width:100%; margin-top:20px; padding:15px; background:#F2F2F7; color:#FF3B30; border:none; border-radius:14px; font-weight:bold; cursor:pointer;";
        delBtn.onclick = () => { 
            if(confirm("Sei sicuro di voler eliminare questo report?")) { 
                reportsRef.child(id).remove(); 
                closeLightbox(); 
            } 
        };
        const sidePanel = document.querySelector('.modal-side-panel') || document.querySelector('.modal-content');
        sidePanel.appendChild(delBtn);
    }
    
    lightbox.style.display = 'flex';
}

function updateSev(level, element) {
    if (!currentReportId) return;
    
    // UI selection update
    document.querySelectorAll('.sev-btn').forEach(btn => btn.style.border = '2px solid transparent');
    element.style.border = '3px solid currentColor';

    // Firebase Update
    reportsRef.child(currentReportId).update({ severity: level });
}

function closeLightbox() { 
    document.getElementById('lightbox').style.display = 'none'; 
    currentReportId = null; 
}

// 7. UTILS & SYSTEM
async function handleManualSave(lat, lng, roadName) {
    const note = document.getElementById('manualNote').value;
    const fileInput = document.getElementById('manualPhoto');
    const saveBtn = document.getElementById('manualSaveBtn');

    saveBtn.disabled = true;
    saveBtn.innerText = "Salvataggio...";

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
            lat: lat,
            lng: lng,
            road: roadName,
            note: note || "",
            image: imageData,
            status: "active",
            severity: "medio",
            timestamp: Date.now(),
            ownerID: getDeviceID() // Tagged with the device ID
        });

        map.closePopup();
    } catch (error) {
        console.error("Save error:", error);
        alert("Errore nel salvataggio.");
        saveBtn.disabled = false;
        saveBtn.innerText = "Riprova";
    }
}

function requestLocation(doFly) {
    navigator.geolocation.getCurrentPosition((pos) => {
        currentUserPos = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        localStorage.setItem('lastLocation', JSON.stringify(currentUserPos));
        if (doFly) map.flyTo([currentUserPos.lat, currentUserPos.lng], 17);
    }, (err) => console.warn(err), { enableHighAccuracy: true });
}

function verifyLocationThenCamera() {
    navigator.geolocation.getCurrentPosition((pos) => {
        currentUserPos = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        document.getElementById('hiddenCameraInput').click();
    }, () => alert("Il GPS è richiesto per segnalare!"), { enableHighAccuracy: true });
}

function handleCameraUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            const MAX_WIDTH = 600;
            canvas.width = MAX_WIDTH;
            canvas.height = img.height * (MAX_WIDTH / img.width);
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            processLocation(currentUserPos, 'camera', canvas.toDataURL('image/jpeg', 0.6));
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

// 8. LAUNCH
window.onload = initApp;