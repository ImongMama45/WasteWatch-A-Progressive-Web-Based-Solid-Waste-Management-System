import os
file_path = r"d:\Coding\Waste Watch\wastewatch\frontend\src\components\MiniMap.jsx"
with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

content = content.replace("export default function MiniMap({ height = 260 }) {", "export default function MiniMap({ height = 260, focusCoordinate = null }) {")

target = """  function closePanel() { setPanelType(null); setSelectedTruck(null); setSelectedReport(null) }"""

replacement = """  function closePanel() { setPanelType(null); setSelectedTruck(null); setSelectedReport(null) }

  useEffect(() => {
    if (focusCoordinate && focusCoordinate.lat && focusCoordinate.lng && mapInstanceRef.current) {
      mapInstanceRef.current.setView([focusCoordinate.lat, focusCoordinate.lng], focusCoordinate.zoom || 16)
    }
  }, [focusCoordinate])
"""

content = content.replace(target, replacement)

with open(file_path, 'w', encoding='utf-8') as f:
    f.write(content)
print("MiniMap updated.")
