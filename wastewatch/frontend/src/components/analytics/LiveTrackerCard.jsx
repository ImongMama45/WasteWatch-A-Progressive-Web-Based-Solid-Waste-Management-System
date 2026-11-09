import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useBarangayTracker } from '../../hooks/useBarangayTracker';

/**
 * Haversine distance in meters between two lat/lng points.
 */
function calcHaversineM(lat1, lon1, lat2, lon2) {
  if (lat1 == null || lon1 == null || lat2 == null || lon2 == null) return 0;
  const R = 6371000; // Earth radius in meters
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Helper to format time strings (e.g. "14:00:00" -> "2:00 PM")
 */
function formatTime(timeStr) {
  if (!timeStr) return '';
  const parts = timeStr.slice(0, 5).split(':');
  if (parts.length < 2) return timeStr;
  const hr = parseInt(parts[0], 10);
  const m = parts[1];
  const ampm = hr >= 12 ? 'PM' : 'AM';
  const hr12 = hr % 12 || 12;
  return `${hr12}:${m} ${ampm}`;
}

/**
 * Format proximity (distance / stops away) and time of arrival (ETA).
 */
function formatProximityAndEta(truck) {
  if (!truck) return { headline: 'In Progress', subline: 'Window: 8:00 AM–2:00 PM' };

  // 1. Headline: Stops progress or main status
  let headline = '';
  if (truck.stops_total > 0) {
    headline = `${truck.stops_done ?? 0}/${truck.stops_total} Stops Collected`;
  } else if (truck.state === 'arrived') {
    headline = 'Truck Arrived at Area';
  } else if (truck.state === 'unloading') {
    headline = 'Dumpsite Unloading';
  } else {
    headline = 'Collection in Progress';
  }

  // 2. Proximity: How far is the driver
  let howFar = '';
  if (truck.state === 'arrived') {
    howFar = 'At your area';
  } else if (truck.state === 'unloading') {
    howFar = 'At dumpsite';
  } else if (truck.stops_away != null) {
    if (truck.stops_away === 0) howFar = 'Next stop is yours';
    else if (truck.stops_away === 1) howFar = '1 stop away';
    else howFar = `${truck.stops_away} stops away`;
  }

  // Distance in km or meters
  let distStr = '';
  if (truck.distance) {
    distStr = truck.distance;
  } else if (truck.dist_km != null) {
    distStr = `${Number(truck.dist_km).toFixed(1)} km`;
  } else if (truck.truck?.lat && truck.truck?.lng && truck.next_stop?.lat && truck.next_stop?.lng) {
    const dM = calcHaversineM(
      Number(truck.truck.lat), Number(truck.truck.lng),
      Number(truck.next_stop.lat), Number(truck.next_stop.lng)
    );
    if (dM > 0) {
      distStr = dM < 1000 ? `${Math.round(dM)}m` : `${(dM / 1000).toFixed(1)} km`;
    }
  }

  if (distStr) {
    if (howFar) {
      howFar = `${howFar} (${distStr})`;
    } else {
      howFar = `${distStr} away`;
    }
  }

  // 3. Time of Arrival (ETA)
  let etaStr = '';
  if (truck.state === 'arrived') {
    etaStr = 'Collecting now';
  } else if (truck.eta_max != null) {
    if (truck.eta_max <= 5) {
      etaStr = 'ETA: < 5 min';
    } else if (truck.eta_min != null && truck.eta_min !== truck.eta_max) {
      etaStr = `ETA: ${truck.eta_min}–${truck.eta_max} min`;
    } else {
      etaStr = `ETA: ~${truck.eta_max} min`;
    }
  } else if (truck.estimated_arrival) {
    etaStr = `ETA: ${formatTime(truck.estimated_arrival)}`;
  }

  // Window fallback
  const windowStr = (truck.start_time && truck.end_time)
    ? `Window: ${formatTime(truck.start_time)}–${formatTime(truck.end_time)}`
    : 'Window: 8:00 AM–2:00 PM';

  let subline = '';
  if (howFar && etaStr) {
    subline = `${howFar} · ${etaStr}`;
  } else if (howFar) {
    subline = `${howFar} · ${windowStr}`;
  } else if (etaStr) {
    subline = `${etaStr} · ${windowStr}`;
  } else {
    subline = windowStr;
  }

  return { headline, subline, etaShort: etaStr || howFar || 'Active' };
}

/**
 * Alert / Warning Triangle SVG icon (Strictly NO emojis per project rules)
 */
function IcoAlertTriangle({ size = 11, color = 'currentColor' }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flexShrink: 0 }}
      aria-hidden="true"
    >
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

/**
 * TruckSilhouette
 * Custom white cutout graphic with a transparent window cutout
 * that lets the card's background gradient shine through the windshield.
 */
function TruckSilhouette() {
  return (
    <svg
      width="54"
      height="32"
      viewBox="0 0 54 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={{ flexShrink: 0 }}
      aria-hidden="true"
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M3 2C1.34315 2 0 3.34315 0 5V27C0 28.6569 1.34315 30 3 30H51C52.6569 30 54 28.6569 54 27V14C54 12.3431 52.6569 11 51 11H38V5C38 3.34315 36.6569 2 35 2H3ZM37 13H48C49.1046 13 50 13.8954 50 15V22C50 22.5523 49.5523 23 49 23H37V13Z"
        fill="white"
      />
      <circle cx="12" cy="29" r="2.5" fill="rgba(0,0,0,0.18)" />
      <circle cx="43" cy="29" r="2.5" fill="rgba(0,0,0,0.18)" />
    </svg>
  );
}

/**
 * LiveTrackerCard
 * Compact top-corner status card with three distinct visual states:
 *   1. Completed / Collected (Green Gradient)
 *   2. Active / In-Duty Drive (Blue/Indigo Gradient)
 *   3. Scheduled / Missed / Idle (Red/Coral Gradient)
 *
 * Sticky behavior:
 *   - Only sticks to the side IF AND ONLY IF the truck is actively doing its duty (isBlue).
 *   - Positioned on the side (desktop: bottom-right; mobile: elevated on right side above bottom nav).
 *   - Supports minimize/expand toggle on mobile to prevent blocking underlying content.
 */
export default function LiveTrackerCard({
  truck,
  loading = false,
  dockedOnly = false,
  floatingOnly = false,
  variant = 'resident',
  onLogArrival,
  onEscalate,
}) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const anchorRef = useRef(null);
  const [isSticky, setIsSticky] = useState(floatingOnly);
  const [isMinimized, setIsMinimized] = useState(false);

  // Determine state types
  // Stops Incomplete: Route/shift closed, ended, or finished with uncollected stops
  const isIncomplete = Boolean(
    truck && (
      truck.is_incomplete === true ||
      truck.state === 'incomplete' ||
      truck.status === 'incomplete' ||
      truck.state === 'shift_not_closed' ||
      truck.status === 'shift_not_closed' ||
      truck.partial === true ||
      (truck.stops_total > 0 &&
        (truck.stops_done ?? 0) < truck.stops_total &&
        ['passed', 'collected', 'completed', 'done', 'ended', 'abandoned', 'shift_not_closed', 'unloading'].includes(
          truck.state || truck.status || truck.op_status || truck.opState
        )) ||
      (truck.stops_missed > 0 &&
        ['passed', 'collected', 'completed', 'done', 'ended', 'shift_not_closed'].includes(
          truck.state || truck.status
        ))
    )
  );

  const isCompleted = Boolean(
    truck &&
      !isIncomplete &&
      (['passed', 'collected', 'completed'].includes(truck.state) ||
        ['passed', 'collected', 'completed'].includes(truck.status) ||
        (truck.stops_done > 0 &&
          truck.stops_total > 0 &&
          truck.stops_done >= truck.stops_total &&
          !['en_route', 'collecting', 'in_progress', 'active'].includes(truck.state)))
  );

  const isMissed = Boolean(
    truck &&
      !isIncomplete &&
      (['missed', 'no_show', 'failed'].includes(truck.state) ||
        ['missed', 'no_show', 'failed'].includes(truck.status))
  );

  // State 2: Active / Blue State (Truck actively doing its duty)
  const isBlue = Boolean(
    truck &&
      !isIncomplete &&
      !isCompleted &&
      !isMissed &&
      (['en_route', 'extended', 'unloading', 'arrived', 'collecting', 'in_progress', 'active'].includes(truck.state) ||
        ['en_route', 'extended', 'unloading', 'arrived', 'collecting', 'in_progress', 'active'].includes(truck.status) ||
        ['en_route', 'collecting', 'heading_to_dumpsite', 'at_dumpsite', 'in_progress', 'active'].includes(truck.op_status) ||
        truck.is_active === true ||
        truck.active === true ||
        (truck.stops_total != null && truck.stops_total > 0) ||
        (truck.stops_away != null))
  );

  // Monitor scroll for sticky behavior (ONLY when truck is in the active blue state)
  useEffect(() => {
    if (floatingOnly) {
      setIsSticky(true);
      return;
    }

    if (dockedOnly || !isBlue) {
      setIsSticky(false);
      return;
    }

    const checkSticky = () => {
      if (!anchorRef.current) return;
      const rect = anchorRef.current.getBoundingClientRect();
      setIsSticky(rect.bottom < 64);
    };

    window.addEventListener('scroll', checkSticky, { passive: true, capture: true });
    document.addEventListener('scroll', checkSticky, { passive: true, capture: true });
    window.addEventListener('resize', checkSticky, { passive: true });

    let observer;
    if (typeof IntersectionObserver !== 'undefined' && anchorRef.current) {
      observer = new IntersectionObserver(
        () => {
          checkSticky();
        },
        {
          rootMargin: '-64px 0px 0px 0px',
          threshold: [0, 0.25, 0.5, 0.75, 1],
        }
      );
      observer.observe(anchorRef.current);
    }

    checkSticky();

    return () => {
      window.removeEventListener('scroll', checkSticky, { capture: true });
      document.removeEventListener('scroll', checkSticky, { capture: true });
      window.removeEventListener('resize', checkSticky);
      if (observer) observer.disconnect();
    };
  }, [isBlue, dockedOnly, floatingOnly]);

  if (loading && !truck) {
    if (floatingOnly) return null;
    return (
      <div
        style={{
          width: 290,
          maxWidth: '100%',
          height: 84,
          borderRadius: 14,
          background: 'var(--surface-2, #1e293b)',
          border: '1px solid var(--border, rgba(255,255,255,0.08))',
          animation: 'pulse 1.5s infinite ease-in-out',
        }}
      />
    );
  }

  if (!truck) return null;
  // If in floating-only mode but not in active blue state, don't show on other pages
  if (floatingOnly && !isBlue) return null;

  // Route / Truck Plate Title
  const truckTitle = truck.route_name ||
    (truck.truck?.plate && truck.truck.plate !== 'Hidden' ? truck.truck.plate : null) ||
    (truck.truck_plate && truck.truck_plate !== 'Unknown' ? truck.truck_plate : null) ||
    truck.plate ||
    truck.label ||
    'ABS CBN';

  let config = {};

  if (isIncomplete) {
    // ── State: Stops Incomplete (Amber / Orange Gradient) ──
    const missedCount = truck.stops_missed != null
      ? truck.stops_missed
      : Math.max(0, (truck.stops_total ?? 0) - (truck.stops_done ?? 0));
    const stopsDone = truck.stops_done ?? 0;
    const stopsTotal = truck.stops_total ?? 0;

    let sublineText = '';
    if (stopsTotal > 0) {
      sublineText = `${stopsDone}/${stopsTotal} Done · ${missedCount} Missed`;
    } else if (truck.completed_at || truck.end_time) {
      sublineText = `Closed at ${formatTime(truck.completed_at || truck.end_time)}`;
    } else {
      sublineText = 'Shift Ended Incomplete';
    }

    config = {
      gradient: 'linear-gradient(135deg, #f97316 0%, #ea580c 55%, #c2410c 100%)',
      shadowColor: 'rgba(234, 88, 12, 0.4)',
      topRightText: 'VIEW MAP ↗',
      topRightClickable: true,
      hasTruckIcon: true,
      headline: 'STOPS INCOMPLETE',
      subline: sublineText,
      canEscalate: user?.role === 'brgy_official',
    };
  } else if (isCompleted) {
    // ── State 1: Completed (Green Gradient) ──
    config = {
      gradient: 'linear-gradient(135deg, #74d82a 0%, #3bb91c 55%, #239e14 100%)',
      shadowColor: 'rgba(46, 160, 20, 0.35)',
      topRightText: 'VIEW ON MAPS ↗',
      topRightClickable: true,
      hasTruckIcon: true,
      headline: 'STOPS COMPLETED',
      subline: formatTime(truck.completed_at || truck.end_time) || '2:00 PM',
      canEscalate: false,
    };
  } else if (isBlue) {
    // ── State 2: Active Drive (Blue / Indigo Gradient) ──
    const proximity = formatProximityAndEta(truck);
    config = {
      gradient: 'linear-gradient(135deg, #3b82f6 0%, #4338ca 100%)',
      shadowColor: 'rgba(59, 130, 246, 0.35)',
      topRightText: 'VIEW ON MAPS ↗',
      topRightClickable: true,
      hasTruckIcon: true,
      headline: proximity.headline,
      subline: proximity.subline,
      etaShort: proximity.etaShort,
      canEscalate: false,
    };
  } else {
    // ── State 3: Scheduled / Not Collected (Red / Coral Gradient) ──
    config = {
      gradient: 'linear-gradient(135deg, #ef4444 0%, #dc2626 55%, #991b1b 100%)',
      shadowColor: 'rgba(220, 38, 38, 0.35)',
      topRightText: isMissed ? 'Missed today' : 'Scheduled today',
      topRightClickable: false,
      hasTruckIcon: false,
      headline: isMissed ? 'Collection Missed' : 'Scheduled Collection',
      subline: 'Not Collected',
      canEscalate: isMissed && user?.role === 'brgy_official',
    };
  }

  const handleMapClick = (e) => {
    e.stopPropagation();
    if (config.topRightClickable) {
      navigate('/map');
    }
  };

  const handleEscalate = (e) => {
    e.stopPropagation();
    if (user?.role !== 'brgy_official') return;
    if (onEscalate) {
      onEscalate(truck);
      return;
    }
    const missedCount = truck.stops_missed != null
      ? truck.stops_missed
      : Math.max(0, (truck.stops_total ?? 0) - (truck.stops_done ?? 0));
    const totalCount = truck.stops_total || 0;
    const doneCount = truck.stops_done || 0;
    const shiftId = truck.shift_id || truck.schedule_id || truck.id || '';
    const truckId = truck.truck_id || truck.truck?.id || '';
    const driverId = truck.driver_id || truck.driver?.id || '';
    const driverName = truck.driver_name || (typeof truck.driver === 'string' ? truck.driver : truck.driver?.name) || '';
    const plate = truck.truck_plate || (truck.truck?.plate && truck.truck.plate !== 'Hidden' ? truck.truck.plate : null) || truckTitle;

    const subject = `Incomplete stops — Truck ${plate}${driverName ? ` (${driverName})` : ''}`;
    const message = `Truck ${plate} has unfinished collection stops (${doneCount}/${totalCount} completed, ${missedCount > 0 ? missedCount : 'multiple'} missed/pending). Requesting dispatch escalation and resolution.`;

    if (user?.role === 'brgy_official') {
      navigate('/brgy/escalate', {
        state: {
          shiftId,
          truckId,
          driverId,
          truckLabel: plate,
          driver: driverName,
          severity: 'high',
          subject,
          message,
        },
      });
    } else if (user?.role === 'admin') {
      navigate('/admin/escalations', {
        state: {
          shiftId,
          truckId,
          driverId,
          truckLabel: plate,
          driver: driverName,
          severity: 'high',
          subject,
          message,
        },
      });
    } else {
      navigate('/report', {
        state: {
          issue_type: 'missed_pickup',
          notes: `Incomplete collection report for Truck ${plate}: stops left uncollected.`,
        },
      });
    }
  };

  const cardStyle = {
    background: config.gradient,
    color: '#ffffff',
    width: 290,
    maxWidth: '100%',
    height: 84,
    borderRadius: 14,
    padding: '9px 14px',
    boxSizing: 'border-box',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'space-between',
    boxShadow: `0 8px 20px ${config.shadowColor}`,
    fontFamily: 'var(--font-body, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif)',
    transition: 'transform 0.2s ease, box-shadow 0.2s ease, opacity 0.2s ease',
    overflow: 'hidden',
    position: 'relative',
    userSelect: 'none',
  };

  // Render the expanded card content
  const renderCardContent = (isFloatingMode = false) => (
    <>
      {/* Top Row: Route / Truck Title + View on Maps button (+ minimize button when floating) */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          width: '100%',
        }}
      >
        <span
          style={{
            fontSize: 12.5,
            fontWeight: 800,
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
            color: '#ffffff',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            maxWidth: config.canEscalate ? (isFloatingMode ? 85 : 100) : (isFloatingMode ? 130 : 160),
          }}
          title={truckTitle}
        >
          {truckTitle}
        </span>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {config.canEscalate && user?.role === 'brgy_official' && (
            <button
              type="button"
              onClick={handleEscalate}
              title="Escalate incomplete collection to Admin"
              aria-label="Escalate incomplete collection"
              style={{
                background: '#ffffff',
                border: 'none',
                borderRadius: 5,
                width: 22,
                height: 22,
                padding: 0,
                color: '#ea580c',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 2px 6px rgba(0,0,0,0.18)',
                transition: 'transform 0.15s ease, background 0.15s ease',
                flexShrink: 0,
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = 'scale(1.08)';
                e.currentTarget.style.background = '#fff7ed';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'scale(1)';
                e.currentTarget.style.background = '#ffffff';
              }}
            >
              <IcoAlertTriangle size={13} color="#ea580c" />
            </button>
          )}

          <button
            type="button"
            onClick={handleMapClick}
            disabled={!config.topRightClickable}
            style={{
              background: 'none',
              border: 'none',
              padding: 0,
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: '0.05em',
              textTransform: 'uppercase',
              color: 'rgba(255, 255, 255, 0.94)',
              cursor: config.topRightClickable ? 'pointer' : 'default',
              display: 'flex',
              alignItems: 'center',
              gap: 2,
              transition: 'opacity 0.2s ease',
            }}
            onMouseEnter={(e) => {
              if (config.topRightClickable) e.currentTarget.style.opacity = '0.8';
            }}
            onMouseLeave={(e) => {
              if (config.topRightClickable) e.currentTarget.style.opacity = '1';
            }}
          >
            {config.topRightText}
          </button>

          {isFloatingMode && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setIsMinimized(true);
              }}
              title="Minimize to side pill"
              aria-label="Minimize tracker"
              style={{
                background: 'rgba(255, 255, 255, 0.2)',
                border: 'none',
                borderRadius: '50%',
                width: 18,
                height: 18,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                color: '#ffffff',
                padding: 0,
                transition: 'background 0.2s ease',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255, 255, 255, 0.35)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(255, 255, 255, 0.2)')}
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Bottom Row: Cutout Graphic + Status Details */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          width: '100%',
          marginBottom: 2,
          justifyContent: config.hasTruckIcon ? 'flex-start' : 'center',
          textAlign: config.hasTruckIcon ? 'left' : 'center',
        }}
      >
        {config.hasTruckIcon && <TruckSilhouette />}

        <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
          <div
            style={{
              fontSize: 13,
              fontWeight: 800,
              lineHeight: 1.2,
              color: '#ffffff',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              letterSpacing: '0.01em',
            }}
          >
            {config.headline}
          </div>
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: 'rgba(255, 255, 255, 0.92)',
              marginTop: 2,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {config.subline}
          </div>
        </div>
      </div>
    </>
  );

  // Render minimized pill for floating mode
  const renderMinimizedPill = () => (
    <div
      onClick={() => setIsMinimized(false)}
      className="trk-card-interactive trk-pill-floating"
      style={{
        background: config.gradient,
        color: '#ffffff',
        height: 38,
        borderRadius: 20,
        padding: '0 12px 0 10px',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        boxShadow: `0 8px 24px rgba(0, 0, 0, 0.4), 0 4px 12px ${config.shadowColor}`,
        cursor: 'pointer',
        userSelect: 'none',
        fontFamily: 'var(--font-body, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif)',
      }}
      title="Click to expand collection tracker"
    >
      <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: '#60a5fa', boxShadow: '0 0 6px #ffffff' }} />
      <span style={{ fontSize: 11.5, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.03em' }}>
        {truckTitle}
      </span>
      <span style={{ fontSize: 11, fontWeight: 600, opacity: 0.95 }}>
        · {config.etaShort || 'Active'}
      </span>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginLeft: 2, opacity: 0.85 }}>
        <polyline points="18 15 12 9 6 15" />
      </svg>
    </div>
  );

  return (
    <>
      <style>{`
        @keyframes trk-slide-up {
          from {
            transform: translateY(24px) scale(0.94);
            opacity: 0;
          }
          to {
            transform: translateY(0) scale(1);
            opacity: 1;
          }
        }

        .trk-card-interactive:hover {
          transform: translateY(-2px);
          filter: brightness(1.03);
        }

        /* Side floating styles - desktop */
        @media (min-width: 1024px) {
          .trk-card-floating-side {
            position: fixed !important;
            bottom: 24px !important;
            right: 28px !important;
            left: auto !important;
            width: 290px !important;
            z-index: 99999 !important;
            animation: trk-slide-up 0.28s cubic-bezier(0.16, 1, 0.3, 1) !important;
          }
          .trk-pill-floating {
            position: fixed !important;
            bottom: 24px !important;
            right: 28px !important;
            left: auto !important;
            z-index: 99999 !important;
            animation: trk-slide-up 0.28s cubic-bezier(0.16, 1, 0.3, 1) !important;
          }
        }

        /* Side floating styles - mobile: elevated on right side above bottom nav */
        @media (max-width: 1023px) {
          .trk-card-container {
            width: 100% !important;
            max-width: 100% !important;
          }
          .trk-card-container .trk-card-interactive {
            width: 100% !important;
            max-width: 100% !important;
          }
          .trk-card-floating-side {
            position: fixed !important;
            bottom: 88px !important;
            right: 12px !important;
            left: auto !important;
            width: 280px !important;
            max-width: calc(100vw - 24px) !important;
            z-index: 99999 !important;
            animation: trk-slide-up 0.28s cubic-bezier(0.16, 1, 0.3, 1) !important;
          }
          .trk-pill-floating {
            position: fixed !important;
            bottom: 88px !important;
            right: 12px !important;
            left: auto !important;
            z-index: 99999 !important;
            animation: trk-slide-up 0.28s cubic-bezier(0.16, 1, 0.3, 1) !important;
          }
        }
      `}</style>

      {/* Anchor Container in the header (only if NOT in floating-only mode) */}
      {!floatingOnly && (
        <div
          ref={anchorRef}
          style={{
            width: 290,
            maxWidth: '100%',
            height: 84,
            position: 'relative',
            flexShrink: 0,
          }}
          className="trk-card-container"
        >
          {/* Rendered in-place when not sticky */}
          <div
            onClick={handleMapClick}
            className="trk-card-interactive"
            style={{
              ...cardStyle,
              cursor: config.topRightClickable ? 'pointer' : 'default',
              visibility: (isSticky && isBlue) ? 'hidden' : 'visible',
            }}
          >
            {renderCardContent(false)}
          </div>
        </div>
      )}

      {/* Floating Sticky Card on the side (via React Portal to document.body) */}
      {isSticky && isBlue && typeof document !== 'undefined' && createPortal(
        isMinimized ? (
          renderMinimizedPill()
        ) : (
          <div
            onClick={handleMapClick}
            className="trk-card-interactive trk-card-floating-side"
            style={{
              ...cardStyle,
              boxShadow: `0 16px 36px rgba(0, 0, 0, 0.45), 0 8px 24px ${config.shadowColor}`,
              cursor: config.topRightClickable ? 'pointer' : 'default',
            }}
          >
            {renderCardContent(true)}
          </div>
        ),
        document.body
      )}
    </>
  );
}

/**
 * GlobalActiveTracker
 * Renders the floating blue LiveTrackerCard on the side across any page
 * IF AND ONLY IF an active collection is currently taking place.
 */
export function GlobalActiveTracker({ user }) {
  const brgyId = user?.barangay_id || (typeof user?.barangay === 'object' ? user.barangay?.id : user?.barangay);
  const { data } = useBarangayTracker(brgyId);

  // Find active truck (only if collection is actively happening)
  const activeTruck = data?.trucks?.find((t) => {
    const isCompleted = ['passed', 'collected', 'completed'].includes(t.state) ||
      ['passed', 'collected', 'completed'].includes(t.status) ||
      (t.stops_done > 0 && t.stops_total > 0 && t.stops_done >= t.stops_total);
    const isMissed = ['missed', 'no_show', 'failed'].includes(t.state) ||
      ['missed', 'no_show', 'failed'].includes(t.status);
    if (isCompleted || isMissed) return false;

    return Boolean(
      ['en_route', 'extended', 'unloading', 'arrived', 'collecting', 'in_progress', 'active'].includes(t.state) ||
      ['en_route', 'extended', 'unloading', 'arrived', 'collecting', 'in_progress', 'active'].includes(t.status) ||
      ['en_route', 'collecting', 'heading_to_dumpsite', 'at_dumpsite', 'in_progress', 'active'].includes(t.op_status) ||
      t.is_active === true ||
      t.active === true ||
      (t.stops_total != null && t.stops_total > 0) ||
      (t.stops_away != null)
    );
  });

  if (!activeTruck) return null;

  return <LiveTrackerCard truck={activeTruck} floatingOnly={true} />;
}
