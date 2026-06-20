/**
 * pages/watcher/WatcherTasksHub.jsx
 * ------------------------------------
 * Watcher workflow routing gate.
 * Presents two distinct process cards:
 *   1. Pre-Collection Inspection  → /verification-tasks
 *   2. Post-Collection Confirmation → /watcher/confirm
 *
 * Also shows a live summary of stop counts per status so
 * the watcher knows at a glance which workflow needs attention.
 */

import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import Navbar from '../../components/Navbar'
import BottomNav from '../../components/BottomNav'
import api from '../../api/client'
import { ICONS } from '../../api/navConfig'

// ─── STATUS COLOURS (mirrors pickupStatusSync palette) ───────────────────────
const STATUS_META = {
    PENDING_INSPECTION: { label: 'Pending Inspection', color: '#94a3b8', bg: 'rgba(148,163,184,0.12)' },
    READY_FOR_COLLECTION: { label: 'Ready for Collection', color: '#f59e0b', bg: 'rgba(245,158,11,0.12)' },
    EMPTY_STOP: { label: 'Empty Stop', color: '#64748b', bg: 'rgba(100,116,139,0.12)' },
    COLLECTION_REPORTED: { label: 'Collection Reported', color: '#eab308', bg: 'rgba(234,179,8,0.12)' },
    VERIFIED_COLLECTED: { label: 'Verified Collected', color: '#16a34a', bg: 'rgba(22,163,74,0.12)' },
    // NOTE: DB constant is COLLECTION_DISPUTED; label intentionally shows 'Missed'.
    // TODO: Remove this local STATUS_META and import STOP_STATUS_LABELS from pickupStatusSync instead.
    COLLECTION_DISPUTED: { label: 'Missed', color: '#ef4444', bg: 'rgba(239,68,68,0.12)' },
}

function normalizeStatus(raw) {
    if (!raw) return 'PENDING_INSPECTION'
    return raw.toUpperCase().replace(/ /g, '_')
}

// ─── STATUS PILL ─────────────────────────────────────────────────────────────
function StatusPill({ status, count }) {
    const m = STATUS_META[status] || STATUS_META.PENDING_INSPECTION
    if (count === 0) return null
    return (
        <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            background: m.bg, border: `1px solid ${m.color}44`,
            borderRadius: 20, padding: '4px 10px',
        }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: m.color, flexShrink: 0 }} />
            <span style={{ fontSize: 11, fontWeight: 700, color: m.color }}>{count}</span>
            <span style={{ fontSize: 10, color: m.color, opacity: 0.8 }}>{m.label}</span>
        </div>
    )
}

// ─── WORKFLOW CARD ────────────────────────────────────────────────────────────
function WorkflowCard({
    icon, title, subtitle, description,
    timing, actionLabel, accent,
    badgeCount, badgeLabel,
    onClick, disabled,
}) {
    const [hovered, setHovered] = useState(false)

    return (
        <div
            onClick={disabled ? undefined : onClick}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            style={{
                borderRadius: 18,
                border: `1.5px solid ${hovered && !disabled ? accent : `${accent}33`}`,
                background: hovered && !disabled
                    ? `linear-gradient(135deg, ${accent}10 0%, ${accent}06 100%)`
                    : 'var(--surface)',
                padding: '22px 20px',
                cursor: disabled ? 'default' : 'pointer',
                transition: 'all .18s ease',
                transform: hovered && !disabled ? 'translateY(-2px)' : 'none',
                boxShadow: hovered && !disabled ? `0 8px 28px ${accent}22` : '0 2px 8px rgba(0,0,0,0.08)',
                opacity: disabled ? 0.5 : 1,
                position: 'relative',
                overflow: 'hidden',
            }}
        >
            {/* Badge */}
            {badgeCount > 0 && (
                <div style={{
                    position: 'absolute', top: 16, right: 16,
                    background: accent, color: '#0d1117',
                    borderRadius: 20, minWidth: 24, height: 24,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 11, fontWeight: 900, padding: '0 8px',
                    boxShadow: `0 2px 8px ${accent}55`,
                }}>
                    {badgeCount} {badgeLabel}
                </div>
            )}

            {/* Icon + title */}
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, marginBottom: 14 }}>
                <div style={{
                    width: 52, height: 52, borderRadius: 14, flexShrink: 0,
                    background: `${accent}18`, border: `1.5px solid ${accent}44`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 26,
                }}>
                    {icon}
                </div>
                <div style={{ flex: 1, minWidth: 0, paddingRight: badgeCount > 0 ? 56 : 0 }}>
                    <div style={{
                        fontFamily: 'var(--font-head)', fontSize: 17, fontWeight: 900,
                        color: 'var(--text)', marginBottom: 2,
                    }}>
                        {title}
                    </div>
                    <div style={{ fontSize: 12, color: accent, fontWeight: 700 }}>{subtitle}</div>
                </div>
            </div>

            {/* Description */}
            <p style={{
                fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.55,
                margin: '0 0 16px',
            }}>
                {description}
            </p>

            {/* Timing tag */}
            <div style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                background: `${accent}10`, border: `1px solid ${accent}33`,
                borderRadius: 20, padding: '4px 12px', marginBottom: 18,
            }}>
                <span style={{ fontSize: 12 }}>🕐</span>
                <span style={{ fontSize: 11, fontWeight: 700, color: accent }}>{timing}</span>
            </div>

            {/* CTA */}
            <button
                style={{
                    width: '100%', padding: '14px', borderRadius: 12, border: 'none',
                    background: disabled ? '#e2e8f0' : accent,
                    color: disabled ? '#94a3b8' : '#0d1117',
                    fontFamily: 'var(--font-head)', fontSize: 14, fontWeight: 900,
                    letterSpacing: '.04em', cursor: disabled ? 'not-allowed' : 'pointer',
                    boxShadow: disabled ? 'none' : `0 4px 14px ${accent}44`,
                    transition: 'all .15s',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                }}
                onClick={e => { e.stopPropagation(); if (!disabled) onClick() }}
            >
                {disabled ? '✓ All Done' : actionLabel} {!disabled && <span style={{ fontSize: 16 }}>›</span>}
            </button>
        </div>
    )
}

// ─── PROCESS FLOW ─────────────────────────────────────────────────────────────
function ProcessFlow() {
    const steps = [
        { icon: ICONS.search, label: 'Inspect Stop', sub: 'Watcher pre-checks', color: '#14b8a6' },
        { icon: ICONS.truck, label: 'Truck Collects', sub: 'Driver confirms', color: '#f59e0b' },
        { icon: ICONS.check, label: 'Verify Collected', sub: 'Watcher post-checks', color: '#16a34a' },
    ]
    return (
        <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0,
            background: 'var(--surface)', borderRadius: 14,
            padding: '14px 16px', marginBottom: 20,
            border: '1px solid var(--border)',
        }}>
            {steps.map((s, i) => (
                <div key={s.label} style={{ display: 'flex', alignItems: 'center' }}>
                    <div style={{ textAlign: 'center', minWidth: 72 }}>
                        <div style={{
                            width: 36, height: 36, borderRadius: '50%', margin: '0 auto 6px',
                            background: `${s.color}18`, border: `1.5px solid ${s.color}55`,
                            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18,
                        }}>{s.icon}</div>
                        <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--text)', lineHeight: 1.2 }}>{s.label}</div>
                        <div style={{ fontSize: 9, color: s.color, fontWeight: 700, marginTop: 2 }}>{s.sub}</div>
                    </div>
                    {i < steps.length - 1 && (
                        <div style={{ width: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                            <div style={{ width: '100%', height: 1.5, background: 'var(--border)', position: 'relative' }}>
                                <span style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', fontSize: 10, color: 'var(--text-muted)' }}>›</span>
                            </div>
                        </div>
                    )}
                </div>
            ))}
        </div>
    )
}

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────
export default function WatcherTasksHub() {
    const navigate = useNavigate()
    const { user } = useAuth()

    const [stops, setStops] = useState([])
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        async function load() {
            setLoading(true)
            try {
                const res = await api.get('/api/watcher/stop-validations/')
                const rows = res.data?.results ?? res.data ?? []
                setStops(rows)
            } catch {
                setStops([])
            } finally {
                setLoading(false)
            }
        }
        load()
    }, [])

    // Counts per status
    const counts = stops.reduce((acc, s) => {
        const key = normalizeStatus(s.current_status)
        acc[key] = (acc[key] || 0) + 1
        return acc
    }, {})

    const pendingInspection = counts.PENDING_INSPECTION || 0
    const collectionReported = counts.COLLECTION_REPORTED || 0
    const verifiedCollected = counts.VERIFIED_COLLECTED || 0
    const readyForCollection = counts.READY_FOR_COLLECTION || 0
    const emptyStops = counts.EMPTY_STOP || 0

    const totalToday = stops.length
    const allInspected = pendingInspection === 0
    const allVerified = collectionReported === 0

    return (
        <>
            <Navbar />
            <style>{`
        @keyframes hubFadeUp {
          from { opacity: 0; transform: translateY(10px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .hub-card { animation: hubFadeUp .25s ease both; }
        .hub-card:nth-child(2) { animation-delay: .06s; }
        .hub-card:nth-child(3) { animation-delay: .12s; }
      `}</style>

            <div className="page" style={{ maxWidth: 560, paddingBottom: 88 }}>

                {/* ── Header ── */}
                <div style={{ marginBottom: 20 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                        <h2 style={{ fontFamily: 'var(--font-head)', fontSize: 22, fontWeight: 900, margin: 0 }}>
                            Watcher Tasks
                        </h2>
                        {loading ? (
                            <div style={{
                                width: 18, height: 18, borderRadius: '50%',
                                border: '2.5px solid var(--border)', borderTopColor: '#14b8a6',
                                animation: 'spin 1s linear infinite',
                            }} />
                        ) : (
                            <span style={{
                                background: 'rgba(20,184,166,0.12)', color: '#14b8a6',
                                border: '1px solid rgba(20,184,166,0.3)',
                                fontSize: 10, fontWeight: 800, padding: '3px 10px', borderRadius: 20,
                            }}>
                                {totalToday} STOPS TODAY
                            </span>
                        )}
                    </div>
                    <p className="text-muted text-sm">
                        {user?.barangay_name
                            ? `Covering ${user.barangay_name} · Choose a task below`
                            : 'Choose which task to perform'}
                    </p>
                </div>

                {/* ── Live status strip ── */}
                {!loading && totalToday > 0 && (
                    <div style={{
                        display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 18,
                    }}>
                        <StatusPill status="PENDING_INSPECTION" count={pendingInspection} />
                        <StatusPill status="READY_FOR_COLLECTION" count={readyForCollection} />
                        <StatusPill status="EMPTY_STOP" count={emptyStops} />
                        <StatusPill status="COLLECTION_REPORTED" count={collectionReported} />
                        <StatusPill status="VERIFIED_COLLECTED" count={verifiedCollected} />
                    </div>
                )}

                {/* ── Process flow diagram ── */}
                <ProcessFlow />

                {/* ── Workflow cards ── */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

                    {/* Card 1 — Pre-Collection Inspection */}
                    <div className="hub-card">
                        <WorkflowCard
                            icon={ICONS.search}
                            title="Pre-Collection Inspection"
                            subtitle="Done before the truck arrives"
                            description="Walk to each assigned stop and report whether garbage is present. Marks stops as Ready for Collection or Empty."
                            timing="Before truck arrival"
                            actionLabel="Start Inspection"
                            accent="#14b8a6"
                            badgeCount={pendingInspection}
                            badgeLabel="pending"
                            disabled={loading || allInspected}
                            onClick={() => navigate('/verification-tasks')}
                        />
                    </div>

                    {/* Card 2 — Post-Collection Confirmation */}
                    <div className="hub-card">
                        <WorkflowCard
                            icon={ICONS.check}
                            title="Post-Collection Verification"
                            subtitle="Done after the truck has collected"
                            description="Verify that the driver's collection report is accurate. Confirm the stop is clean and capture a final proof photo."
                            timing="After truck has collected"
                            actionLabel="Verify Collections"
                            accent="#16a34a"
                            badgeCount={collectionReported}
                            badgeLabel="to verify"
                            disabled={loading || allVerified}
                            onClick={() => navigate('/watcher/confirm')}
                        />
                    </div>
                </div>

                {/* ── All done state ── */}
                {!loading && allInspected && allVerified && totalToday > 0 && (
                    <div style={{
                        marginTop: 20, padding: '20px', borderRadius: 14, textAlign: 'center',
                        background: 'rgba(22,163,74,0.06)', border: '1px solid rgba(22,163,74,0.2)',
                    }}>
                        <div style={{ display: 'flex', justifyContent: 'center', color: '#16a34a', marginBottom: 8 }}>
                            <div style={{ width: 36, height: 36 }}>{ICONS.check}</div>
                        </div>
                        <div style={{ fontWeight: 800, fontSize: 15, color: '#16a34a', marginBottom: 4 }}>
                            All tasks complete!
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                            {verifiedCollected} stop{verifiedCollected !== 1 ? 's' : ''} verified today.
                        </div>
                    </div>
                )}

                {/* ── Empty state ── */}
                {!loading && totalToday === 0 && (
                    <div style={{
                        marginTop: 20, padding: '32px 20px', borderRadius: 14, textAlign: 'center',
                        background: 'var(--surface)', border: '1px solid var(--border)',
                    }}>
                        <div style={{ display: 'flex', justifyContent: 'center', color: 'var(--text-muted)', marginBottom: 10 }}>
                            <div style={{ width: 36, height: 36 }}>{ICONS.report}</div>
                        </div>
                        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 6 }}>No stops assigned today</div>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                            Check back later or contact your supervisor.
                        </div>
                    </div>
                )}

                {/* ── Back link ── */}
                <div style={{ marginTop: 24, textAlign: 'center' }}>
                    <button
                        onClick={() => navigate('/dashboard')}
                        style={{
                            background: 'none', border: 'none', color: 'var(--text-muted)',
                            fontSize: 13, cursor: 'pointer', fontFamily: 'var(--font-body)',
                            display: 'inline-flex', alignItems: 'center', gap: 5,
                        }}
                    >
                        ‹ Back to Dashboard
                    </button>
                </div>

            </div>
            <BottomNav />
        </>
    )
}