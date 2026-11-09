# Context: Upgrading PublicMap.jsx to a Transparency Portal
We are working on WasteWatch (React + Django REST). We recently created `PublicMap.jsx` as a secure, public-facing alternative to our admin map. Right now, it just shows the user's location, the nearest truck, nearest dumpsite, and the user's own reports. 

We now want to expand this into a true **Citizen Transparency Portal** where citizens can evaluate data on their own accord. We want to add barangay geofencing, public hotspots (all approved reports), and live collection progress per barangay, but we must strictly dial down the data to ensure no sensitive telemetry or PII leaks.

My AI pair programmer has drafted the following Implementation Plan. **I need you to review this plan critically as a Senior Staff Engineer.**

---

### The Proposed Implementation Plan:
**1. Data Integration (The "Transparency" Layer)**
- **Barangay Geofencing**: Import the `LUCENA_BARANGAYS` GeoJSON to draw the borders of each barangay.
- **Public Hotspots**: Fetch `/api/watcher/reports/map_pins/` to show ALL approved reports across the city (not just the user's own).
- **Collection Progress**: Fetch `/api/driver/shift/barangay_stops/` to see which barangays are currently being collected and their progress (e.g., 5/10 stops completed).
- **Barangay Stats**: Use the existing `barangays` array from `AuthContext` to get population and demographic data.

**2. UI & Interaction Design**
- **Interactive Boundaries**: The barangay polygons will be lightly shaded. Clicking a barangay will highlight it and open a summary panel.
- **Citizen Zone Panel**: A dialed-down version of the admin `ZonePanel`. When a citizen taps a barangay, they will see:
  - Demographics: Barangay Name & Population.
  - Live Collection Status: e.g., "Currently Collecting: 45% Complete" or "No active collection".
  - Report Analytics: "3 Open Hotspots in this area".
- **Map Layers / Filters**: A new floating "Filters" button (top right) allowing citizens to toggle:
  - Barangay Boundaries
  - Public Hotspots (Approved issues)
  - Active Trucks & Dumpsites
  - Collection Stops (Specific garbage pickup points)

**3. Privacy & Security Constraints ("Dialing it down")**
- **Hotspots**: Public pins will ONLY show Issue Type, Description, and Date. They will NOT show the reporter's name or contact info.
- **Trucks/Stops**: Collection stops will only show as generic dots (Pending vs. Collected). No driver names, no truck plates, and no exact route lines.
- **Authentication**: All endpoints used (`map_pins`, `barangay_stops`) are already set to `AllowAny` in the backend, meaning this map remains fully accessible to anonymous visitors.

---

### Questions for Your Review:
Please review the plan above and provide feedback on the following:

1. **Performance & Polling:** `PublicMap.jsx` will now poll `/api/driver/shift/barangay_stops/` and `/api/watcher/reports/map_pins/`. If this page is public, what are the performance implications? Should we avoid polling these entirely, or scale the intervals?
2. **Vanilla Leaflet (`window.L`) State Management:** We are using vanilla Leaflet via a `useRef` (not `react-leaflet`). When handling `L.geoJSON` for barangay boundaries and click events, what are the React state synchronization traps we need to avoid to prevent stale closures or memory leaks?
3. **Data Leakage:** Even though we are hiding driver names on the frontend, are there risks to pulling `/api/driver/shift/barangay_stops/` publicly? Should we reconsider how that data is served?
4. **UX / Mobile Design:** Adding filters, polygons, and a `CitizenZonePanel` risks cluttering the mobile view. What is the cleanest way to structure this UI?

*Please be brutally honest. If a part of this plan introduces a regression or a bad architectural pattern, tell me how to fix it before we start coding.*
