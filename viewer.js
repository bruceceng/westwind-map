// viewer.js - Verbose Diagnostic Version
(async function initOfflineMap() {
  // Inject floating UI log container
  const logContainer = document.createElement('div');
  logContainer.id = 'debug-log';
  logContainer.style.cssText = `
    position: fixed;
    top: 10px;
    left: 10px;
    z-index: 999999;
    background: rgba(0, 0, 0, 0.85);
    color: #00ff66;
    font-family: monospace;
    font-size: 12px;
    padding: 12px;
    border-radius: 6px;
    max-width: 420px;
    max-height: 350px;
    overflow-y: auto;
    box-shadow: 0 4px 12px rgba(0,0,0,0.5);
    pointer-events: none;
  `;
  document.body.appendChild(logContainer);

  function log(msg, isError = false) {
    const timestamp = new Date().toLocaleTimeString();
    const formatted = `[${timestamp}] ${msg}`;
    if (isError) {
      console.error(formatted);
    } else {
      console.log(formatted);
    }
    const line = document.createElement('div');
    if (isError) line.style.color = '#ff5555';
    line.innerText = formatted;
    logContainer.appendChild(line);
    logContainer.scrollTop = logContainer.scrollHeight;
  }

  log("Starting MapLibre diagnostic loader...");

  // 1. Verify Base64 Payload
  if (!window.MAP_TILES_BASE64) {
    log("ERROR: 'tiles_data.js' is not loaded or missing MAP_TILES_BASE64!", true);
    return;
  }
  log(`Base64 string detected (${(window.MAP_TILES_BASE64.length / 1024 / 1024).toFixed(2)} MB)`);

  // 2. Unpack ZIP
  let zip, zipData;
  try {
    zip = new JSZip();
    zipData = await zip.loadAsync(window.MAP_TILES_BASE64, { base64: true });
    log("ZIP successfully unpacked into RAM.");
  } catch (err) {
    log(`ZIP Extraction Error: ${err.message}`, true);
    return;
  }

  // 3. Inspect Zip Files
  const allFiles = Object.keys(zipData.files);
  log(`Total files inside ZIP: ${allFiles.length}`);
  if (allFiles.length > 0) {
    log(`Sample file path in ZIP: "${allFiles[0]}"`);
  }

  // Find a valid tile to extract Z/X/Y coordinates
  const tileFileKey = allFiles.find(k => k.match(/(\d+)_(\d+)_(\d+)\.pbf$/));
  
  let initLng = -123.98255;
  let initLat = 45.02277;
  let initZoom = 13;

  if (tileFileKey) {
    const match = tileFileKey.match(/(\d+)_(\d+)_(\d+)\.pbf$/);
    if (match) {
      const z = parseInt(match[1]);
      const x = parseInt(match[2]);
      const y = parseInt(match[3]);

      initLng = (x / Math.pow(2, z)) * 360 - 180;
      const n = Math.PI - (2 * Math.PI * y) / Math.pow(2, z);
      initLat = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
      initZoom = z;
      log(`Calculated center from tile: [${initLng.toFixed(4)}, ${initLat.toFixed(4)}] @ Zoom ${initZoom}`);
    }
  } else {
    log("WARNING: Could not find any .pbf files with {z}_{x}_{y}.pbf naming pattern in ZIP!", true);
  }

  // 4. Register Protocol Interceptor with Logging
  let tileRequestCount = 0;
  let tileHitCount = 0;
  let tileMissCount = 0;

  maplibregl.addProtocol('zip', async (params) => {
    tileRequestCount++;
    const match = params.url.match(/zip:\/\/(\d+)\/(\d+)\/(\d+)/);
    if (!match) {
      return { data: new Uint8Array() };
    }

    const [, z, x, y] = match;
    const path1 = `tiles/${z}_${x}_${y}.pbf`;
    const path2 = `${z}_${x}_${y}.pbf`;

    const tileFile = zipData.file(path1) || zipData.file(path2);

    if (tileFile) {
      tileHitCount++;
      const buffer = await tileFile.async('arraybuffer');
      if (tileHitCount <= 5) {
        log(`Tile HIT: ${z}/${x}/${y} (${buffer.byteLength} bytes)`);
      }
      return { data: new Uint8Array(buffer) };
    } else {
      tileMissCount++;
      if (tileMissCount <= 5) {
        log(`Tile MISS: ${z}/${x}/${y} (Not found in ZIP)`, true);
      }
      return { data: new Uint8Array() };
    }
  });

  // 5. Define Basic Vector Style
  const style = {
    version: 8,
    sources: {
      'offline-zip-tiles': {
        type: 'vector',
        tiles: ['zip://{z}/{x}/{y}']
      }
    },
    layers: [
      {
        id: 'background',
        type: 'background',
        paint: { 'background-color': '#f8f4f0' }
      },
      {
        id: 'water',
        type: 'fill',
        source: 'offline-zip-tiles',
        'source-layer': 'water',
        paint: { 'fill-color': '#a0c8f0' }
      },
      {
        id: 'landuse',
        type: 'fill',
        source: 'offline-zip-tiles',
        'source-layer': 'landuse',
        paint: { 'fill-color': '#e0e8e0', 'fill-opacity': 0.5 }
      },
      {
        id: 'roads',
        type: 'line',
        source: 'offline-zip-tiles',
        'source-layer': 'transportation',
        paint: {
          'line-color': '#ffffff',
          'line-width': 2
        }
      },
      {
        id: 'building',
        type: 'fill',
        source: 'offline-zip-tiles',
        'source-layer': 'building',
        paint: {
          'fill-color': '#d9d0c7',
          'fill-outline-color': '#cdbdae'
        }
      }
    ]
  };

  // 6. Initialize Map and Listen for Errors
  log("Initializing MapLibre instance...");
  const map = new maplibregl.Map({
    container: 'map',
    style: style,
    center: [initLng, initLat],
    zoom: initZoom
  });

  map.on('load', () => {
    log("Map 'load' event fired successfully!");
  });

  map.on('error', (e) => {
    log(`MapLibre Internal Error: ${e.error ? e.error.message : JSON.stringify(e)}`, true);
  });

  map.addControl(new maplibregl.NavigationControl());
})();