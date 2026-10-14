# Context: WasteWatch System
We are building WasteWatch, a Progressive Web-Based Solid Waste Management System for Lucena City (React + Django REST Framework). 

Recently, we realized that our primary map component (`MapView.jsx`) was over-exposing sensitive data to the public (e.g., driver names, truck plate numbers, internal route telemetry, and other citizens' unapproved reports). To fix this, we completely locked down `/map` behind a role-gated `PrivateRoute` so it's strictly for Admins, Barangay Officials, and Watchers.

# The Problem
Because we locked down the main map, Citizens no longer have a map to track their garbage trucks or view their submitted reports. 

We have scaffolded a new, secure component called `PublicMap.jsx` at the `/public-map` route. **Your task is to help architect and write the implementation logic for `PublicMap.jsx`.** 

# Requirements for `PublicMap.jsx`
The citizen map must be strictly scoped to avoid data leakage. It should do the following:
1. **User Location:** Use the existing `useUserLocation` hook to get the citizen's browser GPS coordinates. (This hook safely watches `navigator.geolocation` without syncing to the backend).
2. **Citizen's Own Reports:** Fetch and plot ONLY the authenticated user's own reports using our existing backend endpoint: `/api/watcher/reports/mine/`.
3. **Nearest Truck & Dumpsite:** Fetch active trucks and dumpsites, but calculate and visibly highlight ONLY the *nearest* truck and *nearest* dumpsite relative to the user's location.
4. **No Sensitive Data:** Do not display driver names, plate numbers, or citywide heatmaps.
5. **Map Engine:** We are using vanilla Leaflet (`window.L`) rendered via a `useRef` (not `react-leaflet`), matching the existing architectural pattern of our app.

# Attached Files
*Please review the attached files before proposing the implementation:*

1. **`src/pages/PublicMap.jsx`** - The current "Coming Soon" scaffold. We need you to implement the actual Leaflet logic and data fetching here.
2. **`src/hooks/useUserLocation.js`** - The hook to get the user's GPS coordinates.
3. **`src/pages/MapView.jsx`** - (Reference only) Please review how `window.L` map initialization, cleanup, and marker rendering is handled in our system. You can reuse the UI patterns, but adapt them for the strict citizen constraints.
4. **`backend/watcher/views.py`** - (Reference only) Notice the `mine` action on the `GarbageReportViewSet` that returns the user's personal reports.

Please act as an expert UI/UX and React Architect. Review these requirements and provide a step-by-step implementation plan and the updated code for `PublicMap.jsx`.
