// portfoliojs.js

// --- VERY EARLY DEBUGGING CHECK ---
// This will log the state of the 'turf' object immediately when this script loads.
// Check your browser console for this output. If it's 'undefined', Turf.js isn't loading correctly.
console.log("portfoliojs.js loaded.");
console.log("window.turf status on load:", typeof window.turf, window.turf);
// --- END EARLY DEBUGGING CHECK ---


// ===== Load Sections Dynamically =====
let map; // This 'map' variable is not used for maplabMapInstance, but might be for other sections.

/**
 * Dynamically loads an HTML section into a specified DOM element.
 * @param {string} id - The ID of the DOM element to load the HTML into.
 * @param {string} url - The URL of the HTML file to fetch.
 */
function loadSection(id, url) {
  fetch(url)
    .then(res => {
      if (!res.ok) {
        throw new Error(`HTTP error! status: ${res.status}`);
      }
      return res.text();
    })
    .then(html => {
      document.getElementById(id).innerHTML = html;

      // Special handling for sections that require specific initialization
      if (id === "maplab") {
        // Use a short delay to ensure DOM is fully rendered after innerHTML
        setTimeout(() => {
          initMap();
        }, 100);
      }

      if (id === "realtime") {
        setTimeout(() => {
          initRealtimeMap();
        }, 100);
      }

      if (id === "experience") {
        setTimeout(() => {
          animateInvolvements();
        }, 100);
      }
    })
    .catch(err => console.error(`Failed to load ${id}:`, err));
}

// Load all sections when the window finishes loading
window.onload = () => {
  loadSection("header", "sections/header.html");
  loadSection("home", "sections/home.html");
  loadSection("aboutme", "sections/about.html");
  loadSection("education", "sections/education.html");
  loadSection("experience", "sections/experience.html");
  loadSection("skills", "sections/skills.html");
  loadSection("maplab", "sections/maplab.html");
  loadSection("projects", "sections/projects.html");
  loadSection("realtime", "sections/realtime.html");
  loadSection("contact", "sections/contact.html");
  loadSection("footer", "sections/footer.html");
};

// Global variables for map and GeoJSON layers
let maplabMapInstance = null; // The main Leaflet map instance for the Maplab section
const geoJsonLayers = {}; // Object to store Leaflet GeoJSON layers for easy access and toggling

// Global variables for Overlay Analysis
let overlayBufferLayer = null; // To store the buffer polygon layer
let overlayClickMarker = null; // To store the marker for the clicked analysis point

// Global variables for Shortest Path
let startPoint = null; // Stores the LatLng for the start point
let endPoint = null; // Stores the LatLng for the end point
let routingLayer = null; // Stores the Leaflet layer for the simulated path

// Global variable for Marker Tool
let currentMarker = null; // Stores the Leaflet marker for the current marker

/**
 * Helper function to clear analysis-related layers and results from the map and UI.
 * @param {L.Map} mapInstance - The Leaflet map instance to clear layers from.
 */
function clearAnalysisLayers(mapInstance) {
  // Remove specific overlay analysis layers
  if (overlayBufferLayer && mapInstance.hasLayer(overlayBufferLayer)) {
    mapInstance.removeLayer(overlayBufferLayer);
    overlayBufferLayer = null;
  }
  if (overlayClickMarker && mapInstance.hasLayer(overlayClickMarker)) {
    mapInstance.removeLayer(overlayClickMarker);
    overlayClickMarker = null;
  }
  // Remove specific shortest path layers
  if (routingLayer && mapInstance.hasLayer(routingLayer)) {
    mapInstance.removeLayer(routingLayer);
    routingLayer = null;
  }

  // Remove any previously added highlight layers from overlay analysis or road density
  mapInstance.eachLayer(layer => {
    // Check for layers added with custom 'isDensityResult' or specific highlight styles
    if (layer instanceof L.GeoJSON && layer.options && (layer.options.isDensityResult || (layer.options.style && layer.options.style.color === '#2ecc71'))) {
      mapInstance.removeLayer(layer);
    }
    // Specific check for 'Analysis Point', 'Start Point', 'End Point' markers
    if (layer instanceof L.Marker && layer.getPopup && layer.getPopup()) {
      const popupContent = layer.getPopup().getContent();
      if (typeof popupContent === 'string' && (popupContent.includes('Analysis Point') || popupContent.includes('Start Point') || popupContent.includes('End Point'))) {
        mapInstance.removeLayer(layer);
      }
    }
  });

  // Reset UI elements
  const resultContent = document.getElementById('result-content');
  if (resultContent) {
    resultContent.innerHTML = '<p>Results will appear here after analysis.</p>';
  }
  const distanceValue = document.getElementById('distance-value');
  if (distanceValue) {
    distanceValue.textContent = '0 km'; // Reset shortest path distance
  }
  startPoint = null; // Reset shortest path points
  endPoint = null;

  // Clear marker tool specific elements
  if (currentMarker && mapInstance.hasLayer(currentMarker)) {
    mapInstance.removeLayer(currentMarker);
    currentMarker = null;
  }
  const markerResults = document.getElementById('marker-results');
  if (markerResults) {
    markerResults.innerHTML = '<p>Click on the map to set a marker</p>';
  }
}


/**
 * Helper function to create HTML content for Leaflet popups from GeoJSON properties.
 * @param {object} properties - The properties object from a GeoJSON feature.
 * @returns {string} HTML string for the popup.
 */
function createPopupContent(properties) {
  if (!properties || Object.keys(properties).length === 0) {
    return "No information available.";
  }
  let content = "<table>";
  for (const key in properties) {
    if (Object.prototype.hasOwnProperty.call(properties, key)) {
      content += `<tr><th>${key}:</th><td>${properties[key]}</td></tr>`;
    }
  }
  content += "</table>";
  return content;
}

/**
 * Toggles popups for all loaded GeoJSON layers on the map.
 * @param {boolean} enable - True to enable popups, false to disable.
 */
function toggleGeoJsonPopups(enable) {
  for (const layerName in geoJsonLayers) {
    const geoJsonLayer = geoJsonLayers[layerName];
    if (maplabMapInstance && maplabMapInstance.hasLayer(geoJsonLayer)) { // Only affect layers currently on map
      geoJsonLayer.eachLayer(function(layer) {
        if (enable && layer.feature && layer.feature.properties) {
          // Only bind if it's a feature and has properties and is not already bound
          if (!layer.getPopup() || layer.getPopup().getContent() !== createPopupContent(layer.feature.properties)) {
              layer.bindPopup(createPopupContent(layer.feature.properties));
          }
        } else if (!enable) {
          layer.unbindPopup();
        }
      });
    }
  }
}

// ===== MapLab Map Initialization =====
/**
 * Initializes the Leaflet map for the Maplab section, loads base layers,
 * GeoJSON data, and sets up event listeners for map tools.
 */
function initMap() {
  const mapContainer = document.getElementById('maplab-map');
  if (!mapContainer) {
    console.error("MapLab container not found!");
    return;
  }

  // Clear any existing map instance to prevent re-initialization issues
  if (maplabMapInstance) {
    maplabMapInstance.remove();
  }

  mapContainer.innerHTML = ''; // Clear previous content
  mapContainer.style.height = "500px"; // Ensure the map container has a height

  // Initialize the map and assign it to the global maplabMapInstance
  maplabMapInstance = L.map('maplab-map').setView([28.7050, 80.6090], 15);


  // Define base tile layers
  const osmLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© OpenStreetMap contributors'
  });

  const esriLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 19,
    attribution: 'Tiles © Esri & contributors'
  });

  const cartoLayer = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    maxZoom: 19,
    attribution: '© CartoDB'
  });

  // Add OpenStreetMap as the default base layer
  osmLayer.addTo(maplabMapInstance);

  // Add a marker for the hometown
  L.marker([28.7050, 80.6090])
    .addTo(maplabMapInstance)
    .bindPopup("🏡 My Hometown: Dhangadhi")
    .openPopup();

  // Initialize geoJsonLayers with Leaflet GeoJSON instances (initially empty)
  // onEachFeature is set to bind popups, but will be toggled by the tool selection
  geoJsonLayers.dhangadhi = L.geoJSON(null, {
    color: '#ff7800',
    fillOpacity: 0.2,
    onEachFeature: function(feature, layer) {
      if (feature.properties) {
        layer.bindPopup(createPopupContent(feature.properties));
      }
    }
  });
  geoJsonLayers.rivers = L.geoJSON(null, {
    color: '#0077be',
    weight: 3,
    onEachFeature: function(feature, layer) {
      if (feature.properties) {
        layer.bindPopup(createPopupContent(feature.properties));
      }
    }
  });
  geoJsonLayers.roads = L.geoJSON(null, {
    color: '#555',
    weight: 2,
    onEachFeature: function(feature, layer) {
      if (feature.properties) {
        layer.bindPopup(createPopupContent(feature.properties));
      }
    }
  });
  geoJsonLayers.settlements = L.geoJSON(null, {
    pointToLayer: (feature, latlng) => L.circleMarker(latlng, {
      radius: 4,
      color: '#d03',
      fillOpacity: 0.8
    }),
    onEachFeature: function(feature, layer) {
      if (feature.properties) {
        layer.bindPopup(createPopupContent(feature.properties));
      }
    }
  });
  geoJsonLayers.facilities = L.geoJSON(null, {
    pointToLayer: (feature, latlng) => L.circleMarker(latlng, {
      radius: 5,
      color: '#16a085',
      fillOpacity: 0.8
    }),
    onEachFeature: function(feature, layer) {
      if (feature.properties) {
        layer.bindPopup(createPopupContent(feature.properties));
      }
    }
  });
  geoJsonLayers.tourism = L.geoJSON(null, {
    pointToLayer: (feature, latlng) => L.circleMarker(latlng, {
      radius: 6,
      color: '#f39c12',
      fillOpacity: 0.8
    }),
    onEachFeature: function(feature, layer) {
      if (feature.properties) {
        layer.bindPopup(createPopupContent(feature.properties));
      }
    }
  });

  // Fetch and add GeoJSON data to map and store in geoJsonLayers
  fetch('Data/Dhangadhi.geojson')
    .then(res => res.json())
    .then(data => {
      geoJsonLayers.dhangadhi.addData(data).addTo(maplabMapInstance);
      maplabMapInstance.fitBounds(geoJsonLayers.dhangadhi.getBounds());
    })
    .catch(err => console.error("Error loading Dhangadhi.geojson:", err));

  fetch('Data/Rivers.geojson')
    .then(res => res.json())
    .then(data => geoJsonLayers.rivers.addData(data).addTo(maplabMapInstance))
    .catch(err => console.error("Error loading Rivers.geojson:", err));

  fetch('Data/Roads.geojson')
    .then(res => res.json())
    .then(data => geoJsonLayers.roads.addData(data).addTo(maplabMapInstance))
    .catch(err => console.error("Error loading Roads.geojson:", err));

  fetch('Data/Settlements.geojson')
    .then(res => res.json())
    .then(data => geoJsonLayers.settlements.addData(data).addTo(maplabMapInstance))
    .catch(err => console.error("Error loading Settlements.geojson:", err));

  fetch('Data/Facilities.geojson')
    .then(res => res.json())
    .then(data => geoJsonLayers.facilities.addData(data).addTo(maplabMapInstance))
    .catch(err => console.error("Error loading Facilities.geojson:", err));

  fetch('Data/Tourism.geojson')
    .then(res => res.json())
    .then(data => geoJsonLayers.tourism.addData(data).addTo(maplabMapInstance))
    .catch(err => console.error("Error loading Tourism.geojson:", err));


  // Define base maps and overlay maps for Leaflet's built-in layer control
  const baseMaps = {
    "OpenStreetMap": osmLayer,
    "Esri Imagery": esriLayer,
    "Carto Light": cartoLayer
  };

  const overlayMaps = {
    "Dhangadhi Boundary": geoJsonLayers.dhangadhi,
    "Rivers": geoJsonLayers.rivers,
    "Roads": geoJsonLayers.roads,
    "Settlements": geoJsonLayers.settlements,
    "Facilities": geoJsonLayers.facilities,
    "Tourism": geoJsonLayers.tourism
  };

  // Add Leaflet's layer control to the map
  const layerControl = L.control.layers(baseMaps, overlayMaps, {
    collapsed: true
  });
  layerControl.addTo(maplabMapInstance);

  // Custom layer display panel logic
  const customLayerPanel = document.getElementById('layer-panel');
  const customLayerToggleButton = document.getElementById('layer-toggle');

  if (customLayerToggleButton && customLayerPanel) {
    customLayerToggleButton.addEventListener('click', (e) => {
      e.stopPropagation(); // Prevent map click event from firing
      customLayerPanel.classList.toggle('active');
    });
    // Close panel if clicked outside
    document.addEventListener('click', function(e) {
      if (!customLayerPanel.contains(e.target) && e.target !== customLayerToggleButton) {
        customLayerPanel.classList.remove('active');
      }
    });
  }

  // Handle clicks on custom layer options to mimic toggling Leaflet layers
  document.querySelectorAll('.layer-option').forEach(option => {
    option.addEventListener('click', function() {
      const layerDataId = this.dataset.layer;
      let targetLayer;

      // Determine if it's a base map or overlay
      if (layerDataId === 'osm' || layerDataId === 'esri' || layerDataId === 'carto') {
        // For base maps, remove all current base maps and add the selected one
        Object.values(baseMaps).forEach(layer => {
          if (maplabMapInstance.hasLayer(layer)) maplabMapInstance.removeLayer(layer);
        });
        if (layerDataId === 'osm') targetLayer = osmLayer;
        else if (layerDataId === 'esri') targetLayer = esriLayer;
        else if (layerDataId === 'carto') targetLayer = cartoLayer;

      } else {
        // For overlay layers, use the geoJsonLayers object
        targetLayer = geoJsonLayers[layerDataId];
      }

      if (targetLayer) {
        if (maplabMapInstance.hasLayer(targetLayer)) {
          maplabMapInstance.removeLayer(targetLayer);
          this.classList.remove('active');
        } else {
          maplabMapInstance.addLayer(targetLayer);
          this.classList.add('active');
        }
      }
      // For base maps, ensure only one is active visually in the custom panel
      if (layerDataId === 'osm' || layerDataId === 'esri' || layerDataId === 'carto') {
        document.querySelectorAll('.layer-option[data-layer="osm"], .layer-option[data-layer="esri"], .layer-option[data-layer="carto"]').forEach(baseOption => {
          baseOption.classList.remove('active');
        });
        this.classList.add('active');
      }
    });
  });

  // Event listeners for main tool buttons (Overlay, Marker, Shortest Path)
  document.querySelectorAll('.map-tool').forEach(tool => {
    tool.addEventListener('click', function() {
      // Hide all tool controls panels
      document.querySelectorAll('.tool-controls').forEach(el => {
        el.style.display = 'none';
      });

      // Remove all map click listeners to ensure only one is active at a time
      maplabMapInstance.off('click'); // Removes general map click listeners

      let isAnalysisTool = false;
      let controlPanelId;

      if (this.id === 'overlay-analysis') {
        controlPanelId = 'overlay-controls';
        maplabMapInstance.on('click', handleMapClickForOverlay);
        isAnalysisTool = true;
      } else if (this.id === 'marker-tool') { // Changed ID
        controlPanelId = 'marker-controls'; // Changed ID
        maplabMapInstance.off('click'); // Remove previous click handlers
        maplabMapInstance.on('click', handleMapClickForMarker); // Changed handler
        isAnalysisTool = true;
      } else if (this.id === 'shortest-path') {
        controlPanelId = 'shortest-path-controls';
        maplabMapInstance.on('click', handleMapClickForShortestPath);
        isAnalysisTool = true;
      }

      // Display the relevant control panel
      const controlPanel = document.getElementById(controlPanelId);
      if (controlPanel) {
        controlPanel.style.display = 'block';
      } else {
        console.error(`Control panel with ID "${controlPanelId}" not found.`);
      }

      // Toggle GeoJSON popups based on whether an analysis tool is active
      toggleGeoJsonPopups(!isAnalysisTool); // Disable popups if analysis tool is active

      // Always clear previous analysis states when switching tools
      clearAnalysisLayers(maplabMapInstance);
    });
  });

  console.log("Map initialized with all layers including Facilities and Tourism.");

  // Event listener for the "Run Overlay Analysis" button
  document.getElementById('run-overlay').addEventListener('click', runOverlayAnalysis);

  // Event listener for the "Clear Marker" button
  document.getElementById('clear-marker').addEventListener('click', resetMarkerTool);

  // Event listener for the "Calculate Road Density" button
  // This is correctly placed inside initMap to ensure the button exists when the listener is attached.
  const calculateDensityBtn = document.getElementById('run-road-density');
  if (calculateDensityBtn) {
      calculateDensityBtn.addEventListener('click', runRoadDensity);
  } else {
      console.error("Calculate Road Density button not found!");
  }

  // Initial state: ensure popups are enabled when map loads
  toggleGeoJsonPopups(true);
}

/**
 * Handles map clicks for Overlay Analysis, placing a marker and preparing for buffer creation.
 * @param {L.LeafletMouseEvent} e - The Leaflet map click event object.
 */
function handleMapClickForOverlay(e) {
  const clickedPoint = e.latlng;
  console.log("Map clicked for overlay analysis at:", clickedPoint);

  // Clear previous marker and buffer specific to overlay analysis
  if (overlayClickMarker) maplabMapInstance.removeLayer(overlayClickMarker);
  if (overlayBufferLayer) maplabMapInstance.removeLayer(overlayBufferLayer);

  // Add a marker for the clicked point
  overlayClickMarker = L.marker(clickedPoint).addTo(maplabMapInstance)
    .bindPopup("Analysis Point").openPopup();
}

/**
 * Performs Overlay Analysis: creates a buffer around a clicked point
 * and identifies intersecting features from various GeoJSON layers.
 */
function runOverlayAnalysis() {
  // Check if Turf.js is loaded
  if (typeof turf === 'undefined') {
    document.getElementById('result-content').innerHTML = '<p class="error-message">Error: Turf.js library not loaded. Cannot perform analysis.</p>';
    console.error("Turf.js is not loaded. Please include <script src='https://cdn.jsdelivr.net/npm/@turf/turf@6/turf.min.js'></script> in your HTML.");
    return;
  }

  const bufferRadius = parseInt(document.getElementById('buffer-radius').value);
  console.log("Running Overlay Analysis with buffer radius:", bufferRadius);

  if (!overlayClickMarker) {
    document.getElementById('result-content').innerHTML = '<p class="error-message">Please click on the map to set an analysis point first.</p>';
    console.warn("Overlay analysis: No click marker found.");
    return;
  }

  const centerPoint = turf.point([overlayClickMarker.getLatLng().lng, overlayClickMarker.getLatLng().lat]);
  // Buffer in km, so divide meters by 1000
  const buffered = turf.buffer(centerPoint, bufferRadius / 1000, {
    units: 'kilometers'
  });
  console.log("Buffered polygon created:", buffered);

  // Clear previous buffer layer
  if (overlayBufferLayer) maplabMapInstance.removeLayer(overlayBufferLayer);

  // Add the new buffer layer to the map
  overlayBufferLayer = L.geoJSON(buffered, {
    style: {
      color: '#3498db',
      weight: 2,
      opacity: 0.5,
      fillColor: '#3498db',
      fillOpacity: 0.2
    }
  }).addTo(maplabMapInstance);

  const resultContent = document.getElementById('result-content');
  let resultsHtml = `
      <div class="analysis-result">
        <h5>Overlay Analysis Results (Buffer: ${bufferRadius}m)</h5>
        <div class="result-metrics">
          <div class="metric"><span class="value">${bufferRadius}m</span><span class="label">Buffer Radius</span></div>
        </div>
        <div class="result-details">
    `;

  const dataLayersToAnalyze = {
    "Settlements": geoJsonLayers.settlements,
    "Roads": geoJsonLayers.roads,
    "Rivers": geoJsonLayers.rivers,
    "Tourism": geoJsonLayers.tourism,
    "Facilities": geoJsonLayers.facilities
  };

  let foundFeaturesCount = 0;

  for (const layerName in dataLayersToAnalyze) {
    const layer = dataLayersToAnalyze[layerName];
    // Ensure the GeoJSON layer has data before processing
    const featuresInLayer = layer.toGeoJSON();
    if (!featuresInLayer || !featuresInLayer.features || featuresInLayer.features.length === 0) {
      console.warn(`Layer "${layerName}" has no features loaded or is empty.`);
      resultsHtml += `<p>No ${layerName} data available.</p>`;
      continue; // Skip to the next layer
    }
    console.log(`Analyzing ${layerName} with ${featuresInLayer.features.length} features.`);


    const intersectingFeatures = turf.featureCollection(
      featuresInLayer.features.filter(feature => turf.booleanIntersects(feature, buffered))
    );

    if (intersectingFeatures.features.length > 0) {
      foundFeaturesCount += intersectingFeatures.features.length;
      resultsHtml += `<h6>${layerName} Found: ${intersectingFeatures.features.length}</h6><ul>`;
      intersectingFeatures.features.forEach(feature => {
        const name = feature.properties.name || feature.properties.Name || feature.properties.road_name || 'Unnamed Feature';
        resultsHtml += `<li>${name}</li>`;
      });
      resultsHtml += `</ul>`;

      // Highlight intersecting features on the map
      L.geoJSON(intersectingFeatures, {
        style: {
          color: '#2ecc71', // Highlight color
          weight: 5,
          opacity: 0.7,
          fillColor: '#2ecc71',
          fillOpacity: 0.4
        },
        pointToLayer: (feature, latlng) => L.circleMarker(latlng, {
          radius: 6,
          color: '#2ecc71',
          fillOpacity: 0.9
        })
      }).addTo(maplabMapInstance);

    } else {
      resultsHtml += `<p>No ${layerName} found within the buffer.</p>`;
    }
  }

  if (foundFeaturesCount === 0) {
    resultsHtml += '<p>No features found within the buffer for any selected data type.</p>';
  }

  resultsHtml += `
        </div>
      </div>
    `;
  resultContent.innerHTML = resultsHtml;
}


// ===== Real-time Map Initialization =====
/**
 * Initializes the real-time map, fetches AQI and weather data, and displays it.
 */
function initRealtimeMap() {
  const mapContainer = document.getElementById('realtime-map');
  if (!mapContainer) {
    console.error("Realtime map container not found!");
    return;
  }

  // Clear any existing map
  if (window.realtimeMap) {
    window.realtimeMap.remove();
  }

  // Create map instance, centered on Nepal
  // Approximate bounds for Nepal: SW: 26.347, 80.058; NE: 30.448, 88.201
  window.realtimeMap = L.map('realtime-map').fitBounds([
    [26.347, 80.058],
    [30.448, 88.201]
  ]);
  const map = window.realtimeMap; // Local reference to the real-time map instance

  // Define base layers
  const baseLayers = {
    "OpenStreetMap": L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors'
    }),
    "Esri Imagery": L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 19,
      attribution: 'Tiles &copy; Esri'
    }),
    "CartoDB Dark": L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 19,
      attribution: '&copy; CartoDB & OpenStreetMap'
    })
  };

  // Add default layer
  baseLayers["OpenStreetMap"].addTo(map);

  // Custom AQI icon
  const aqiIcon = L.icon({
    iconUrl: 'Images/Location.png', // Ensure this image path is correct
    iconSize: [40, 40],
    iconAnchor: [20, 40],
    popupAnchor: [0, -35]
  });

  /**
   * Determines AQI category and corresponding CSS class based on AQI value.
   * @param {number} aqi - The Air Quality Index value.
   * @returns {object} An object with 'level' (description) and 'class' (CSS class).
   */
  function getAqiCategory(aqi) {
    if (aqi <= 50) return {
      level: "Good",
      class: "aqi-good"
    };
    if (aqi <= 100) return {
      level: "Moderate",
      class: "aqi-moderate"
    };
    if (aqi <= 150) return {
      level: "Unhealthy for Sensitive Groups",
      class: "aqi-unhealthy-sensitive"
    };
    if (aqi <= 200) return {
      level: "Unhealthy",
      class: "aqi-unhealthy"
    };
    if (aqi <= 300) return {
      level: "Very Unhealthy",
      class: "aqi-very-unhealthy"
    };
    return {
      level: "Hazardous",
      class: "aqi-hazardous"
    };
  }

  /**
   * Fetches AQI and weather data and displays it on the real-time map.
   */
  function fetchAndDisplayData() {
    // Show loading indicator
    const loadingIndicator = L.divIcon({
      className: 'loading-indicator',
      html: '<div class="spinner"></div>', // Ensure .spinner CSS is defined
      iconSize: [40, 40]
    });

    // Get map center for loading marker
    const mapCenter = map.getCenter();
    const loadingMarker = L.marker(mapCenter, {
      icon: loadingIndicator,
      zIndexOffset: 1000
    }).addTo(map);

    // Clear existing markers (except the loading marker)
    map.eachLayer(layer => {
      if (layer instanceof L.Marker && layer !== loadingMarker) {
        map.removeLayer(layer);
      }
    });

    // Fetch AQI stations for Nepal's bounding box
    // Nepal bounds: SW: 26.347, 80.058; NE: 30.448, 88.201
    const nepalBounds = "27.347144,80.058815,30.446945,88.201530";
    // Using a placeholder token for WAQI API. Replace with a valid one if needed.
    // NOTE: This API key is publicly exposed. For production, consider a backend proxy.
    fetch(`https://api.waqi.info/map/bounds/?latlng=${nepalBounds}&token=2442d98dd891dbb9d5e21bfdea20fd18e4bdfeae`)
      .then(res => {
        if (!res.ok) {
          throw new Error(`WAQI API HTTP error! status: ${res.status}`);
        }
        return res.json();
      })
      .then(data => {
        map.removeLayer(loadingMarker); // Remove loading indicator

        if (!data.data || data.data.length === 0) {
          L.marker(mapCenter).addTo(map)
            .bindPopup(`<b>No AQI Stations Found for Nepal</b><br>Try zooming out or check back later`)
            .openPopup();
          return;
        }

        data.data.forEach(station => {
          const lat = station.lat;
          const lon = station.lon;
          const aqi = station.aqi;
          const uid = station.uid;
          const stationName = station.station ? station.station.name : `Station ${uid}`; // Use station name if available
          const aqiInfo = getAqiCategory(aqi);

          // Fetch weather data for each station
          // Using a placeholder token for OpenWeatherMap API. Replace with a valid one if needed.
          // NOTE: This API key is publicly exposed. For production, consider a backend proxy.
          fetch(`https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=7f09b2a738a1d65908e2ca4e002d9259&units=metric`)
            .then(res => {
              if (!res.ok) {
                throw new Error(`OpenWeatherMap API HTTP error! status: ${res.status}`);
              }
              return res.json();
            })
            .then(weather => {
              const temp = weather.main.temp;
              const humidity = weather.main.humidity;
              const pressure = weather.main.pressure;
              const condition = weather.weather[0].description;
              const windSpeed = weather.wind.speed;
              const iconCode = weather.weather[0].icon;
              const weatherIcon = `https://openweathermap.org/img/wn/${iconCode}.png`;

              // Create marker with detailed popup
              L.marker([lat, lon], {
                icon: aqiIcon
              }).addTo(map).bindPopup(`
                <div class="aqi-popup">
                  <div class="aqi-header">
                    <b>${stationName}</b><br>
                    <b>Air Quality:</b>
                    <span class="${aqiInfo.class}">${aqi} (${aqiInfo.level})</span>
                  </div>
                  <div class="weather-info">
                    <img src="${weatherIcon}" alt="${condition}">
                    <div>
                      <b>Condition:</b> ${condition}<br>
                      <b>Temp:</b> ${temp} °C<br>
                      <b>Humidity:</b> ${humidity}%<br>
                      <b>Pressure:</b> ${pressure} hPa<br>
                      <b>Wind:</b> ${windSpeed} m/s
                    </div>
                  </div>
                </div>
              `);
            })
            .catch(err => console.error("Weather fetch error for station:", stationName, err));
        });
      })
      .catch(err => {
        map.removeLayer(loadingMarker);
        L.marker(mapCenter).addTo(map)
          .bindPopup(`<b>Data Load Error</b><br>${err.message || 'Please try again later'}`)
          .openPopup();
        console.error("AQI fetch error:", err);
      });
  }

  // Initial data fetch
  fetchAndDisplayData();

  // Basemap controls for the real-time map
  const basemapToggle = document.getElementById('basemap-toggle');
  const basemapPanel = document.getElementById('basemap-panel');

  if (basemapToggle && basemapPanel) {
    basemapToggle.addEventListener('click', function(e) {
      e.stopPropagation();
      basemapPanel.classList.toggle('active');
    });

    document.querySelectorAll('.basemap-option').forEach(option => {
      option.addEventListener('click', function() {
        const basemap = this.dataset.basemap;
        Object.values(baseLayers).forEach(layer => map.removeLayer(layer));

        if (basemap === 'esri') baseLayers["Esri Imagery"].addTo(map);
        else if (basemap === 'carto') baseLayers["CartoDB Dark"].addTo(map);
        else baseLayers["OpenStreetMap"].addTo(map);

        basemapPanel.classList.remove('active');
      });
    });
  }

  // Refresh data button for AQI
  document.getElementById('refresh-data')?.addEventListener('click', fetchAndDisplayData);

  // Close basemap panel if clicked outside
  document.addEventListener('click', function(e) {
    if (basemapPanel && !basemapPanel.contains(e.target) && e.target !== basemapToggle) {
      basemapPanel.classList.remove('active');
    }
  });
}

// Road Density Calculation function
/**
 * Calculates and displays road density within a specified administrative boundary.
 * It filters roads based on the selected road type (e.g., primary, residential)
 * and calculates the total length of filtered roads within the boundary,
 * then divides by the boundary's area to get density.
 */


// Shortest Path Routing
// Re-using global variables: startPoint, endPoint, routingLayer

/**
 * Handles map clicks for shortest path calculation, setting start and end points.
 * @param {L.LeafletMouseEvent} e - The Leaflet map click event object.
 */
function handleMapClickForShortestPath(e) {
  const currentMap = this; // 'this' refers to the map instance when used with map.on('click')
  if (!startPoint) {
    startPoint = e.latlng;
    L.marker(startPoint).addTo(currentMap).bindPopup('Start Point').openPopup();
    document.getElementById('result-content').innerHTML = '<p>Start point set. Now click for the End Point.</p>';
  } else if (!endPoint) {
    endPoint = e.latlng;
    L.marker(endPoint).addTo(currentMap).bindPopup('End Point').openPopup();
    document.getElementById('result-content').innerHTML = '<p>End point set. Calculating shortest path...</p>';
    calculateShortestPath(currentMap);
  }
}

/**
 * Calculates and displays a simulated shortest path between two points.
 * NOTE: This is a simulated path, not a true routing algorithm.
 * @param {L.Map} mapInstance - The Leaflet map instance to draw the path on.
 */
function calculateShortestPath(mapInstance) {
  if (typeof turf === 'undefined') {
    document.getElementById('distance-value').textContent = 'Error';
    document.getElementById('result-content').innerHTML = '<p class="error-message">Error: Turf.js library not loaded. Cannot calculate shortest path.</p>';
    console.error("Turf.js is not loaded. Cannot calculate shortest path.");
    return;
  }

  if (!startPoint || !endPoint) {
    console.warn("Cannot calculate shortest path: Start or End point missing.");
    return;
  }

  // Calculate straight-line distance and add 50% for a simulated "road" distance
  const distance = (turf.distance(
    [startPoint.lng, startPoint.lat],
    [endPoint.lng, endPoint.lat], {
      units: 'kilometers'
    }
  ) * 1.5).toFixed(2);

  document.getElementById('distance-value').textContent = `${distance} km`;

  // Clear previous routing layer
  if (routingLayer) mapInstance.removeLayer(routingLayer);

  // Draw a simulated path with a bend for visual effect
  const path = turf.lineString([
    [startPoint.lng, startPoint.lat],
    [startPoint.lng + (endPoint.lng - startPoint.lng) / 3, startPoint.lat + (endPoint.lat - startPoint.lat) * 2 / 3], // Simulate a bend
    [endPoint.lng, endPoint.lat]
  ]);

  routingLayer = L.geoJSON(path, {
    style: {
      color: '#e74c3c', // Red color for the path
      weight: 4
    }
  }).addTo(mapInstance);

  document.getElementById('result-content').innerHTML = `<p>Shortest path calculated: ${distance} km.</p>`;
}

// Event listeners for shortest path control buttons
document.getElementById('clear-path').addEventListener('click', () => clearAnalysisLayers(maplabMapInstance));
document.getElementById('export-path').addEventListener('click', exportPath);

/**
 * Placeholder function for exporting the calculated path.
 */
function exportPath() {
  console.log("Export Path functionality to be implemented.");
  const resultContent = document.getElementById('result-content');
  resultContent.innerHTML = '<p class="info-message">Path export functionality is not yet implemented.</p>';
}


/**
 * Handles map clicks for the new Marker tool, placing a marker and displaying its coordinates.
 * @param {object} e - The Leaflet map click event object.
 */
function handleMapClickForMarker(e) {
  clearAnalysisLayers(maplabMapInstance); // Clear previous analysis/markers
  
  const latlng = e.latlng;
  currentMarker = L.marker(latlng).addTo(maplabMapInstance)
    .bindPopup(`<b>Marker Location</b><br>Lat: ${latlng.lat.toFixed(6)}<br>Lng: ${latlng.lng.toFixed(6)}`)
    .openPopup();

  const markerResults = document.getElementById('marker-results');
  if (markerResults) {
    markerResults.innerHTML = `<p><strong>Marker Coordinates</strong></p><p>Lat: ${latlng.lat.toFixed(6)}</p><p>Lng: ${latlng.lng.toFixed(6)}</p>`;
  }
}

/**
 * Resets the marker tool, clearing the current marker.
 */
function resetMarkerTool() {
  if (currentMarker && maplabMapInstance.hasLayer(currentMarker)) {
    maplabMapInstance.removeLayer(currentMarker);
    currentMarker = null;
  }
  document.getElementById('marker-results').innerHTML = '<p>Click on the map to set a marker</p>';
}


// ===== Navigation Functions =====
function toggleMenu() {
  const nav = document.querySelector('.navigate');
  nav.style.display = nav.style.display === 'flex' ? 'none' : 'flex';
}

// Smooth navigation
document.addEventListener('click', (e) => {
  const navLink = e.target.closest('.navigate a');
  if (!navLink) return;

  e.preventDefault();
  const targetId = navLink.getAttribute('href').replace('#', '');

  // Close mobile menu
  if (window.innerWidth <= 768) {
    document.querySelector('.navigate').style.display = 'none';
  }

  // Scroll to section
  window.scrollTo({
    top: 0,
    behavior: 'smooth'
  });

  // Highlight active link
  document.querySelectorAll('.navigate a').forEach(link => {
    link.classList.remove('active');
  });
  navLink.classList.add('active');
});

// Scroll spy
window.addEventListener('scroll', () => {
  const sections = document.querySelectorAll('main, div[id]');
  const navLinks = document.querySelectorAll('.navigate a');
  const scrollY = window.scrollY + 100;

  sections.forEach(sec => {
    const sectionTop = sec.offsetTop;
    const sectionHeight = sec.offsetHeight;

    if (scrollY >= sectionTop && scrollY < sectionTop + sectionHeight) {
      const id = sec.id;
      navLinks.forEach(link => {
        link.classList.toggle('active', link.getAttribute('href') === `#${id}`);
      });
    }
  });
});

// Responsive header
window.addEventListener('resize', () => {
  if (window.innerWidth > 768) {
    document.querySelector('.navigate').style.display = 'flex';
  }
});

// Mobile dropdown functionality
document.querySelectorAll('.dropdown .dropbtn').forEach(btn => {
  btn.addEventListener('click', function(e) {
    if (window.innerWidth <= 768) {
      e.preventDefault();
      const dropdown = this.parentElement;
      dropdown.classList.toggle('active');

      // Close other dropdowns
      document.querySelectorAll('.dropdown').forEach(d => {
        if (d !== dropdown) d.classList.remove('active');
      });
    }
  });
});

// Close dropdowns
document.addEventListener('click', function(e) {
  if (!e.target.closest('.dropdown') && window.innerWidth <= 768) {
    document.querySelectorAll('.dropdown').forEach(d => {
      d.classList.remove('active');
    });
  }
});

// ===== Involvements Animation =====
function animateInvolvements() {
  const timelineItems = document.querySelectorAll('.timeline-content');

  if (timelineItems.length === 0) return;

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.style.opacity = "1";
        entry.target.style.transform = "translateY(0)";
      }
    });
  }, {
    threshold: 0.1
  });

  timelineItems.forEach(item => {
    item.style.transition = "opacity 0.6s ease, transform 0.6s ease";
    observer.observe(item);
  });
}




// ===== Contact Form Submission =====
function initContactForm() {
  const contactForm = document.getElementById('contactForm');
  if (!contactForm) return;

  const submitBtn = contactForm.querySelector('button[type="submit"]');
  const statusMessage = document.getElementById('statusMessage');

  contactForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    // Show loading state
    const originalBtnText = submitBtn.innerHTML;
    submitBtn.innerHTML = '<i class="bx bx-loader bx-spin"></i> Sending...';
    submitBtn.disabled = true;
    statusMessage.style.display = 'none';

    try {
      // Send form data to Formspree
      const formData = new FormData(contactForm);
      const response = await fetch(contactForm.action, {
        method: 'POST',
        body: formData,
        headers: {
          'Accept': 'application/json'
        }
      });

      if (response.ok) {
        // Show success message
        statusMessage.textContent = "Message sent successfully! I'll get back to you soon.";
        statusMessage.className = "status-message success";
        statusMessage.style.display = 'block';

        // Reset form
        contactForm.reset();
      } else {
        const data = await response.json();
        if (data.errors) {
          statusMessage.textContent = data.errors.map(error => error.message).join(", ");
        } else {
          statusMessage.textContent = "Oops! There was a problem sending your message.";
        }
        statusMessage.className = "status-message error";
        statusMessage.style.display = 'block';
      }
    } catch (error) {
      statusMessage.textContent = "Oops! There was a problem sending your message.";
      statusMessage.className = "status-message error";
      statusMessage.style.display = 'block';
    } finally {
      // Restore button state
      submitBtn.innerHTML = originalBtnText;
      submitBtn.disabled = false;

      // Scroll to show the status message
      statusMessage.scrollIntoView({
        behavior: 'smooth',
        block: 'center'
      });
    }
  });
}

// Call initContactForm when the window loads, assuming the contact form is part of the initial HTML
window.addEventListener('DOMContentLoaded', initContactForm);
