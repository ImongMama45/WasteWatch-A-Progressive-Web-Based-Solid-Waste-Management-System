import React from 'react'
import { CheckCircle2, AlertTriangle, ShieldAlert, Wrench, Archive, Clock } from 'lucide-react'

const pillBase = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '2px 8px',
  borderRadius: 4,
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: '0.03em',
  whiteSpace: 'nowrap',
}

export function ConditionBadge({ condition }) {
  const val = String(condition || 'OPERATIONAL').toUpperCase()
  if (val === 'CRITICAL' || val === 'NON_OPERATIONAL') {
    return (
      <span style={{ ...pillBase, background: '#fee2e2', color: '#b91c1c', border: '1px solid #fecaca' }}>
        <AlertTriangle size={11} /> {val.replace(/_/g, ' ')}
      </span>
    )
  }
  if (val === 'NEEDS_REPAIR' || val === 'MINOR_DEFECT') {
    return (
      <span style={{ ...pillBase, background: '#fef3c7', color: '#b45309', border: '1px solid #fde68a' }}>
        <AlertTriangle size={11} /> {val.replace(/_/g, ' ')}
      </span>
    )
  }
  return (
    <span style={{ ...pillBase, background: '#e7f5eb', color: '#15803d', border: '1px solid #bbf7d0' }}>
      <CheckCircle2 size={11} /> {val.replace(/_/g, ' ')}
    </span>
  )
}

export function HoldBadge({ isHeld }) {
  if (!isHeld) {
    return (
      <span style={{ ...pillBase, background: '#f0f2f5', color: '#65676b', border: '1px solid #e4e6eb' }}>
        No Hold
      </span>
    )
  }
  return (
    <span style={{ ...pillBase, background: '#fee2e2', color: '#b91c1c', border: '1px solid #fecaca' }}>
      <ShieldAlert size={11} /> Operational Hold
    </span>
  )
}

export function MaintenanceBadge({ status }) {
  const val = String(status || 'available').toLowerCase()
  if (val === 'under_repair' || val === 'in_progress') {
    return (
      <span style={{ ...pillBase, background: '#fef3c7', color: '#b45309', border: '1px solid #fde68a' }}>
        <Wrench size={11} /> Under Repair
      </span>
    )
  }
  if (val === 'scheduled_maintenance' || val === 'scheduled') {
    return (
      <span style={{ ...pillBase, background: '#dbeafe', color: '#1d4ed8', border: '1px solid #bfdbfe' }}>
        <Clock size={11} /> Scheduled Maint.
      </span>
    )
  }
  if (val === 'completed') {
    return (
      <span style={{ ...pillBase, background: '#e7f5eb', color: '#15803d', border: '1px solid #bbf7d0' }}>
        <CheckCircle2 size={11} /> Completed
      </span>
    )
  }
  if (val === 'cancelled') {
    return (
      <span style={{ ...pillBase, background: '#f0f2f5', color: '#65676b', border: '1px solid #ced0d4' }}>
        Cancelled
      </span>
    )
  }
  return (
    <span style={{ ...pillBase, background: '#e7f5eb', color: '#15803d', border: '1px solid #bbf7d0' }}>
      Maint. Clear
    </span>
  )
}

export function RetirementBadge({ isRetired, retirementState }) {
  const retired = Boolean(
    isRetired ||
    retirementState === 'retired' ||
    retirementState === 'permanently_retired' ||
    retirementState === 'retirement_in_progress'
  )
  if (retired) {
    return (
      <span style={{ ...pillBase, background: '#f3f4f6', color: '#374151', border: '1px solid #d1d5db' }}>
        <Archive size={11} /> Retired
      </span>
    )
  }
  if (retirementState === 'uncommissioned' || retirementState === 'legacy_reconciliation') {
    return (
      <span style={{ ...pillBase, background: '#fef3c7', color: '#b45309', border: '1px solid #fde68a' }}>
        {retirementState === 'legacy_reconciliation' ? 'Legacy Unreconciled' : 'Uncommissioned'}
      </span>
    )
  }
  return (
    <span style={{ ...pillBase, background: '#eff6ff', color: '#1d4ed8', border: '1px solid #bfdbfe' }}>
      Commissioned
    </span>
  )
}

export function InspectionBadge({ state }) {
  const val = String(state || 'PENDING_INSPECTION').toUpperCase()
  if (val === 'PASSED') {
    return (
      <span style={{ ...pillBase, background: '#e7f5eb', color: '#15803d', border: '1px solid #bbf7d0' }}>
        <CheckCircle2 size={11} /> Passed
      </span>
    )
  }
  if (val === 'FAILED') {
    return (
      <span style={{ ...pillBase, background: '#fee2e2', color: '#b91c1c', border: '1px solid #fecaca' }}>
        <ShieldAlert size={11} /> Failed
      </span>
    )
  }
  return (
    <span style={{ ...pillBase, background: '#fef3c7', color: '#b45309', border: '1px solid #fde68a' }}>
      <Clock size={11} /> {val.replace(/_/g, ' ')}
    </span>
  )
}
