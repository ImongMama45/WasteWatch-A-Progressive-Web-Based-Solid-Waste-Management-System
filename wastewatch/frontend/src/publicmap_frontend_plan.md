# PublicMap.jsx Frontend Implementation Plan

Here is the exact plan and code diffs for wiring up the new endpoints safely into `PublicMap.jsx`, explicitly dodging the Leaflet stale-closure and re-rendering traps.

## 1. Polling & Data Strategy
We will introduce three tiers of data fetching:
- **Static (`LUCENA_BARANGAYS`)**: Loaded directly from local JSON on mount to draw the polygons.
- **Global Polling (60s - `map_pins`)**: Fetches all approved public hotspots.
- **Global Polling (30s - `barangay_summary`)**: Fetches our new aggregated endpoint so we can color-code the barangay polygons if they are actively being collected.
- **On-Demand Fetching (`barangay_stops`)**: We will only fetch the raw collection stops for a specific barangay when a citizen taps on that barangay's polygon.

## 2. GeoJSON Layer & Stale Closure Prevention
Instead of recreating the `L.geoJSON` layer every time the `barangay_summary` updates or the user toggles a filter, we will initialize it **once** and use `layer.setStyle()` and refs to handle dynamic updates.

### The Ref Pattern (Dodging the Trap)
```javascript
// We store the latest summary data in a ref so the GeoJSON event listeners can read it
// without forming a stale closure over old React state.
const summaryRef = useRef([])
useEffect(() => {
  summaryRef.current = barangaySummary
  // Trigger a visual re-style of the existing geoJson layer without destroying it
  if (geoJsonLayerRef.current) {
    geoJsonLayerRef.current.setStyle(styleFeature)
  }
}, [barangaySummary])

// Click Handler that relies on the feature properties, not closures
const onFeatureClick = useCallback((e) => {
    const name = e.target.feature.properties.NAME
    setSelectedZone(name)
    // Only fetch the heavy raw stops when actually clicked
    fetchRawStopsForBarangay(name)
}, [])
```

## 3. Unified Filters & Legend UI
As you suggested, having two floating cards competing for space on mobile is bad UX. We will merge them into a single "Layers & Legend" control at the top right.

```jsx
const [showLayers, setShowLayers] = useState(false)
const [filters, setFilters] = useState({
  boundaries: true,
  hotspots: true,
  trucks: true
})

// Inside render:
<div className="absolute top-4 right-4 z-[1000]">
  <button onClick={() => setShowLayers(!showLayers)}>Layers</button>
  {showLayers && (
     <div className="card">
        {/* Toggle Switches with inline legends (e.g. Red = Hotspot, Blue = Truck) */}
     </div>
  )}
</div>
```

## 4. The CitizenZonePanel
We will expand the existing `SelectedPanel` (the bottom sheet) to handle a `type: 'zone'` state.

When `selected.type === 'zone'`, we pull the demographic data from `AuthContext`, the collection summary from `summaryRef.current`, and render a clean, citizen-friendly view:
```jsx
// Deriving the display state safely as requested:
const getCollectionStatus = (summary) => {
  if (!summary) return 'No active collection'
  if (summary.completed_stops >= summary.total_stops && summary.total_stops > 0) {
    return 'Completed'
  }
  return summary.is_active ? `Collecting — ${summary.completed_stops}/${summary.total_stops}` : 'No active collection'
}
```

## 5. Marker Diffing
For public hotspots, we will reuse the exact same diffing pattern already implemented for Trucks/Dumpsites:
```javascript
// Loop through new pins, add missing ones, update positions of existing ones.
// Loop through old pins, remove ones that no longer exist in the new payload.
```
This ensures we don't leak memory or stack duplicate click handlers over multiple polls.

---
If this architectural approach looks solid, I will apply these changes directly to `PublicMap.jsx`!
