/**
 * CreatePostBox.jsx
 * -----------------
 * Civic Discussion Composer for the WasteWatch Community Forum.
 * Supports two distinct user intentions:
 * 1. Civic Discussion (Option A, Default Mode): Neighborhood cleanliness discussions,
 *    collection concerns, and community initiatives with mandatory category selection.
 * 2. Report A Problem (Option B): Visually distinguishable entry point for official
 *    waste problem reports (routed to Barangay Officials and CENRO Lucena).
 *
 * Strict Iconography Rule: Zero emojis. Lucide SVG icons only.
 */

import { useState, useRef } from 'react'
import {
  MessageSquare,
  AlertTriangle,
  Send,
  AlertCircle,
  MapPin,
  Lock,
  Sparkles,
  Calendar,
  HelpCircle,
  Info,
  Check,
  ArrowRight,
  FileText,
  RotateCcw,
} from 'lucide-react'
import { useAuth } from '../../../context/AuthContext'

export const CIVIC_CATEGORIES = [
  {
    key: 'schedule',
    label: 'Collection Schedule',
    description: 'Questions or discussions about collection schedules, missed pickups, and collection changes.',
    icon: Calendar,
    accent: '#0284c7',
    bg: '#f0f9ff',
    border: '#bae6fd',
  },
  {
    key: 'cleanup',
    label: 'Cleanup Initiative',
    description: 'Community cleanup activities and neighborhood cleanliness initiatives.',
    icon: Sparkles,
    accent: '#16a34a',
    bg: '#f0fdf4',
    border: '#bbf7d0',
  },
  {
    key: 'general',
    label: 'General Inquiry',
    description: 'Questions and discussions about solid waste management.',
    icon: HelpCircle,
    accent: '#7c3aed',
    bg: '#f5f3ff',
    border: '#ddd6fe',
  },
  {
    key: 'advisory',
    label: 'Civic Advisory',
    description: 'Community reminders and useful waste-management information.',
    icon: Info,
    accent: '#d97706',
    bg: '#fffbeb',
    border: '#fde68a',
  },
]

export default function CreatePostBox({ onPostCreated, onAuthRequired, onReportProblemClick }) {
  const { user, barangays } = useAuth()

  // Mode: 'discussion' (Option A, default) or 'report' (Option B)
  const [composerMode, setComposerMode] = useState('discussion')

  // Discussion state (Civic discussions are text-only)
  const [content, setContent] = useState('')
  const [category, setCategory] = useState('')
  const [selectedBarangay, setSelectedBarangay] = useState('')
  const [isExpanded, setIsExpanded] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)
  const [successNotice, setSuccessNotice] = useState(false)

  // Report entry point feedback state
  const [reportFeedback, setReportFeedback] = useState(null)

  const categorySectionRef = useRef(null)

  const maxChars = 2500
  const charCount = content.length

  const handleResetForm = () => {
    setContent('')
    setCategory('')
    setSelectedBarangay('')
    setError(null)
    setIsExpanded(false)
  }

  const handleDiscussionSubmit = async (e) => {
    e.preventDefault()
    if (!user) {
      if (onAuthRequired) onAuthRequired()
      return
    }

    const trimmed = content.trim()
    if (!trimmed) {
      setError('Please write some content for your discussion post.')
      return
    }

    if (trimmed.length < 3) {
      setError('Discussion content is too short (minimum 3 characters).')
      return
    }

    if (trimmed.length > maxChars) {
      setError(`Discussion content exceeds the ${maxChars} character limit.`)
      return
    }

    // Required Category Validation
    if (!category) {
      setError('Please select a category for your civic discussion.')
      if (categorySectionRef.current) {
        categorySectionRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
      }
      return
    }

    setSubmitting(true)
    setError(null)

    const formData = new FormData()
    formData.append('content', trimmed)
    formData.append('category', category)
    formData.append('post_type', 'discussion')

    const brgyId = selectedBarangay || user.barangay_id || user.barangay
    if (brgyId) {
      formData.append('barangay', brgyId)
    }

    const res = await onPostCreated(formData)
    setSubmitting(false)

    if (res.success) {
      handleResetForm()
      setSuccessNotice(true)
      setTimeout(() => setSuccessNotice(false), 4000)
    } else {
      // Preserve content and category on failure
      setError(res.error || 'Failed to submit discussion. Please try again.')
    }
  }

  const handleReportProblemTrigger = () => {
    if (!user) {
      if (onAuthRequired) onAuthRequired()
      return
    }

    if (onReportProblemClick) {
      onReportProblemClick()
    }
  }

  // If user is unauthenticated, show an invitation box
  if (!user) {
    return (
      <div
        style={{
          background: '#ffffff',
          borderRadius: 14,
          padding: '22px 24px',
          border: '1px solid #e2e8f0',
          marginBottom: 22,
          boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 12,
              background: '#f0fdf4',
              color: '#16a34a',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <Lock size={22} />
          </div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#0f172a' }}>
              Join the Lucena City Civic Discussion
            </div>
            <div style={{ fontSize: 13, color: '#64748b', marginTop: 2 }}>
              Sign in with your account to start discussions, share neighborhood updates, or request official assistance.
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={onAuthRequired}
          style={{
            background: '#16a34a',
            color: '#ffffff',
            border: 'none',
            borderRadius: 8,
            padding: '10px 20px',
            fontSize: 13,
            fontWeight: 700,
            cursor: 'pointer',
            transition: 'background 0.15s ease',
            whiteSpace: 'nowrap',
          }}
        >
          Sign In to Participate
        </button>
      </div>
    )
  }

  return (
    <div
      style={{
        background: '#ffffff',
        borderRadius: 14,
        border: '1px solid #e2e8f0',
        marginBottom: 24,
        boxShadow: '0 2px 4px rgba(0,0,0,0.02)',
        overflow: 'hidden',
      }}
    >
      {/* Intention Selector Header */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          borderBottom: '1px solid #e2e8f0',
          background: '#f8fafc',
        }}
      >
        {/* Mode A: Civic Discussion */}
        <button
          type="button"
          onClick={() => {
            setComposerMode('discussion')
            setError(null)
          }}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            padding: '13px 16px',
            background: composerMode === 'discussion' ? '#ffffff' : 'transparent',
            border: 'none',
            borderBottom: composerMode === 'discussion' ? '2.5px solid #16a34a' : '2.5px solid transparent',
            color: composerMode === 'discussion' ? '#16a34a' : '#64748b',
            fontSize: 13.5,
            fontWeight: composerMode === 'discussion' ? 700 : 600,
            cursor: 'pointer',
            transition: 'all 0.15s ease',
          }}
        >
          <MessageSquare size={16} />
          <span>Civic Discussion</span>
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              padding: '2px 7px',
              borderRadius: 10,
              background: composerMode === 'discussion' ? '#dcfce7' : '#e2e8f0',
              color: composerMode === 'discussion' ? '#15803d' : '#64748b',
            }}
          >
            Forum
          </span>
        </button>

        {/* Mode B: Report A Problem */}
        <button
          type="button"
          onClick={() => {
            setComposerMode('report')
            setError(null)
          }}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            padding: '13px 16px',
            background: composerMode === 'report' ? '#ffffff' : 'transparent',
            border: 'none',
            borderBottom: composerMode === 'report' ? '2.5px solid #f59e0b' : '2.5px solid transparent',
            color: composerMode === 'report' ? '#b45309' : '#64748b',
            fontSize: 13.5,
            fontWeight: composerMode === 'report' ? 700 : 600,
            cursor: 'pointer',
            transition: 'all 0.15s ease',
          }}
        >
          <AlertTriangle size={16} style={{ color: composerMode === 'report' ? '#d97706' : '#94a3b8' }} />
          <span>Report A Problem</span>
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              padding: '2px 7px',
              borderRadius: 10,
              background: composerMode === 'report' ? '#fef3c7' : '#e2e8f0',
              color: composerMode === 'report' ? '#92400e' : '#64748b',
            }}
          >
            Official Action
          </span>
        </button>
      </div>

      {/* COMPOSER BODY */}
      <div style={{ padding: '20px 22px' }}>
        {/* ============================================================== */}
        {/* OPTION A: CIVIC DISCUSSION FORM                                */}
        {/* ============================================================== */}
        {composerMode === 'discussion' && (
          <div>
            {/* Author Attribution Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: '50%',
                    background: '#16a34a',
                    color: '#ffffff',
                    fontSize: 14,
                    fontWeight: 800,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                    overflow: 'hidden',
                  }}
                >
                  {user.profile_pic ? (
                    <img src={user.profile_pic} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    (user.full_name || user.username || 'U').charAt(0).toUpperCase()
                  )}
                </div>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#0f172a', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span>{user.full_name || user.username}</span>
                    {user.role && user.role !== 'citizen' && (
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 700,
                          padding: '1px 6px',
                          borderRadius: 4,
                          background: '#e0f2fe',
                          color: '#0369a1',
                          textTransform: 'uppercase',
                        }}
                      >
                        {user.role.replace('_', ' ')}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 12, color: '#64748b', display: 'flex', alignItems: 'center', gap: 4 }}>
                    <MapPin size={12} style={{ color: '#16a34a' }} />
                    <span>{user.barangay_name || 'Lucena City Resident'}</span>
                  </div>
                </div>
              </div>

              {isExpanded && (
                <button
                  type="button"
                  onClick={handleResetForm}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: '#94a3b8',
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    padding: '4px 6px',
                  }}
                  title="Collapse and reset"
                >
                  <RotateCcw size={12} />
                  <span>Collapse</span>
                </button>
              )}
            </div>

            {/* Success Notice */}
            {successNotice && (
              <div
                style={{
                  background: '#f0fdf4',
                  border: '1px solid #bbf7d0',
                  borderRadius: 8,
                  padding: '10px 14px',
                  marginBottom: 14,
                  fontSize: 13,
                  color: '#15803d',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                <Check size={16} />
                <span>Your civic discussion has been published to the community feed.</span>
              </div>
            )}

            {/* Error Banner */}
            {error && (
              <div
                style={{
                  background: '#fef2f2',
                  border: '1px solid #fecaca',
                  borderRadius: 8,
                  padding: '10px 14px',
                  marginBottom: 14,
                  fontSize: 13,
                  color: '#b91c1c',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                <AlertCircle size={16} style={{ flexShrink: 0 }} />
                <span>{error}</span>
              </div>
            )}

            <form onSubmit={handleDiscussionSubmit}>
              {/* Textarea */}
              <textarea
                value={content}
                onChange={(e) => {
                  setContent(e.target.value)
                  if (!isExpanded) setIsExpanded(true)
                }}
                onFocus={() => setIsExpanded(true)}
                placeholder="What would you like to discuss with your neighbors or community coordinators about waste and cleanliness in Lucena City?"
                rows={isExpanded ? 4 : 2}
                maxLength={maxChars}
                style={{
                  width: '100%',
                  padding: '12px 14px',
                  borderRadius: 10,
                  border: '1px solid #cbd5e1',
                  fontSize: 14,
                  fontFamily: 'inherit',
                  lineHeight: 1.5,
                  resize: 'vertical',
                  boxSizing: 'border-box',
                  outline: 'none',
                  background: '#f8fafc',
                  color: '#0f172a',
                  transition: 'border 0.15s, background 0.15s',
                }}
              />

              {/* Collapsed expansion helper or full expanded controls */}
              {isExpanded && (
                <>
                  {/* REQUIRED CIVIC CATEGORY SELECTOR */}
                  <div
                    ref={categorySectionRef}
                    style={{
                      marginTop: 16,
                      padding: '14px 16px',
                      background: '#f8fafc',
                      borderRadius: 10,
                      border: !category && error ? '1.5px solid #f87171' : '1px solid #e2e8f0',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontSize: 13, fontWeight: 700, color: '#0f172a' }}>
                          Select Discussion Category
                        </span>
                        <span style={{ color: '#dc2626', fontSize: 13, fontWeight: 700 }}>*</span>
                        <span style={{ fontSize: 11, color: '#64748b' }}>(Required)</span>
                      </div>
                      {category && (
                        <span style={{ fontSize: 11, color: '#16a34a', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 3 }}>
                          <Check size={12} />
                          Selected
                        </span>
                      )}
                    </div>

                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))',
                        gap: 10,
                      }}
                    >
                      {CIVIC_CATEGORIES.map((cat) => {
                        const IconComponent = cat.icon
                        const isSelected = category === cat.key
                        return (
                          <div
                            key={cat.key}
                            onClick={() => {
                              setCategory(cat.key)
                              if (error && error.includes('category')) setError(null)
                            }}
                            role="button"
                            tabIndex={0}
                            style={{
                              padding: '10px 12px',
                              borderRadius: 8,
                              border: isSelected ? '2px solid #16a34a' : '1px solid #cbd5e1',
                              background: isSelected ? '#f0fdf4' : '#ffffff',
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'flex-start',
                              gap: 10,
                              transition: 'all 0.15s ease',
                              outline: 'none',
                            }}
                          >
                            <div
                              style={{
                                width: 28,
                                height: 28,
                                borderRadius: 6,
                                background: isSelected ? '#dcfce7' : cat.bg,
                                color: isSelected ? '#15803d' : cat.accent,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                flexShrink: 0,
                                marginTop: 1,
                              }}
                            >
                              <IconComponent size={15} />
                            </div>
                            <div style={{ flex: 1 }}>
                              <div
                                style={{
                                  fontSize: 13,
                                  fontWeight: 700,
                                  color: isSelected ? '#15803d' : '#0f172a',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'space-between',
                                }}
                              >
                                <span>{cat.label}</span>
                                {isSelected && <Check size={14} style={{ color: '#16a34a' }} />}
                              </div>
                              <div
                                style={{
                                  fontSize: 11,
                                  color: '#64748b',
                                  marginTop: 3,
                                  lineHeight: 1.35,
                                }}
                              >
                                {cat.description}
                              </div>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>

                  {/* Toolbar Row */}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      marginTop: 14,
                      flexWrap: 'wrap',
                      gap: 10,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                      {/* Optional Barangay Tag Selector */}
                      {barangays && barangays.length > 0 && (
                        <select
                          value={selectedBarangay}
                          onChange={(e) => setSelectedBarangay(e.target.value)}
                          style={{
                            padding: '7px 10px',
                            borderRadius: 8,
                            border: '1px solid #cbd5e1',
                            background: '#ffffff',
                            color: '#475569',
                            fontSize: 12,
                            fontFamily: 'inherit',
                            outline: 'none',
                          }}
                        >
                          <option value="">
                            {user.barangay_name ? `Tag: ${user.barangay_name}` : 'Tag Barangay (Optional)'}
                          </option>
                          {barangays.map(b => (
                            <option key={b.id} value={b.id}>
                              {b.name}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>

                    {/* Character Counter & Actions */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <span
                        style={{
                          fontSize: 12,
                          color: charCount > 2400 ? '#dc2626' : '#94a3b8',
                          fontWeight: charCount > 2400 ? 700 : 500,
                        }}
                      >
                        {charCount} / {maxChars}
                      </span>

                      <button
                        type="button"
                        onClick={handleResetForm}
                        style={{
                          padding: '8px 14px',
                          borderRadius: 8,
                          border: '1px solid #cbd5e1',
                          background: '#ffffff',
                          color: '#64748b',
                          fontSize: 13,
                          fontWeight: 600,
                          cursor: 'pointer',
                        }}
                      >
                        Cancel
                      </button>

                      <button
                        type="submit"
                        disabled={submitting || !content.trim()}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 6,
                          padding: '8px 18px',
                          borderRadius: 8,
                          border: 'none',
                          background: '#16a34a',
                          color: '#ffffff',
                          fontSize: 13,
                          fontWeight: 700,
                          cursor: submitting || !content.trim() ? 'not-allowed' : 'pointer',
                          opacity: submitting || !content.trim() ? 0.6 : 1,
                          transition: 'background 0.15s ease',
                        }}
                      >
                        <Send size={14} />
                        <span>{submitting ? 'Publishing...' : 'Publish Discussion'}</span>
                      </button>
                    </div>
                  </div>
                </>
              )}
            </form>
          </div>
        )}

        {/* ============================================================== */}
        {/* OPTION B: REPORT A PROBLEM ENTRY POINT                         */}
        {/* ============================================================== */}
        {composerMode === 'report' && (
          <div
            style={{
              padding: '18px 20px',
              borderRadius: 10,
              background: '#fffbeb',
              border: '1.5px dashed #f59e0b',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
              <div
                style={{
                  width: 42,
                  height: 42,
                  borderRadius: 10,
                  background: '#fef3c7',
                  color: '#b45309',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <AlertTriangle size={22} />
              </div>

              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <h3 style={{ fontSize: 16, fontWeight: 800, color: '#92400e', margin: 0 }}>
                    Official Waste Problem Report
                  </h3>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      padding: '2px 8px',
                      borderRadius: 12,
                      background: '#fef3c7',
                      color: '#b45309',
                      border: '1px solid #fde68a',
                    }}
                  >
                    CENRO Lucena & Barangay Inspection
                  </span>
                </div>

                <p
                  style={{
                    fontSize: 13.5,
                    color: '#78350f',
                    lineHeight: 1.55,
                    margin: '8px 0 14px',
                  }}
                >
                  This option creates an authoritative waste report for illegal dumpsites, overflowing collection points,
                  or hazardous waste. Official reports are verified by Barangay Officials, published to the city hotspot map,
                  and scheduled for municipal truck collection dispatch.
                </p>

                <div
                  style={{
                    background: 'rgba(255, 255, 255, 0.75)',
                    borderRadius: 8,
                    padding: '10px 12px',
                    border: '1px solid #fde68a',
                    fontSize: 12.5,
                    color: '#92400e',
                    marginBottom: 16,
                    lineHeight: 1.45,
                  }}
                >
                  <strong>Note:</strong> Civic Discussions in the community feed cannot be converted into official collection dispatches.
                  To request official municipal waste collection or investigation, submit via the official report workflow.
                </div>

                {reportFeedback && (
                  <div
                    style={{
                      background: '#eff6ff',
                      border: '1px solid #bfdbfe',
                      borderRadius: 8,
                      padding: '9px 12px',
                      fontSize: 12.5,
                      color: '#1d4ed8',
                      marginBottom: 14,
                    }}
                  >
                    {reportFeedback}
                  </div>
                )}

                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    onClick={handleReportProblemTrigger}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 7,
                      padding: '10px 18px',
                      borderRadius: 8,
                      border: 'none',
                      background: '#d97706',
                      color: '#ffffff',
                      fontSize: 13,
                      fontWeight: 700,
                      cursor: 'pointer',
                      transition: 'background 0.15s ease',
                    }}
                  >
                    <FileText size={16} />
                    <span>Open Official Report Form</span>
                    <ArrowRight size={14} />
                  </button>

                  <button
                    type="button"
                    onClick={() => setComposerMode('discussion')}
                    style={{
                      padding: '10px 16px',
                      borderRadius: 8,
                      border: '1px solid #d1d5db',
                      background: '#ffffff',
                      color: '#4b5563',
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    Return to Civic Discussion
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
