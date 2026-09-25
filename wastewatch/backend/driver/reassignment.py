"""
reassignment.py — DELETED

This module has been replaced by driver.missed_stop_service.

Historical context:
- Used PickupStatus + threading to attempt reassignment to nearby extended drivers.
- Was fundamentally broken: status flip from DRIVER_MISSED → EN_ROUTE made stops
  invisible to the reassigned_stops endpoint the moment they were reassigned.
- Unsynchronized JSONField mutation caused concurrent threads to silently drop stops.
- CollectionSchedule.waypoints mutations were invisible to a driver already mid-shift
  since ShiftRouteModule only fetches waypoints on mount.

Replaced by: driver.missed_stop_service.create_missed_stops / resolve_missed_stop
"""
