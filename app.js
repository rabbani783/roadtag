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

// 2. INITIALIZATION
function initApp() {
    try {
        const savedLoc = JSON.parse(localStorage.getItem('lastLocation'));
        
        map = L.map('map', { 
            zoomControl: false,
            minZoom: 9 
        }).setView([44.90, 8.20], 13); // Centered on Asti

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { 
            maxZoom: 19 
        }).addTo(map);

        addAstiBoundary();

        setTimeout(() => { map.invalidateSize(); }, 500);

        // Map Click Listener
        map.on('click', (e) => processLocation(e.latlng, 'manual'));
        
        // Firebase Listeners
        reportsRef.on('child_added', (snapshot) => {
            addMarkerToMap(snapshot.val(), snapshot.key);
        });

        reportsRef.on('child_changed', (snapshot) => {
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
        .catch(err => console.error("Error loading boundary:", err));
}

// 4. CORE PROCESSING (Includes your Road Snapping)
async function processLocation(latlng, type, imageData = null) {
    try {
        // SNAPPING TO NEAREST ROAD (OSRM)
        const res = await fetch(`https://router.project-osrm.org/nearest/v1/driving/${latlng.lng},${latlng.lat}?number=1`);
        const data = await res.json();
        const snapped = data.waypoints[0].location;
        const snappedLatLng = { lat: snapped[1], lng: snapped[0] };
        
        const roadRes = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${snappedLatLng.lat}&lon=${snappedLatLng.lng}&zoom=18&addressdetails=1`);
        const roadData = await roadRes.json();
        const addr = roadData.address;

        const isAsti = (addr.postcode && addr.postcode.startsWith("14")) || (addr.county && addr.county.includes("Asti"));

        if (type === 'manual') {
            showManualPopup(snappedLatLng, addr.road || "Strada ad Asti", isAsti);
        } else {
            if (!isAsti) {
                alert("🛑 Reports blocked: Outside Asti boundary.");
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
                timestamp: Date.now() 
            });
            alert("✅ Report saved!");
        }
    } catch (err) { 
        console.error(err); 
    }
}

// 5. UI COMPONENTS
function showManualPopup(latlng, roadName, isAsti) {
    const buttonStyle = isAsti ? "background:#34C759;" : "background:#bdc3c7; cursor:not-allowed;";
    const buttonText = isAsti ? "Save Report" : "Outside Asti";
    const disabledAttr = isAsti ? "" : "disabled";

    const formHtml = `
        <div class="popup-form">
            <span class="road-label">📍 ${roadName}</span>
            <textarea id="manualNote" placeholder="Note" style="width:100%; height:50px; border-radius:8px; border:1px solid #ddd; padding:5px; margin-bottom:5px;"></textarea>
            <input type="file" id="manualPhoto" accept="image/*" style="width:100%; margin:5px 0;">
            <button id="manualSaveBtn" class="save-btn" ${disabledAttr} 
                style="${buttonStyle} color:white; border:none; padding:10px; width:100%; border-radius:10px; font-weight:bold; cursor:pointer;"
                onclick="handleManualSave(${latlng.lat}, ${latlng.lng}, '${roadName.replace(/'/g, "\\'")}')">
                ${buttonText}
            </button>
        </div>`;
    L.popup().setLatLng(latlng).setContent(formHtml).openOn(map);
}

function addMarkerToMap(data, key) {
    const markerColor = data.status === "resolved" ? "#2ecc71" : "#e74c3c";
    
    // Use Severity colors for icons
    let ringColor = markerColor;
    if(data.severity === "lieve") ringColor = "#34C759";
    if(data.severity === "grave") ringColor = "#FF3B30";
    if(data.severity === "critico") ringColor = "#1D1D1F";

    const iconHtml = data.image 
        ? `<div style="width:40px; height:40px; border-radius:50%; border:3px solid ${ringColor}; background-image:url('${data.image}'); background-size:cover; background-position:center; box-shadow: 0 2px 5px rgba(0,0,0,0.3);"></div>`
        : `<div style="width:20px; height:20px; background-color:${ringColor}; border-radius:50%; border:2px solid white;"></div>`;

    const customIcon = L.divIcon({
        html: iconHtml,
        className: 'custom-icon',
        iconSize: [40, 40],
        iconAnchor: [20, 20]
    });

    const marker = L.marker([data.lat, data.lng], { icon: customIcon }).addTo(map);

    // OPEN LIGHTBOX ON CLICK
    marker.on('click', () => {
        if (typeof openLightbox === "function") {
            openLightbox(key, data.image, data.road, data.severity);
        }
    });
}

// 6. DEEP TAGGING (Severity Logic)
function openLightbox(id, imageUrl, roadName, currentSev) {
    currentReportId = id;
    const lightbox = document.getElementById('lightbox');
    const fullPhoto = document.getElementById('fullPhoto');
    const modalInfo = document.getElementById('modalInfo');

    if (!lightbox || !fullPhoto) return;

    fullPhoto.src = imageUrl;
    modalInfo.innerText = roadName || "Report Asti";
    
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
    saveBtn.innerText = "Saving...";

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
            lat: lat, lng: lng, road: roadName, note: note,
            image: imageData, status: "active", severity: "medio", timestamp: Date.now()
        });

        map.closePopup();
    } catch (error) {
        alert("Error saving report.");
        saveBtn.disabled = false;
    }
}

function requestLocation(doFly) {
    navigator.geolocation.getCurrentPosition((pos) => {
        currentUserPos = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        if (doFly) map.flyTo([currentUserPos.lat, currentUserPos.lng], 17);
    }, null, { enableHighAccuracy: true });
}

function verifyLocationThenCamera() {
    navigator.geolocation.getCurrentPosition((pos) => {
        currentUserPos = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        document.getElementById('hiddenCameraInput').click();
    }, () => alert("GPS required!"), { enableHighAccuracy: true });
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