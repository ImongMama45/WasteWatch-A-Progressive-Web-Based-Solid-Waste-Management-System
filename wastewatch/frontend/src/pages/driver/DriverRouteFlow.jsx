/**
 * DriverRouteFlow.jsx
 * -------------------
 * State machine for the full driver shift workflow.
 *
 * Full flow:
 *   assignment → navigate_to_base → confirm_start → checkin → shiftroute → end_shift
 *
 * Once the route map is mounted, later route states render as overlays inside
 * ShiftRouteModule so its Leaflet map, GPS watcher, and marker colours stay alive.
 */

import { useState, useEffect, useRef } from 'react'
import { useAuth } from '../../context/AuthContext'
import { DriverGpsProvider } from '../../context/DriverGpsContext'
import AssignmentModule from './components/AssignmentModule'
import NavigateToBaseModule from './components/NavigateToBaseModule'
import ConfirmStartModule from './components/ConfirmStartModule'
import CheckInModule from './components/CheckInModule'
import ShiftRouteModule from './components/ShiftRouteModule'
import { clearDriverSessionData } from '../../hooks/useShiftTimer'

const ROUTE_MAP_STATES = ['shiftroute', 'navigating', 'arrived', 'completed', 'end_shift']
const ALL_KNOWN_STATES = ['assignment', 'navigate_to_base', 'confirm_start', 'checkin', ...ROUTE_MAP_STATES]

export default function DriverRouteFlow() {
  const { user } = useAuth()
  const prevUserIdRef = useRef(user?.id)

  const [routeState, setRouteState] = useState(
    () => sessionStorage.getItem('ww_route_state') || 'assignment'
  )

  // If a different driver logs in on the same tab, clear all route session data
  // and reset to assignment so they start fresh.
  useEffect(() => {
    if (prevUserIdRef.current != null && prevUserIdRef.current !== user?.id) {
      clearDriverSessionData()
      sessionStorage.removeItem('ww_route_state')
      setRouteState('assignment')
    }
    prevUserIdRef.current = user?.id
  }, [user?.id])

  // Persist route state for ROUTE_MAP_STATES (so page refresh doesn't reset the map)
  useEffect(() => {
    if (ROUTE_MAP_STATES.includes(routeState)) {
      sessionStorage.setItem('ww_route_state', routeState)
    } else {
      sessionStorage.removeItem('ww_route_state')
    }
  }, [routeState])

  return (
    <DriverGpsProvider>
      {routeState === 'assignment' && (
        <AssignmentModule setRouteState={setRouteState} />
      )}
      {routeState === 'navigate_to_base' && (
        <NavigateToBaseModule setRouteState={setRouteState} />
      )}
      {routeState === 'confirm_start' && (
        <ConfirmStartModule setRouteState={setRouteState} />
      )}
      {routeState === 'checkin' && (
        <CheckInModule setRouteState={setRouteState} />
      )}
      {ROUTE_MAP_STATES.includes(routeState) && (
        <ShiftRouteModule routeState={routeState} setRouteState={setRouteState} />
      )}
      {/* Fallback for any unknown state */}
      {!ALL_KNOWN_STATES.includes(routeState) && (
        <AssignmentModule setRouteState={setRouteState} />
      )}
    </DriverGpsProvider>
  )
}
