# PublicMap Enhancement Plan

## Objective
Transform `PublicMap.jsx` from a simple "find my truck" map into a comprehensive, citizen-facing transparency portal. We will introduce Geofencing (Barangay boundaries), public hotspots, and barangay-level analytics, while strictly maintaining privacy (dialing down sensitive data).

## 1. Data Integration (The "Transparency" Layer)
We will add the following data sources to the map:
- **Barangay Geofencing**: Import the `LUCENA_BARANGAYS` GeoJSON to draw the borders of each barangay.
- **Public Hotspots**: Fetch `/api/watcher/reports/map_pins/` to show ALL approved reports across the city (not just the user's own).
- **Collection Progress**: Fetch `/api/driver/shift/barangay_stops/` to see which barangays are currently being collected and their progress (e.g., 5/10 stops completed).
- **Barangay Stats**: Use the existing `barangays` array from `AuthContext` to get population and demographic data.

## 2. UI & Interaction Design
- **Interactive Boundaries**: The barangay polygons will be lightly shaded. Clicking a barangay will highlight it and open a summary panel.
- **Citizen Zone Panel**: A dialed-down version of the admin `ZonePanel`. When a citizen taps a barangay, they will see:
  - **Demographics**: Barangay Name & Population.
  - **Live Collection Status**: e.g., "Currently Collecting: 45% Complete" or "No active collection".
  - **Report Analytics**: "3 Open Hotspots in this area".
- **Map Layers / Filters**: A new floating "Filters" button (top right) allowing citizens to toggle:
  - [x] Barangay Boundaries
  - [x] Public Hotspots (Approved issues)
  - [x] Active Trucks & Dumpsites
  - [ ] Collection Stops (Specific garbage pickup points)

## 3. Privacy & Security Constraints ("Dialing it down")
To ensure this remains safe for public consumption:
- **Hotspots**: Public pins will ONLY show Issue Type, Description, and Date. They will NOT show the reporter's name or contact info.
- **Trucks/Stops**: Collection stops will only show as generic dots (Pending vs. Collected). No driver names, no truck plates, and no exact route lines.
- **Authentication**: All endpoints used (`map_pins`, `barangay_stops`) are already set to `AllowAny` in the backend, meaning this map remains fully accessible to anonymous visitors.

## 4. Step-by-Step Execution
1. **Refactor Map Initialization**: Update `PublicMap.jsx` to load `L.geoJSON` for the barangay boundaries and handle polygon click events.
2. **Implement Data Fetching**: Add `useEffect` hooks to poll `/api/watcher/reports/map_pins/` and `/api/driver/shift/barangay_stops/`.
3. **Build the `CitizenZonePanel`**: Create the UI component that displays the aggregated data when a barangay is clicked.
4. **Build the Layers Control**: Add a dropdown/modal UI to toggle the visibility of the different map elements (Hotspots, Boundaries, Trucks).
5. **Marker Optimization**: Ensure the map doesn't become visually overwhelming by using distinct, clean icons and respecting the active layer toggles.
