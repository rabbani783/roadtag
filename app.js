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

// Initialize Firebase compat mode
firebase.initializeApp(firebaseConfig);
const database = firebase.database();
const reportsRef = database.ref('reports');

// Leaflet config
let map;
let currentUserPos = null;
let currentReportId = null; 
let currentLightboxKey = null;
let localSelectedSeverity = null;
let markerOwnerStatus = false;
const markers = {};

// --- DEVICE IDENTITY ENGINE ---
const getDeviceID = () => {
    let id = localStorage.getItem('asti_user_id');
    if (!id) {
        id = crypto.randomUUID();
        localStorage.setItem('asti_user_id', id);
    }
    return id;
};

// Monitor Firebase Connection Status
const monitorConnection = () => {
    const connectedRef = database.ref(".info/connected");
    const statusDot = document.getElementById("connectionStatus");
    if (statusDot) {
        connectedRef.on("value", (snap) => {
            if (snap.val() === true) {
                statusDot.style.backgroundColor = "var(--sev-none)";
                statusDot.style.boxShadow = "0 0 8px var(--sev-none)";
                statusDot.title = "Connesso al database";
            } else {
                statusDot.style.backgroundColor = "var(--sev-grave)";
                statusDot.style.boxShadow = "0 0 8px var(--sev-grave)";
                statusDot.title = "Disconnesso (Tentativo di riconnessione...)";
            }
        });
    }
};

// 2. INITIALIZATION
function initApp() {
    try {
        // Center of Asti, Italy
        map = L.map('map', { 
            zoomControl: false,
            minZoom: 8 
        }).setView([44.9009, 8.2068], 13);

        // Modern Clean Map Tiles (CartoDB Positron for cleaner dashboard UI)
        L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
            attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
            subdomains: 'abcd',
            maxZoom: 20
        }).addTo(map);

        // Styled Zoom Control on top right
        L.control.zoom({ position: 'topright' }).addTo(map);

        addAstiBoundary();
        monitorConnection();

        setTimeout(() => { map.invalidateSize(); }, 500);

        // Handle Map click to create a manual report
        map.on('click', (e) => processLocation(e.latlng, 'manual'));
        
        // Listen to realtime Firebase updates
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

// 3. GEOGRAPHICAL BOUNDARIES (Provincia di Asti)
function addAstiBoundary() {
    const url = "https://nominatim.openstreetmap.org/search?format=geojson&q=Provincia+di+Asti&polygon_geojson=1&limit=1";
    fetch(url)
        .then(res => res.json())
        .then(data => {
            if (data && data.features && data.features.length > 0) {
                L.geoJSON(data.features[0], {
                    style: { 
                        color: "#007AFF", 
                        weight: 2, 
                        fillColor: "#007AFF",
                        fillOpacity: 0.05, 
                        interactive: false 
                    }
                }).addTo(map);
                const bounds = L.geoJSON(data.features[0]).getBounds();
                map.fitBounds(bounds);
            }
        })
        .catch(err => console.error("Boundary load error:", err));
}

// Check if a coordinate is logically in or close to Asti
function checkIsCoordinatesInAstiRange(lat, lng) {
    // Asti Bounding Box: Lat [44.6, 45.2], Lng [7.8, 8.5]
    return lat >= 44.55 && lat <= 45.25 && lng >= 7.75 && lng <= 8.55;
}

// 4. CORE PROCESSING
async function processLocation(latlng, type, imageData = null) {
    let snappedLatLng = latlng;
    let roadName = "Strada ad Asti";
    let isAsti = checkIsCoordinatesInAstiRange(latlng.lat, latlng.lng);

    try {
        // Try Snapping to the nearest road using OSRM
        const res = await fetch(`https://router.project-osrm.org/nearest/v1/driving/${latlng.lng},${latlng.lat}?number=1`);
        const data = await res.json();
        if (data.waypoints && data.waypoints.length > 0) {
            const snapped = data.waypoints[0].location;
            snappedLatLng = { lat: snapped[1], lng: snapped[0] };
        }
    } catch (e) {
        console.warn("OSRM failed, using raw coordinates");
    }

    try {
        // Reverse Geocode using Nominatim
        const roadRes = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${snappedLatLng.lat}&lon=${snappedLatLng.lng}&zoom=18&addressdetails=1`);
        const roadData = await roadRes.json();
        const addr = roadData.address || {};
        
        roadName = addr.road || addr.pedestrian || addr.suburb || addr.city || "Strada ad Asti";
        
        // Accurate Asti Check: postcode starts with 14xxx or county includes Asti
        isAsti = (addr.postcode && addr.postcode.startsWith("14")) || 
                 (addr.county && addr.county.toLowerCase().includes("asti")) ||
                 (addr.city && addr.city.toLowerCase().includes("asti")) ||
                 checkIsCoordinatesInAstiRange(snappedLatLng.lat, snappedLatLng.lng);
    } catch (err) {
        console.error("Nominatim Reverse Geocoding Error:", err);
    }

    if (type === 'manual') {
        showManualPopup(snappedLatLng, roadName, isAsti);
    } else {
        if (!isAsti) {
            alert("🛑 Rapporti bloccati: La tua posizione corrente è fuori dalla Provincia di Asti.");
            return;
        }

        // Show a loading feedback or alert
        reportsRef.push({ 
            lat: snappedLatLng.lat, 
            lng: snappedLatLng.lng, 
            road: roadName, 
            note: "Segnalazione fotografica rapida", 
            image: imageData, 
            status: "active",
            severity: "medio",
            timestamp: Date.now(),
            ownerID: getDeviceID()
        });
        alert("✅ Segnalazione inviata con successo!");
    }
}

// 5. UI COMPONENTS (POPUP DIALOG)
function showManualPopup(latlng, roadName, isAsti) {
    const buttonStyle = isAsti ? "" : "background:#AEAEB2; cursor:not-allowed; box-shadow:none;";
    const buttonText = isAsti ? "Invia Segnalazione" : "Fuori Area Asti";
    const disabledAttr = isAsti ? "" : "disabled";

    const formHtml = `
        <div class="popup-form">
            <span class="road-label">📍 ${roadName}</span>
            
            <label>Descrizione Dettagli</label>
            <textarea id="manualNote" placeholder="Descrivi il danno stradale (es. buca profonda, asfalto crepato)..."></textarea>
            
            <label>Gravità del Danno</label>
            <select id="manualSeverity">
                <option value="none">🟢 Nessun danno</option>
                <option value="lieve">🟡 Lieve (Minor)</option>
                <option value="medio" selected>🟠 Medio (Medium)</option>
                <option value="grave">🔴 Grave (Serious)</option>
                <option value="critico">⚫ Critico (Urgent)</option>
            </select>
            
            <label>Foto Allegata</label>
            <label for="manualPhotoInput" class="custom-file-upload" id="uploadLabel">
                📸 Seleziona o Scatta Foto
            </label>
            <input type="file" id="manualPhotoInput" accept="image/*" onchange="previewManualPhoto(event)">
            <div id="photoPreviewContainer" style="display:none; width:100%; margin-bottom:12px;">
                <img id="manualPhotoPreview" class="preview-img" src="" alt="Anteprima">
            </div>

            <button id="manualSaveBtn" class="save-btn" ${disabledAttr} style="${buttonStyle}">
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

// Handle Manual Photo Select Preview
function previewManualPhoto(event) {
    const file = event.target.files[0];
    const previewContainer = document.getElementById('photoPreviewContainer');
    const previewImg = document.getElementById('manualPhotoPreview');
    const label = document.getElementById('uploadLabel');

    if (file) {
        const reader = new FileReader();
        reader.onload = (e) => {
            previewImg.src = e.target.result;
            previewContainer.style.display = 'block';
            label.innerHTML = `📸 Foto Selezionata (${(file.size / 1024 / 1024).toFixed(2)} MB)`;
        };
        reader.readAsDataURL(file);
    }
}

// 6. MARKERS & VISUAL REPRESENTATION
function addMarkerToMap(data, key) {
    const myID = getDeviceID();
    const isOwner = (data.ownerID === myID);
    
    let ringColor = "#86868B";
    let isCritical = false;
    
    if (data.severity === "none") ringColor = "var(--sev-none)";
    else if (data.severity === "lieve") ringColor = "var(--sev-lieve)";
    else if (data.severity === "medio") ringColor = "var(--sev-medio)";
    else if (data.severity === "grave") ringColor = "var(--sev-grave)";
    else if (data.severity === "critico") {
        ringColor = "var(--sev-critico)";
        isCritical = true;
    }

    // Custom Icon styling
    let iconHtml = "";
    const extraClass = isCritical ? "critical-marker" : "";

    if (data.image) {
        iconHtml = `<div class="${extraClass}" style="
            width:42px;
            height:42px;
            border-radius:50%;
            border:3px solid ${ringColor};
            background-image:url('${data.image}');
            background-size:cover;
            background-position:center;
            box-shadow:0 6px 14px rgba(0,0,0,0.3);
        "></div>`;
    } else {
        iconHtml = `<div class="${extraClass}" style="
            width:24px;
            height:24px;
            background-color:${ringColor};
            border-radius:50%;
            border:2px solid white;
            box-shadow:0 4px 10px rgba(0,0,0,0.25);
        "></div>`;
    }

    const customIcon = L.divIcon({
        html: iconHtml,
        className: 'custom-icon',
        iconSize: data.image ? [42, 42] : [24, 24],
        iconAnchor: data.image ? [21, 21] : [12, 12]
    });

    const marker = L.marker([data.lat, data.lng], { icon: customIcon }).addTo(map);

    markers[key] = marker;

    // Attach click logic to open lightbox
    marker.on('click', () => { 
        openLightbox(key, data.image, data.road, data.severity, isOwner, data.lat, data.lng, data.timestamp); 
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

// 7. UTILS & HELPERS (COMPRESSION & SAVING)

// Image Compression via Canvas
function compressImage(base64Str, maxWidth = 800, maxHeight = 800, quality = 0.8) {
    return new Promise((resolve) => {
        const img = new Image();
        img.src = base64Str;
        img.onload = () => {
            let width = img.width;
            let height = img.height;

            if (width > height) {
                if (width > maxWidth) {
                    height = Math.round((height * maxWidth) / width);
                    width = maxWidth;
                }
            } else {
                if (height > maxHeight) {
                    width = Math.round((width * maxHeight) / height);
                    height = maxHeight;
                }
            }

            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;

            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);

            resolve(canvas.toDataURL('image/jpeg', quality));
        };
    });
}

async function handleManualSave(lat, lng, roadName) {
    const note = document.getElementById('manualNote').value;
    const severity = document.getElementById('manualSeverity').value;
    const fileInput = document.getElementById('manualPhotoInput');
    const saveBtn = document.getElementById('manualSaveBtn');

    saveBtn.disabled = true;
    saveBtn.innerText = "Salvataggio...";

    try {
        let imageData = null;
        if (fileInput.files && fileInput.files[0]) {
            const rawBase64 = await new Promise((resolve) => {
                const reader = new FileReader();
                reader.onload = (e) => resolve(e.target.result);
                reader.readAsDataURL(fileInput.files[0]);
            });
            // Compress to keep Firebase database fast and lightweight
            imageData = await compressImage(rawBase64, 800, 800, 0.75);
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
        console.error("Save error:", error);
        alert("Errore durante l'invio della segnalazione. Riprova.");
        saveBtn.disabled = false;
        saveBtn.innerText = "Invia Segnalazione";
    }
}

// Geolocation requester
function requestLocation(doFly) {
    if (!navigator.geolocation) {
        alert("La geolocalizzazione non è supportata dal tuo browser.");
        return;
    }

    navigator.geolocation.getCurrentPosition(
        (pos) => {
            currentUserPos = { lat: pos.coords.latitude, lng: pos.coords.longitude };
            if (doFly) {
                map.flyTo([currentUserPos.lat, currentUserPos.lng], 16, {
                    animate: true,
                    duration: 1.5
                });
            }
        },
        (err) => {
            console.warn("Geolocation permission denied/error:", err.message);
            if (doFly) alert("Attiva la localizzazione GPS del dispositivo per visualizzare la tua posizione.");
        },
        { enableHighAccuracy: true, timeout: 8000 }
    );
}

// Trigger hidden input for camera quick report
function verifyLocationThenCamera() {
    if (!navigator.geolocation) {
        alert("Geolocalizzazione non supportata.");
        return;
    }

    navigator.geolocation.getCurrentPosition(
        async (pos) => {
            currentUserPos = { lat: pos.coords.latitude, lng: pos.coords.longitude };
            
            // Check location boundaries before opening camera
            const isAsti = checkIsCoordinatesInAstiRange(currentUserPos.lat, currentUserPos.lng);
            if (!isAsti) {
                alert("🛑 Segnalazioni disabilitate: Ti trovi all'esterno della Provincia di Asti.");
                return;
            }
            
            // Trigger hidden input
            document.getElementById('hiddenCameraInput').click();
        },
        (err) => {
            alert("🛑 Errore GPS: Impossibile rilevare la posizione prima di avviare la fotocamera.");
        },
        { enableHighAccuracy: true, timeout: 6000 }
    );
}

// Camera upload logic
async function handleCameraUpload(event) {
    const file = event.target.files[0];
    if (!file || !currentUserPos) return;

    try {
        const rawBase64 = await new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = (e) => resolve(e.target.result);
            reader.readAsDataURL(file);
        });

        // Compress
        const compressedData = await compressImage(rawBase64, 850, 850, 0.75);

        // Upload directly
        await processLocation(currentUserPos, 'camera', compressedData);
    } catch (e) {
        console.error("Camera upload failed:", e);
        alert("Errore nel caricamento della foto scattata.");
    }
}

// --- LIGHTBOX INTERACTIVE COMPONENT ---
function openLightbox(key, image, road, severity, isOwner, lat, lng, timestamp) {
    currentLightboxKey = key;
    localSelectedSeverity = severity;
    markerOwnerStatus = isOwner;

    const lightbox = document.getElementById('lightbox');
    const fullPhoto = document.getElementById('fullPhoto');
    const modalInfo = document.getElementById('modalInfo');
    const modalMeta = document.getElementById('modalMeta');

    // Populate photo section
    if (image) {
        fullPhoto.src = image;
        fullPhoto.style.display = 'block';
    } else {
        fullPhoto.style.display = 'none';
    }

    // Populate metadata
    modalInfo.innerText = road || "Strada sconosciuta";
    const dateFormatted = timestamp ? new Date(timestamp).toLocaleDateString('it-IT') : "Data sconosciuta";
    modalMeta.innerText = `Coordinate: ${lat.toFixed(5)}, ${lng.toFixed(5)} | Data: ${dateFormatted}`;

    // Highlight active severity button
    const buttons = document.querySelectorAll('.severity-grid .sev-btn');
    buttons.forEach(btn => {
        btn.classList.remove('active');
        if (btn.getAttribute('data-sev') === severity) {
            btn.classList.add('active');
        }
        
        // Only the owner of the report can change its severity
        if (isOwner) {
            btn.disabled = false;
        } else {
            btn.disabled = true;
            btn.title = "Solo chi ha creato la segnalazione può modificarla";
        }
    });

    lightbox.style.display = 'flex';
    setTimeout(() => {
        lightbox.classList.add('active');
    }, 10);
}

function closeLightbox() {
    const lightbox = document.getElementById('lightbox');
    lightbox.classList.remove('active');
    setTimeout(() => {
        lightbox.style.display = 'none';
        currentLightboxKey = null;
        localSelectedSeverity = null;
    }, 300);
}

// Update local active button and database severity
async function updateSev(sev, element) {
    if (!currentLightboxKey || !markerOwnerStatus) return;

    // Check if changed
    if (localSelectedSeverity === sev) return;

    localSelectedSeverity = sev;

    // Highlight UI locally first for snappy feel
    const buttons = document.querySelectorAll('.severity-grid .sev-btn');
    buttons.forEach(btn => btn.classList.remove('active'));
    element.classList.add('active');

    try {
        // Write to database
        await reportsRef.child(currentLightboxKey).update({
            severity: sev
        });
        
        // Little micro interaction
        element.style.transform = 'scale(1.08)';
        setTimeout(() => {
            element.style.transform = '';
        }, 150);

    } catch (e) {
        console.error("Failed to update database severity:", e);
        alert("Errore durante l'aggiornamento della gravità.");
    }
}

// 8. LAUNCH
window.onload = initApp;