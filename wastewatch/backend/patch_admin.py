import os
file_path = r"d:\Coding\Waste Watch\wastewatch\frontend\src\pages\dashboard\AdminDashboard.jsx"
with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Add mapFocus state
target1 = """  const [routeDisplayMode, setRouteDisplayMode] = useState('all');"""
replacement1 = """  const [routeDisplayMode, setRouteDisplayMode] = useState('all');
  const [mapFocus, setMapFocus] = useState(null);"""
content = content.replace(target1, replacement1)

# 2. Pass to MiniMap
target2 = """        <div className="map-section">
          <MiniMap />
        </div>"""
replacement2 = """        <div className="map-section">
          <MiniMap focusCoordinate={mapFocus} />
        </div>"""
content = content.replace(target2, replacement2)

# 3. Use it in Hotspots button
target3 = """                    <button style={{
                      background: "#F1F5F9", border: "none", borderRadius: 6,
                      padding: "4px 8px", fontSize: 11, fontWeight: 600, cursor: "pointer", color: "#2563EB"
                    }} onClick={() => showToast("Pan map to " + h.barangay_name)}>Map</button>"""
replacement3 = """                    <button style={{
                      background: "#F1F5F9", border: "none", borderRadius: 6,
                      padding: "4px 8px", fontSize: 11, fontWeight: 600, cursor: "pointer", color: "#2563EB"
                    }} onClick={() => setMapFocus({ lat: h.latitude || h.lat, lng: h.longitude || h.lng, zoom: 16 })}>Map</button>"""
content = content.replace(target3, replacement3)

with open(file_path, 'w', encoding='utf-8') as f:
    f.write(content)
print("AdminDashboard updated.")
