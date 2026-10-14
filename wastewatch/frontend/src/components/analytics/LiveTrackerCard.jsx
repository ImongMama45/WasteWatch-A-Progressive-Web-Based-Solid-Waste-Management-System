import { useEffect } from 'react';

// SVG Icons
const IcoTruck = ({ size=20, color='currentColor' }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 17h4V5H2v12h3"/><path d="M20 17h2v-3.34a4 4 0 0 0-1.17-2.83L19 9h-5v8h2"/><circle cx="7.5" cy="17.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/></svg>;
const IcoMapPin = ({ size=20, color='currentColor' }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>;
const IcoClock = ({ size=20, color='currentColor' }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>;
const IcoCheckCircle = ({ size=20, color='currentColor' }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>;
const IcoAlertCircle = ({ size=20, color='currentColor' }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>;
const IcoCalendar = ({ size=20, color='currentColor' }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>;

export default function LiveTrackerCard({ truck, variant = 'resident', onLogArrival }) {
  useEffect(() => {
    if (!document.getElementById('pulse-anim')) {
      const style = document.createElement('style');
      style.id = 'pulse-anim';
      style.innerHTML = `@keyframes trk-pulse { 0% { transform: scale(1); opacity: 0.8; } 100% { transform: scale(2.5); opacity: 0; } }`;
      document.head.appendChild(style);
    }
  }, []);

  if (!truck) return null;

  const STYLES = {
    card: {
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: '16px',
      padding: '20px',
      position: 'relative',
      overflow: 'hidden',
      marginBottom: '16px',
    },
    header: {
      display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px'
    },
    stateBadge: {
      display: 'inline-flex', alignItems: 'center', gap: '6px',
      padding: '4px 12px', borderRadius: '20px',
      fontSize: '12px', fontWeight: '800', letterSpacing: '0.05em', textTransform: 'uppercase'
    },
    title: { fontSize: '18px', fontWeight: '800', margin: 0, color: 'var(--text)' },
    subtitle: { fontSize: '13px', color: 'var(--text-muted)', marginTop: '4px' },
    pulsePoint: {
      width: '12px', height: '12px', borderRadius: '50%',
      position: 'relative',
    },
    pulseRing: {
      position: 'absolute', inset: -4, borderRadius: '50%',
      border: '2px solid', opacity: 0.5,
      animation: 'trk-pulse 2s infinite'
    }
  };

  const THEMES = {
    en_route:  { bg: '#DBEAFE', color: '#1D4ED8', dot: '#3B82F6', icon: IcoTruck,       label: 'On The Way' },
    arrived:   { bg: '#FEF3C7', color: '#B45309', dot: '#F59E0B', icon: IcoMapPin,       label: 'Arrived' },
    unloading: { bg: '#FEF3C7', color: '#B45309', dot: '#F59E0B', icon: IcoTruck,        label: 'At Dumpsite' },
    extended:  { bg: '#E0E7FF', color: '#4338CA', dot: '#6366F1', icon: IcoTruck,        label: 'Collecting Missed Stops' },
    scheduled: { bg: '#F3F4F6', color: '#4B5563', dot: '#9CA3AF', icon: IcoCalendar,     label: 'Scheduled Today' },
    passed:    { bg: '#DCFCE7', color: '#15803D', dot: '#22C55E', icon: IcoCheckCircle,  label: 'Collected' },
    missed:    { bg: '#FEE2E2', color: '#B91C1C', dot: '#EF4444', icon: IcoAlertCircle,  label: 'Missed' },
    none:      { bg: '#F3F4F6', color: '#9CA3AF', dot: '#9CA3AF', icon: IcoCalendar,     label: 'No Collection Today' },
    no_show:   { bg: '#FEE2E2', color: '#B91C1C', dot: '#EF4444', icon: IcoAlertCircle,  label: 'No Show' },
  };

  const theme = THEMES[truck.state] || THEMES.none;
  const Icon = theme.icon;

  let themeLabel = theme.label;
  if (truck.state === 'unloading') {
    if (truck.op_status === 'heading_to_dumpsite') {
      themeLabel = 'Heading to Dumpsite';
    } else if (variant === 'operator') {
      themeLabel = 'At Dumpsite';
    } else {
      themeLabel = 'Unloading';
    }
  }

  const formatTime = (timeStr) => {
    if (!timeStr) return '';
    const [h, m] = timeStr.slice(0, 5).split(':');
    const hr = parseInt(h);
    const ampm = hr >= 12 ? 'PM' : 'AM';
    const hr12 = hr % 12 || 12;
    return `${hr12}:${m} ${ampm}`;
  };

  // Use server-computed age (avoid clock drift)
  const fixAgeMin = truck.fix_age_s != null ? Math.ceil(truck.fix_age_s / 60) : null;

  const stopsLabel = truck.stops_total > 0
    ? `${truck.stops_done} of ${truck.stops_total} stop${truck.stops_total === 1 ? '' : 's'} in your area`
    : null;

  return (
    <div style={STYLES.card}>
      <div style={STYLES.header}>
        <div>
          <h3 style={STYLES.title}>{truck.truck?.plate && truck.truck.plate !== 'Hidden' ? truck.truck.plate : 'Collection truck'}</h3>
          <div style={STYLES.subtitle}>{truck.driver_name || (variant === 'operator' ? 'Driver unassigned' : 'Your area\'s assigned team')}</div>
        </div>
        <div style={{...STYLES.stateBadge, background: theme.bg, color: theme.color}}>
          <Icon size={14} color={theme.color} />
          {themeLabel}
        </div>
      </div>

      <div style={{ padding: '24px', background: 'var(--bg)', borderRadius: '12px' }}>
        {/* En route / extended: stops away + ETA + progress */}
        {['en_route', 'extended'].includes(truck.state) && !truck.behind && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
            <div style={{ ...STYLES.pulsePoint, background: theme.dot }}>
              <div style={{ ...STYLES.pulseRing, borderColor: theme.dot }} />
            </div>

            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                <span style={{ fontSize: '14px', fontWeight: '700', color: 'var(--text)' }}>
                  {truck.stops_away} {truck.stops_away === 1 ? 'stop' : 'stops'} away
                </span>
                {truck.is_stale && fixAgeMin != null ? (
                  <span style={{ fontSize: '13px', fontWeight: '600', color: '#D97706', lineHeight: '1' }}>
                    Last seen {fixAgeMin}m ago
                  </span>
                ) : truck.eta_max == null ? (
                  <span style={{ fontSize: '14px', fontWeight: '600', color: 'var(--text-muted)' }}>
                    Locating the truck...
                  </span>
                ) : (
                  <span style={{ fontSize: '24px', fontWeight: '800', color: truck.is_stale ? '#D97706' : theme.color, lineHeight: '1' }}>
                    {truck.eta_max <= 5 ? '< 5' : `${truck.eta_min}–${truck.eta_max}`}{' '}
                    <span style={{ fontSize: '14px' }}>min</span>
                  </span>
                )}
              </div>

              {stopsLabel && (
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '6px' }}>
                  {stopsLabel}
                </div>
              )}

              {truck.stops_total > 0 ? (
                <div style={{ width: '100%', height: '6px', background: 'var(--border)', borderRadius: '3px', overflow: 'hidden' }}>
                  <div style={{
                    width: `${Math.max(5, (truck.stops_done / truck.stops_total) * 100)}%`,
                    height: '100%', background: theme.dot, borderRadius: '3px'
                  }} />
                </div>
              ) : (
                <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Live Map Tracking Coming Soon</div>
              )}
            </div>
          </div>
        )}

        {/* Bug #3: target is behind the truck's frontier */}
        {['en_route', 'extended'].includes(truck.state) && truck.behind && (
          <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
            <div style={{ padding: '12px', background: '#FEF3C7', borderRadius: '50%' }}>
              <IcoAlertCircle size={24} color="#B45309" />
            </div>
            <div>
              <div style={{ fontSize: '14px', fontWeight: '700', color: 'var(--text)' }}>Not collected yet</div>
              <div style={{ fontSize: '13px', color: 'var(--text-muted)', marginTop: '4px' }}>
                We'll update this when the truck returns.
              </div>
            </div>
          </div>
        )}

        {/* Arrived */}
        {truck.state === 'arrived' && (
          <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
            <div style={{ padding: '12px', background: theme.bg, borderRadius: '50%' }}>
              <IcoMapPin size={24} color={theme.color} />
            </div>
            <div>
              <div style={{ fontSize: '14px', fontWeight: '700', color: 'var(--text)' }}>Truck has Arrived</div>
              <div style={{ fontSize: '13px', color: 'var(--text-muted)', marginTop: '4px' }}>
                The truck is currently collecting in your barangay.
              </div>
            </div>
          </div>
        )}

        {/* Unloading / at dumpsite */}
        {truck.state === 'unloading' && (
          <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
            <div style={{ padding: '12px', background: theme.bg, borderRadius: '50%' }}>
              <IcoTruck size={24} color={theme.color} />
            </div>
            <div>
              <div style={{ fontSize: '14px', fontWeight: '700', color: 'var(--text)' }}>
                {truck.op_status === 'heading_to_dumpsite' ? 'Heading to Dumpsite' : (variant === 'operator' ? 'At Dumpsite' : 'Unloading')}
              </div>
              <div style={{ fontSize: '13px', color: 'var(--text-muted)', marginTop: '4px' }}>
                {variant === 'operator' ? (
                  truck.op_status === 'at_dumpsite'
                    ? 'The truck has arrived and is ready to unload.'
                    : truck.eta_max === 0 
                      ? <span style={{ color: '#22c55e', fontWeight: '700' }}>Arriving now (within 300m)</span>
                      : (truck.eta_max != null 
                          ? <span>ETA: <strong style={{ color: truck.is_stale ? '#D97706' : 'inherit' }}>{truck.eta_max <= 5 ? '< 5' : truck.eta_min + '–' + truck.eta_max} mins</strong></span> 
                          : 'The truck is currently on route to the dumpsite.')
                ) : (
                  truck.op_status === 'heading_to_dumpsite'
                    ? 'Heading to the dumpsite. Collection will resume shortly.'
                    : 'Unloading at the dumpsite. Collection will resume shortly.'
                )}
              </div>
              {variant === 'operator' && truck.is_stale && (
                <div style={{ fontSize: '12px', color: '#D97706', marginTop: '4px', fontWeight: '600' }}>
                  Last seen {fixAgeMin}m ago
                </div>
              )}
              {variant === 'operator' && truck.truck?.id && (truck.op_status === 'at_dumpsite' || truck.eta_max === 0) && (
                <div style={{ marginTop: '12px' }}>
                  <button 
                     onClick={() => onLogArrival && onLogArrival(truck.truck.id)}
                     style={{
                       display: 'inline-block', background: 'var(--accent)', color: '#0d1117', border: 'none', cursor: 'pointer',
                       padding: '6px 14px', borderRadius: '14px', fontSize: '12px', fontWeight: '800',
                     }}>
                    Log Arrival
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Scheduled (+ preparing sub-state) / none / no_show */}
        {['scheduled', 'none', 'no_show'].includes(truck.state) && (
          <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
            <div style={{ padding: '12px', background: 'var(--surface)', borderRadius: '50%' }}>
              <IcoClock size={24} color="var(--text-muted)" />
            </div>
            <div>
              <div style={{ fontSize: '14px', fontWeight: '700', color: 'var(--text)' }}>
                {truck.state === 'scheduled'
                  ? (truck.preparing ? 'Truck is Getting Ready' : 'Scheduled Collection')
                  : truck.state === 'no_show' ? 'No Show'
                  : 'No Collection Today'}
              </div>
              <div style={{ fontSize: '13px', color: 'var(--text-muted)', marginTop: '4px' }}>
                {truck.state === 'scheduled'
                  ? (truck.preparing
                    ? `Expected ${formatTime(truck.start_time)}–${formatTime(truck.end_time)}`
                    : `Window: ${formatTime(truck.start_time)}–${formatTime(truck.end_time)}`)
                  : truck.state === 'no_show'
                  ? 'Collection did not happen today.'
                  : 'No collections are scheduled for your area today.'}
              </div>
            </div>
          </div>
        )}

        {/* Passed / collected */}
        {truck.state === 'passed' && (
          <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
            <div style={{ padding: '12px', background: '#DCFCE7', borderRadius: '50%' }}>
              <IcoCheckCircle size={24} color="#15803D" />
            </div>
            <div>
              <div style={{ fontSize: '14px', fontWeight: '700', color: 'var(--text)' }}>
                {truck.partial ? 'Partial Collection' : 'Collection Completed'}
              </div>
              <div style={{ fontSize: '13px', color: 'var(--text-muted)', marginTop: '4px' }}>
                {truck.partial
                  ? 'Some stops in your area were not reached. Extended collection may follow.'
                  : `Waste was successfully collected from your area today. (${truck.stops_done}/${truck.stops_total} stops)`}
              </div>
            </div>
          </div>
        )}

        {/* Missed */}
        {truck.state === 'missed' && (
          <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
            <div style={{ padding: '12px', background: '#FEE2E2', borderRadius: '50%' }}>
              <IcoAlertCircle size={24} color="#B91C1C" />
            </div>
            <div>
              <div style={{ fontSize: '14px', fontWeight: '700', color: 'var(--text)' }}>Collection Missed</div>
              <div style={{ fontSize: '13px', color: 'var(--text-muted)', marginTop: '4px' }}>
                The truck was unable to collect waste from your area today.
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

