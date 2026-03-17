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

function initApp() {
    try {
        const savedLoc = JSON.parse(localStorage.getItem('lastLocation'));
        const startPos = savedLoc ? [savedLoc.lat, savedLoc.lng] : italyCenter;
        
        map = L.map('map', { zoomControl: false }).setView(startPos, savedLoc ? 15 : 6);

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { 
            maxZoom: 19 
        }).addTo(map);
			// --- ASTI OVERLAY LOGIC ---

		// These coordinates represent a rough box/polygon around the Asti Province
		const astiPolygon = [
			[45.14, 7.85], // Top Left
			[45.14, 8.45], // Top Right
			[44.65, 8.45], // Bottom Right
			[44.65, 7.85]  // Bottom Left
		];

		// Add the yellow fill to the map
		const astiOverlay = L.polygon(astiPolygon, {
			color: "#f1c40f",      // Border color (Yellow)
			fillColor: "#f1c40f",  // Fill color
			fillOpacity: 0.15,     // Very light so you can still see the map
			weight: 2,             // Border thickness
			interactive: false     // Users click "through" it to the map
		}).addTo(map);

		// Optional: Zoom the map to fit this area automatically on start
		map.fitBounds(astiOverlay.getBounds());

        // Fix for grey screen on mobile
        setTimeout(() => { map.invalidateSize(); }, 500);

        map.on('click', (e) => processLocation(e.latlng, 'manual'));
        
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
function addAstiBoundary() {
    // We fetch the official boundary from Nominatim (OpenStreetMap)
    // Relation ID 44881 is the official ID for the Province of Asti
    const url = "https://nominatim.openstreetmap.org/search?format=geojson&q=Provincia+di+Asti&polygon_geojson=1&limit=1";

    fetch(url)
        .then(response => response.json())
        .then(data => {
            if (data && data.features.length > 0) {
                L.geoJSON(data.features[0], {
                    style: {
                        color: "#f1c40f",      // Border Color (Yellow)
                        weight: 3,             // Thickness
                        fillColor: "#f1c40f",  // Fill Color
                        fillOpacity: 0.2,      // Light transparency
                        interactive: false     // Click through to the map
                    }
                }).addTo(map);

                // This automatically centers the map on the province
                const bounds = L.geoJSON(data.features[0]).getBounds();
                map.fitBounds(bounds);
            }
        })
        .catch(err => console.error("Error loading Asti boundary:", err));
}
function initApp() {
    // ... your existing map setup ...
    map = L.map('map', { zoomControl: false }).setView(italyCenter, 9);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);

    // Call the new boundary function
    addAstiBoundary();
    
    // ... rest of your code ...
}
function addMarkerToMap(data, key) {
    const iconHtml = data.image 
        ? `<div style="width:40px; height:40px; border-radius:50%; border:3px solid white; background-image:url('${data.image}'); background-size:cover; background-position:center; box-shadow: 0 2px 5px rgba(0,0,0,0.5);"></div>`
        : `<div style="width:20px; height:20px; background-color:#3498db; border-radius:50%; border:2px solid white; box-shadow: 0 2px 5px rgba(0,0,0,0.3);"></div>`;

    const customIcon = L.divIcon({
        html: iconHtml,
        className: 'custom-icon',
        iconSize: [40, 40],
        iconAnchor: [20, 20]
    });

    const marker = L.marker([data.lat, data.lng], { icon: customIcon }).addTo(map);
    let content = `<div class="popup-form">
        <span class="road-label">📍 ${data.road}</span>
        ${data.image ? `<img src="${data.image}" class="preview-img">` : ''}
        ${data.note ? `<p><b>Note:</b> ${data.note}</p>` : ''}
        <hr><button onclick="deleteReport('${key}')" style="background:none; border:none; color:#e74c3c; cursor:pointer; font-size:11px; width:100%;">🗑️ Delete</button>
    </div>`;
    marker.bindPopup(content);
}

function deleteReport(firebaseKey) {
    const secret = prompt("Password:");
    if (secret === "Asti123") reportsRef.child(firebaseKey).remove();
}

async function processLocation(latlng, type, imageData = null) {
    try {
        // 1. Get the snapped road position
        const res = await fetch(`https://router.project-osrm.org/nearest/v1/driving/${latlng.lng},${latlng.lat}?number=1`);
        const data = await res.json();
        const snapped = data.waypoints[0].location;
        const snappedLatLng = { lat: snapped[1], lng: snapped[0] };
        
        // 2. Get full address details from Nominatim
        const roadRes = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${snappedLatLng.lat}&lon=${snappedLatLng.lng}&zoom=18&addressdetails=1`);
        const roadData = await roadRes.json();
        const addr = roadData.address;

        // 3. THE ASTI FILTER (Geofence)
        // We check if the city, town, village, or province mentions "Asti"
        const isAsti = (addr.city === "Asti" || addr.town === "Asti" || addr.county === "Asti" || addr.province === "Asti");

        if (!isAsti) {
            alert("🛑 Error: This app only accepts reports within the Province of Asti.");
            return; // STOP HERE - Do not save to Firebase
        }

        // 4. Continue if it is in Asti
        const roadName = addr.road || addr.city || addr.village || "Road in Asti";

        if (type === 'manual') {
            showManualPopup(snappedLatLng, roadName);
        } else {
            reportsRef.push({ 
                lat: snappedLatLng.lat, 
                lng: snappedLatLng.lng, 
                road: roadName, 
                note: "Photo Report", 
                image: imageData, 
                timestamp: Date.now() 
            });
            alert("✅ Report saved for Asti!");
        }
    } catch (err) { 
        console.error(err);
        alert("Could not verify location. Please try again.");
    }
}

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