/**
 * DriverRouteFlow.jsx
 * -------------------
 * State machine for the full driver shift workflow.
 *
 * Stages:
 *  assignment   → duty type selection
 *  checkin      → GPS init + session validation (automatic)
 *  shiftroute   → route map preview + "START ROUTE"
 *  navigating   → live navigation UI (core driver screen)
 *  arrived      → stop arrival confirmation + collection note
 *  completed    → stop completed decision (Next Stop / End Shift)
 *  end_shift    → end-of-day summary (TODO)
 *
 * Resume support:
 *  On mount, reads sessionStorage('ww_route_state') to
 *  jump straight to 'navigating' if driver is returning mid-shift.
 */

import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import AssignmentModule from './components/AssignmentModule'
import CheckInModule from './components/CheckInModule'
import ShiftRouteModule from './components/ShiftRouteModule'
import NavigationModule from './components/NavigationModule'
import ArrivedModule from './components/ArrivedModule'
import StopCompletedModule from './components/StopCompletedModule'
import EndShiftModule from './components/EndShiftModule'

export default function DriverRouteFlow() {
  const navigate = useNavigate()

  // Resume mid-shift if driver navigated away from navigating screen
  const savedState = sessionStorage.getItem('ww_route_state')
  const [routeState, setRouteState] = useState(
    () => sessionStorage.getItem('ww_route_state') || 'assignment'
  )

  // Persist current route state so we can resume
  useEffect(() => {
    if (routeState === 'navigating' || routeState === 'arrived') {
      sessionStorage.setItem('ww_route_state', routeState)
    }
  }, [routeState])

  if (routeState === 'assignment') {
    return <AssignmentModule setRouteState={setRouteState} />
  }

  if (routeState === 'checkin') {
    return <CheckInModule setRouteState={setRouteState} />
  }

  if (routeState === 'shiftroute') {
    return <ShiftRouteModule setRouteState={setRouteState} />
  }

  if (routeState === 'navigating') {
    return <NavigationModule setRouteState={setRouteState} />
  }

  if (routeState === 'arrived') {
    return <ArrivedModule setRouteState={setRouteState} />
  }

  if (routeState === 'completed') {
    return <StopCompletedModule setRouteState={setRouteState} />
  }

  // end_shift — EndShiftModule handles both early termination and route completed scenarios
  if (routeState === 'end_shift') {
    return <EndShiftModule setRouteState={setRouteState} />
  }
}
