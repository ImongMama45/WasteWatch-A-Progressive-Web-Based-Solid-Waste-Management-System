/**
 * DriverRouteFlow.jsx
 * -------------------
 * State machine for the full driver shift workflow.
 *
 * Once the route map is mounted, later route states render as overlays inside
 * ShiftRouteModule so its Leaflet map, GPS watcher, and marker colours stay alive.
 */

import { useState, useEffect } from 'react'
import { DriverGpsProvider } from '../../context/DriverGpsContext'
import AssignmentModule from './components/AssignmentModule'
import CheckInModule from './components/CheckInModule'
import ShiftRouteModule from './components/ShiftRouteModule'

const ROUTE_MAP_STATES = ['shiftroute', 'navigating', 'arrived', 'completed', 'end_shift']

export default function DriverRouteFlow() {
  const [routeState, setRouteState] = useState(
    () => sessionStorage.getItem('ww_route_state') || 'assignment'
  )

  useEffect(() => {
    if (ROUTE_MAP_STATES.includes(routeState)) {
      sessionStorage.setItem('ww_route_state', routeState)
    }
  }, [routeState])

  return (
    <DriverGpsProvider>
      {routeState === 'assignment' && (
        <AssignmentModule setRouteState={setRouteState} />
      )}
      {routeState === 'checkin' && (
        <CheckInModule setRouteState={setRouteState} />
      )}
      {ROUTE_MAP_STATES.includes(routeState) && (
        <ShiftRouteModule routeState={routeState} setRouteState={setRouteState} />
      )}
      {!['assignment', 'checkin', ...ROUTE_MAP_STATES].includes(routeState) && (
        <AssignmentModule setRouteState={setRouteState} />
      )}
    </DriverGpsProvider>
  )
}
