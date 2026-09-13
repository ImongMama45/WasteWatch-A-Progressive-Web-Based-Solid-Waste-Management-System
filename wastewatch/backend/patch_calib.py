import re

file_path = r"d:\Coding\Waste Watch\wastewatch\frontend\src\pages\driver\components\CalibrationCelebrationModule.jsx"
with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

# Replace map logic
content = re.sub(r'useEffect\(\(\) => \{\s+if \(!mapRef\.current.*?\},\s*\[missedStops\]\)', '', content, flags=re.DOTALL)

# Add RouteCompletionMiniMap import
if "import RouteCompletionMiniMap" not in content:
    content = content.replace("import { useState, useEffect, useRef, useMemo } from 'react'", "import { useState, useEffect, useRef, useMemo } from 'react'\nimport RouteCompletionMiniMap from './RouteCompletionMiniMap'")

# Replace map render block
old_map = """          {missedStops.length > 0 && (
            <div style={{
              background: 'rgba(255, 255, 255, 0.85)', backdropFilter: 'blur(12px)',
              borderRadius: 20, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.5)',
              boxShadow: '0 4px 24px rgba(0,0,0,0.04)',
              animation: 'slideUpCard 0.5s ease-out 0.4s both'
            }}>
              <div style={{ padding: '16px 20px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 28, height: 28, borderRadius: 8, background: '#fef2f2', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ef4444' }}>
                  <MapPinIcon />
                </div>
                <div style={{ fontFamily: 'var(--font-head)', fontSize: 15, fontWeight: 800, color: '#0f172a' }}>
                  Uncollected Areas
                </div>
              </div>
              <div ref={mapRef} style={{ width: '100%', height: 160, background: '#e2e8f0' }} />
            </div>
          )}"""

new_map = """          {schedule?.waypoints && (
            <div style={{
              background: 'rgba(255, 255, 255, 0.85)', backdropFilter: 'blur(12px)',
              borderRadius: 20, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.5)',
              boxShadow: '0 4px 24px rgba(0,0,0,0.04)',
              animation: 'slideUpCard 0.5s ease-out 0.4s both'
            }}>
              <div style={{ padding: '16px 20px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 28, height: 28, borderRadius: 8, background: '#f8fafc', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#334155' }}>
                  <MapPinIcon />
                </div>
                <div style={{ fontFamily: 'var(--font-head)', fontSize: 15, fontWeight: 800, color: '#0f172a' }}>
                  Route Receipt
                </div>
              </div>
              <div style={{ padding: 12 }}>
                <RouteCompletionMiniMap schedule={schedule} stopStatuses={stopStatuses} />
              </div>
            </div>
          )}"""

content = content.replace(old_map, new_map)

with open(file_path, 'w', encoding='utf-8') as f:
    f.write(content)

print("CalibrationCelebrationModule.jsx patched successfully.")
