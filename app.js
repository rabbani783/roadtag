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

// 2. INITIALIZATION (Merged Version)
function initApp() {
    try {
        const savedLoc = JSON.parse(localStorage.getItem('lastLocation'));
        const startPos = savedLoc ? [savedLoc.lat, savedLoc.lng] : italyCenter;
        
        // Setup Map with Asti focus
        map = L.map('map', { 
            zoomControl: false,
            minZoom: 9 
        }).setView([44.90, 8.20], 10);

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { 
            maxZoom: 19 
        }).addTo(map);

        // Add the professional boundary overlay
        addAstiBoundary();

        // Fix for mobile display
        setTimeout(() => { map.invalidateSize(); }, 500);

        // Click handlers
        map.on('click', (e) => processLocation(e.latlng, 'manual'));
        
        // Real-time Firebase Sync
        reportsRef.on('child_added', (snapshot) => {
            addMarkerToMap(snapshot.val(), snapshot.key);
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
                        fillOpacity: 0.15,
                        interactive: false
                    }
                }).addTo(map);
                
                // Auto-center on the boundary
                const bounds = L.geoJSON(data.features[0]).getBounds();
                map.fitBounds(bounds);
            }
        })
        .catch(err => console.error("Error loading Asti boundary:", err));
}

// 4. CORE PROCESSING
async function processLocation(latlng, type, imageData = null) {
    try {
        const res = await fetch(`https://router.project-osrm.org/nearest/v1/driving/${latlng.lng},${latlng.lat}?number=1`);
        const data = await res.json();
        const snapped = data.waypoints[0].location;
        const snappedLatLng = { lat: snapped[1], lng: snapped[0] };
        
        const roadRes = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${snappedLatLng.lat}&lon=${snappedLatLng.lng}&zoom=18&addressdetails=1`);
        const roadData = await roadRes.json();
        const addr = roadData.address;

        // --- NEW IMPROVED ASTI FILTER ---
        // Postcodes in the province of Asti start with 14xxx
        const postcode = addr.postcode || "";
        const provinceCode = addr.province || addr.county || "";
        
        const isAsti = (
            provinceCode.includes("Asti") || 
            postcode.startsWith("14") || 
            addr.city_district === "Asti"
        );
		if (!isAsti && type === 'manual') {
    console.log("Location rejected. Address found:", addr);
		}
        if (type === 'manual') {
            // This passes the true/false check to the popup
            showManualPopup(snappedLatLng, addr.road || addr.city || "Road in Asti", isAsti);
        } else {
            // For camera reports, we block them immediately if not in Asti
            if (!isAsti) {
                alert("🛑 Reports blocked: You are outside the Province of Asti boundary.");
                return;
            }
            reportsRef.push({ 
                lat: snappedLatLng.lat, 
                lng: snappedLatLng.lng, 
                road: addr.road || addr.city || "Road in Asti", 
                note: "Photo Report", 
                image: imageData, 
                timestamp: Date.now() 
            });
            alert("✅ Report saved!");
        }
    } catch (err) { 
        console.error(err);
    }
}

// 5. UI COMPONENTS (Markers & Popups)
function showManualPopup(latlng, roadName, isAsti) {
    const buttonStyle = isAsti ? "" : "background:#bdc3c7; cursor:not-allowed;";
    const buttonText = isAsti ? "Save Report" : "Outside Asti Area";
    const disabledAttr = isAsti ? "" : "disabled";

    const formHtml = `
        <div class="popup-form">
            <span class="road-label">📍 ${roadName}</span>
            <textarea id="manualNote" placeholder="Notes" style="width:100%; height:50px;"></textarea>
            <input type="file" id="manualPhoto" accept="image/*" style="width:100%; margin:5px 0;">
            <button id="manualSaveBtn" class="save-btn" ${disabledAttr} 
                style="${buttonStyle}"
                onclick="handleManualSave(${latlng.lat}, ${latlng.lng}, '${roadName.replace(/'/g, "\\'")}')">
                ${buttonText}
            </button>
        </div>`;
    L.popup().setLatLng(latlng).setContent(formHtml).openOn(map);
}

function addMarkerToMap(data, key) {
    const iconHtml = data.image 
        ? `<div style="width:40px; height:40px; border-radius:50%; border:3px solid white; background-image:url('${data.image}'); background-size:cover; background-position:center; box-shadow: 0 2px 5px rgba(0,0,0,0.5);"></div>`
        : `<div style="width:20px; height:20px; background-color:#3498db; border-radius:50%; border:2px solid white; box-shadow: 0 2px 5px rgba(0,0,0,0.3);"></div>`;

    const customIcon = L.divIcon({ html: iconHtml, className: 'custom-icon', iconSize: [40, 40], iconAnchor: [20, 20] });
    const marker = L.marker([data.lat, data.lng], { icon: customIcon }).addTo(map);

    let content = `<div class="popup-form">
        <span class="road-label">📍 ${data.road}</span>
        ${data.image ? `<img src="${data.image}" class="preview-img">` : ''}
        ${data.note ? `<p><b>Note:</b> ${data.note}</p>` : ''}
        <hr><button onclick="deleteReport('${key}')" style="background:none; border:none; color:#e74c3c; cursor:pointer; font-size:11px; width:100%;">🗑️ Delete</button>
    </div>`;
    marker.bindPopup(content);
}

// 6. UTILS & SYSTEM
async function handleManualSave(lat, lng, roadName) {
    const note = document.getElementById('manualNote').value;
    const fileInput = document.getElementById('manualPhoto');
    if (fileInput.files && fileInput.files[0]) {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                canvas.width = 600;
                canvas.height = img.height * (600 / img.width);
                canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
                reportsRef.push({ lat, lng, road: roadName, note, image: canvas.toDataURL('image/jpeg', 0.6), timestamp: Date.now() });
                map.closePopup();
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(fileInput.files[0]);
    } else {
        reportsRef.push({ lat, lng, road: roadName, note, image: null, timestamp: Date.now() });
        map.closePopup();
    }
}

function deleteReport(firebaseKey) {
    const secret = prompt("Password:");
    if (secret === "Asti123") reportsRef.child(firebaseKey).remove();
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
    }, () => alert("GPS required!"), { enableHighAccuracy: true });
}

function handleCameraUpload(event) {
    const file = event.target.files[0];
    const reader = new FileReader();
    reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = 600;
            canvas.height = img.height * (600 / img.width);
            canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
            processLocation(currentUserPos, 'camera', canvas.toDataURL('image/jpeg', 0.6));
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

window.onload = initApp;