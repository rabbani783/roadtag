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
let currentReportId = null; // Global tracker for the Lightbox

// 2. INITIALIZATION
function initApp() {
    try {
        const savedLoc = JSON.parse(localStorage.getItem('lastLocation'));
        
        map = L.map('map', { 
            zoomControl: false,
            minZoom: 9 
        }).setView([44.90, 8.20], 10);

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { 
            maxZoom: 19 
        }).addTo(map);

        addAstiBoundary();

        setTimeout(() => { map.invalidateSize(); }, 500);

        map.on('click', (e) => processLocation(e.latlng, 'manual'));
        
        // Listen for new reports AND updates (important for severity changes)
        reportsRef.on('child_added', (snapshot) => {
            addMarkerToMap(snapshot.val(), snapshot.key);
        });

        reportsRef.on('child_changed', (snapshot) => {
            // Refresh marker if severity or status changes
            location.reload(); 
        });

        reportsRef.on('child_removed', () => {
            location.reload(); 
        });

        requestLocation(false);
    } catch (e) { 
        console.error("Initialization Error:", e);
    }
}

// 3. GEOGRAPHICAL BOUNDARIES
function addAstiBoundary() {
    const url = "https://nominatim.openstreetmap.org/search?format=geojson&q=Provincia+di+Asti&polygon_geojson=1&limit=1";
    fetch(url)
        .then(response => response.json())
        .then(data => {
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
        })
        .catch(err => console.error("Error loading Asti boundary:", err));
}

// 4. CORE PROCESSING
async function processLocation(latlng, type, imageData = null) {
    try {
        // 1. Get the Address (Reverse Geocoding)
        const roadRes = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${latlng.lat}&lon=${latlng.lng}&zoom=18&addressdetails=1`);
        const roadData = await roadRes.json();
        const addr = roadData.address || {};
        const roadName = addr.road || addr.pedestrian || addr.suburb || "Strada ad Asti";

        // 2. Simple Asti Check (Postcode 14xxx or Province Asti)
        const isAsti = (addr.postcode && addr.postcode.startsWith("14")) || 
                       (addr.county && addr.county.includes("Asti")) || 
                       (addr.city && addr.city.includes("Asti"));

        if (type === 'manual') {
            // Always show popup for manual clicks so user can see where they clicked
            showManualPopup(latlng, roadName, isAsti);
        } else {
            // Camera Upload Logic
            // If GPS is on, we save immediately
            reportsRef.push({ 
                lat: latlng.lat, 
                lng: latlng.lng, 
                road: roadName, 
                note: "Photo Report", 
                image: imageData, 
                status: "active",
                severity: "medio",
                timestamp: Date.now() 
            });
            alert("✅ Segnalazione Salvata!");
        }
    } catch (err) { 
        console.error("Location Process Error:", err);
        // Fallback: If the address server fails, still allow saving with generic name
        if (type !== 'manual') {
            reportsRef.push({ 
                lat: latlng.lat, lng: latlng.lng, 
                road: "Posizione GPS", image: imageData, 
                status: "active", severity: "medio", timestamp: Date.now() 
            });
            alert("✅ Salvato (Senza indirizzo)");
        }
    }
}

// 5. MARKER UI (With Apple Severity Design)
function addMarkerToMap(data, key) {
    // Determine Color based on Severity
    let sevColor = "#FF9500"; // Default Medio (Orange)
    if(data.status === "resolved") sevColor = "#34C759"; // Apple Success Green
    else if(data.severity === "lieve") sevColor = "#34C759";
    else if(data.severity === "grave") sevColor = "#FF3B30";
    else if(data.severity === "critico") sevColor = "#1D1D1F"; // Black/Critical

    const iconHtml = data.image 
        ? `<div style="width:44px; height:44px; border-radius:50%; border:3px solid ${sevColor}; background-image:url('${data.image}'); background-size:cover; background-position:center; box-shadow: 0 4px 10px rgba(0,0,0,0.3);"></div>`
        : `<div style="width:24px; height:24px; background-color:${sevColor}; border-radius:50%; border:2px solid white; box-shadow: 0 2px 5px rgba(0,0,0,0.2);"></div>`;

    const customIcon = L.divIcon({
        html: iconHtml,
        className: 'custom-icon',
        iconSize: [44, 44],
        iconAnchor: [22, 22]
    });

    const marker = L.marker([data.lat, data.lng], { icon: customIcon }).addTo(map);
    
    // ACTION: Click marker opens the Apple Lightbox
    marker.on('click', () => {
        openLightbox(key, data.image, data.road, data.severity);
    });
}

// 6. DEEP TAGGING & LIGHTBOX LOGIC
function openLightbox(id, imageUrl, roadName, currentSev) {
    currentReportId = id;
    const lightbox = document.getElementById('lightbox');
    const fullPhoto = document.getElementById('fullPhoto');
    const modalInfo = document.getElementById('modalInfo');

    if (!lightbox || !fullPhoto) return;

    fullPhoto.src = imageUrl;
    modalInfo.innerText = roadName || "Segnalazione Asti";
    
    // Highlight existing selection
    document.querySelectorAll('.sev-btn').forEach(btn => {
        btn.style.border = (btn.getAttribute('onclick').includes(currentSev)) 
            ? '3px solid currentColor' 
            : '2px solid transparent';
    });
    
    lightbox.style.display = 'flex';
}

function updateSev(level, element) {
    if (!currentReportId) return;
    
    document.querySelectorAll('.sev-btn').forEach(btn => btn.style.border = '2px solid transparent');
    element.style.border = '3px solid currentColor';

    reportsRef.child(currentReportId).update({
        severity: level
    }).then(() => {
        console.log("Database Updated: " + level);
    }).catch(err => console.error(err));
}

function closeLightbox() {
    document.getElementById('lightbox').style.display = 'none';
    currentReportId = null;
}

// 7. UTILS
async function handleManualSave(lat, lng, roadName) {
    const note = document.getElementById('manualNote').value;
    const fileInput = document.getElementById('manualPhoto');
    const saveBtn = document.getElementById('manualSaveBtn');

    saveBtn.disabled = true;
    saveBtn.innerText = "Salvataggio...";

    try {
        let imageData = null;
        // Handle photo if provided
        if (fileInput.files && fileInput.files[0]) {
            imageData = await new Promise((resolve) => {
                const reader = new FileReader();
                reader.onload = (e) => resolve(e.target.result); // Simplified for testing
                reader.readAsDataURL(fileInput.files[0]);
            });
        }

        // FORCE SAVE to Firebase
        await reportsRef.push({
            lat: lat,
            lng: lng,
            road: roadName,
            note: note || "Segnalazione manuale",
            image: imageData,
            status: "active",
            severity: "medio",
            timestamp: Date.now()
        });

        map.closePopup();
        alert("✅ Segnalazione inviata con successo!");
    } catch (error) {
        console.error("Firebase Save Error:", error);
        alert("🛑 Errore: " + error.message);
        saveBtn.disabled = false;
        saveBtn.innerText = "Riprova";
    }
}

function requestLocation(doFly) {
    navigator.geolocation.getCurrentPosition((pos) => {
        currentUserPos = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        localStorage.setItem('lastLocation', JSON.stringify(currentUserPos));
        if (doFly) map.flyTo([currentUserPos.lat, currentUserPos.lng], 17);
    }, null, { enableHighAccuracy: true });
}

function verifyLocationThenCamera() {
    navigator.geolocation.getCurrentPosition((pos) => {
        currentUserPos = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        document.getElementById('hiddenCameraInput').click();
    }, () => alert("GPS richiesto!"), { enableHighAccuracy: true });
}

function handleCameraUpload(event) {
    const file = event.target.files[0];
    const reader = new FileReader();
    reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            canvas.width = 600;
            canvas.height = img.height * (600 / img.width);
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            processLocation(currentUserPos, 'camera', canvas.toDataURL('image/jpeg', 0.6));
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

window.onload = initApp;