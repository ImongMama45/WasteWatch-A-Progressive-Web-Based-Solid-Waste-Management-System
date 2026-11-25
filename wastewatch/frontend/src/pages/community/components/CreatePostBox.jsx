/**
 * CreatePostBox.jsx
 * -----------------
 * Civic Discussion Composer for the WasteWatch Community Forum.
 * Reddit-inspired input bar entry point that expands smoothly into a clean composer.
 *
 * Supports two distinct user intentions:
 * 1. Civic Discussion (Default): Neighborhood cleanliness discussions with required category selection.
 * 2. Report A Problem: Opens official waste problem report workflow.
 *
 * Strict Iconography Rule: Zero emojis. Lucide SVG icons only.
 */

import { useState, useRef, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
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
    description: 'Collection schedules, route delays, or pickup inquiries.',
    icon: Calendar,
  },
  {
    key: 'cleanup',
    label: 'Cleanup Initiative',
    description: 'Community cleanup activities and neighborhood drives.',
    icon: Sparkles,
  },
  {
    key: 'general',
    label: 'General Inquiry',
    description: 'Questions and discussions about municipal waste management.',
    icon: HelpCircle,
  },
  {
    key: 'advisory',
    label: 'Civic Advisory',
    description: 'Helpful reminders and community cleanliness tips.',
    icon: Info,
  },
]

export default function CreatePostBox({ onPostCreated, onAuthRequired, onReportProblemClick }) {
  const { user, barangays } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()

  const [composerMode, setComposerMode] = useState('discussion')
  const [content, setContent] = useState('')
  const [category, setCategory] = useState('')
  const [selectedBarangay, setSelectedBarangay] = useState('')
  const [isExpanded, setIsExpanded] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)
  const [successNotice, setSuccessNotice] = useState(false)

  const categorySectionRef = useRef(null)

  // Handle prefilled topics from map pages (?topic=...&brgy=...)
  useEffect(() => {
    const topic = searchParams.get('topic')
    if (topic) {
      setContent(prev => prev ? prev : `Regarding ${topic}:\n\n`)
      setIsExpanded(true)
      const cat = searchParams.get('category') || 'general'
      setCategory(cat)
      const brgy = searchParams.get('brgy')
      if (brgy && barangays?.length) {
        const found = barangays.find(b => String(b.id) === String(brgy) || b.name?.toLowerCase() === brgy.toLowerCase())
        if (found) setSelectedBarangay(String(found.id))
      }
      setSearchParams(prev => {
        const next = new URLSearchParams(prev)
        next.delete('topic')
        next.delete('category')
        next.delete('brgy')
        return next
      }, { replace: true })
    }
  }, [searchParams, setSearchParams, barangays])

  const maxChars = 2500
  const charCount = content.length

  const handleResetForm = () => {
    setContent('')
    setCategory('')
    setSelectedBarangay('')
    setError(null)
    setIsExpanded(false)
    setComposerMode('discussion')
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

  // Unauthenticated: clean Reddit-style sign-in banner
  if (!user) {
    return (
      <div
        style={{
          background: '#ffffff',
          borderRadius: 8,
          padding: '12px 16px',
          border: '1px solid #e2e8f0',
          marginBottom: 16,
          boxShadow: '0 1px 2px rgba(15, 23, 42, 0.03)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Lock size={16} style={{ color: '#16a34a', flexShrink: 0 }} />
          <span style={{ fontSize: 13.5, color: '#475569', fontWeight: 500 }}>
            Sign in to start discussions, share neighborhood updates, or report civic issues.
          </span>
        </div>
        <button
          type="button"
          onClick={onAuthRequired}
          style={{
            background: '#16a34a',
            color: '#ffffff',
            border: 'none',
            borderRadius: 6,
            padding: '7px 14px',
            fontSize: 12.5,
            fontWeight: 700,
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          Sign In
        </button>
      </div>
    )
  }

  // Authenticated Collapsed State (Reddit-style compact input bar)
  if (!isExpanded && composerMode === 'discussion' && !content.trim()) {
    return (
      <div
        style={{
          background: '#ffffff',
          borderRadius: 8,
          border: '1px solid #e2e8f0',
          padding: '8px 12px',
          marginBottom: 16,
          boxShadow: '0 1px 2px rgba(15, 23, 42, 0.03)',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
        }}
      >
        {/* User avatar */}
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: '50%',
            background: '#16a34a',
            color: '#ffffff',
            fontSize: 13,
            fontWeight: 700,
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

        {/* Input placeholder */}
        <div
          role="button"
          tabIndex={0}
          onClick={() => setIsExpanded(true)}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setIsExpanded(true) }}
          style={{
            flex: 1,
            background: '#f8fafc',
            border: '1px solid #e2e8f0',
            borderRadius: 6,
            padding: '8px 12px',
            color: '#64748b',
            fontSize: 13,
            cursor: 'text',
            transition: 'border-color 0.15s, background 0.15s',
          }}
        >
          Start a civic discussion or report a waste concern...
        </div>

        {/* Quick Report Issue Button */}
        <button
          type="button"
          onClick={handleReportProblemTrigger}
          title="File an official waste problem report"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 5,
            padding: '7px 12px',
            borderRadius: 6,
            border: '1px solid #e2e8f0',
            background: '#ffffff',
            color: '#475569',
            fontSize: 12.5,
            fontWeight: 600,
            cursor: 'pointer',
            flexShrink: 0,
            transition: 'background 0.15s',
          }}
        >
          <AlertTriangle size={14} style={{ color: '#d97706' }} />
          <span>Report Problem</span>
        </button>
      </div>
    )
  }

  // Expanded Composer
  return (
    <div
      style={{
        background: '#ffffff',
        borderRadius: 8,
        border: '1px solid #cbd5e1',
        marginBottom: 16,
        boxShadow: '0 2px 6px rgba(15, 23, 42, 0.04)',
        overflow: 'hidden',
      }}
    >
      {/* Mode Selector Tabs */}
      <div
        style={{
          display: 'flex',
          borderBottom: '1px solid #e2e8f0',
          background: '#f8fafc',
        }}
      >
        <button
          type="button"
          onClick={() => {
            setComposerMode('discussion')
            setError(null)
          }}
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            padding: '10px 14px',
            background: composerMode === 'discussion' ? '#ffffff' : 'transparent',
            border: 'none',
            borderBottom: composerMode === 'discussion' ? '2px solid #16a34a' : '2px solid transparent',
            color: composerMode === 'discussion' ? '#15803d' : '#64748b',
            fontSize: 13,
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          <MessageSquare size={15} />
          <span>Civic Discussion</span>
        </button>

        <button
          type="button"
          onClick={() => {
            setComposerMode('report')
            setError(null)
          }}
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            padding: '10px 14px',
            background: composerMode === 'report' ? '#ffffff' : 'transparent',
            border: 'none',
            borderBottom: composerMode === 'report' ? '2px solid #d97706' : '2px solid transparent',
            color: composerMode === 'report' ? '#b45309' : '#64748b',
            fontSize: 13,
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          <AlertTriangle size={15} style={{ color: composerMode === 'report' ? '#d97706' : '#94a3b8' }} />
          <span>Report A Problem</span>
        </button>
      </div>

      <div style={{ padding: '14px 16px' }}>
        {/* Mode A: Civic Discussion */}
        {composerMode === 'discussion' && (
          <div>
            {/* Header: Author & Collapse */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: '50%',
                    background: '#16a34a',
                    color: '#ffffff',
                    fontSize: 12,
                    fontWeight: 700,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    overflow: 'hidden',
                  }}
                >
                  {user.profile_pic ? (
                    <img src={user.profile_pic} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    (user.full_name || user.username || 'U').charAt(0).toUpperCase()
                  )}
                </div>
                <span style={{ fontSize: 13, fontWeight: 700, color: '#0f172a' }}>
                  {user.full_name || user.username}
                </span>
                {user.barangay_name && (
                  <span style={{ fontSize: 11.5, color: '#64748b' }}>
                    · {user.barangay_name}
                  </span>
                )}
              </div>

              <button
                type="button"
                onClick={handleResetForm}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#64748b',
                  fontSize: 11.5,
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 3,
                }}
              >
                <RotateCcw size={11} />
                <span>Cancel</span>
              </button>
            </div>

            {/* Success Notice */}
            {successNotice && (
              <div
                style={{
                  background: '#f0fdf4',
                  border: '1px solid #bbf7d0',
                  borderRadius: 6,
                  padding: '8px 12px',
                  marginBottom: 10,
                  fontSize: 12.5,
                  color: '#15803d',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <Check size={14} />
                <span>Your discussion has been published to the community feed.</span>
              </div>
            )}

            {/* Error Banner */}
            {error && (
              <div
                style={{
                  background: '#fef2f2',
                  border: '1px solid #fecaca',
                  borderRadius: 6,
                  padding: '8px 12px',
                  marginBottom: 10,
                  fontSize: 12.5,
                  color: '#b91c1c',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <AlertCircle size={14} style={{ flexShrink: 0 }} />
                <span>{error}</span>
              </div>
            )}

            <form onSubmit={handleDiscussionSubmit}>
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="What would you like to discuss about waste and cleanliness in Lucena City?"
                rows={3}
                maxLength={maxChars}
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  borderRadius: 6,
                  border: '1px solid #cbd5e1',
                  fontSize: 13.5,
                  fontFamily: 'inherit',
                  lineHeight: 1.5,
                  resize: 'vertical',
                  boxSizing: 'border-box',
                  outline: 'none',
                  background: '#ffffff',
                  color: '#0f172a',
                }}
              />

              {/* Category Selector Chips */}
              <div ref={categorySectionRef} style={{ marginTop: 10, marginBottom: 10 }}>
                <div style={{ fontSize: 11.5, fontWeight: 700, color: '#475569', marginBottom: 6 }}>
                  Select Category <span style={{ color: '#dc2626' }}>*</span>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {CIVIC_CATEGORIES.map((cat) => {
                    const isSelected = category === cat.key
                    const IconComp = cat.icon
                    return (
                      <button
                        key={cat.key}
                        type="button"
                        onClick={() => {
                          setCategory(cat.key)
                          if (error && error.includes('category')) setError(null)
                        }}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 5,
                          padding: '5px 10px',
                          borderRadius: 20,
                          border: isSelected ? '1px solid #16a34a' : '1px solid #e2e8f0',
                          background: isSelected ? '#f0fdf4' : '#f8fafc',
                          color: isSelected ? '#15803d' : '#475569',
                          fontSize: 12,
                          fontWeight: isSelected ? 700 : 500,
                          cursor: 'pointer',
                          transition: 'all 0.15s ease',
                        }}
                      >
                        <IconComp size={12} />
                        <span>{cat.label}</span>
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Bottom Row: Tag Barangay, Chars & Submit */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  paddingTop: 8,
                  borderTop: '1px solid #f1f5f9',
                  flexWrap: 'wrap',
                  gap: 8,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {barangays && barangays.length > 0 && (
                    <select
                      value={selectedBarangay}
                      onChange={(e) => setSelectedBarangay(e.target.value)}
                      style={{
                        padding: '5px 8px',
                        borderRadius: 6,
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

                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 11.5, color: charCount > 2400 ? '#dc2626' : '#94a3b8' }}>
                    {charCount} / {maxChars}
                  </span>

                  <button
                    type="submit"
                    disabled={submitting || !content.trim()}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 5,
                      padding: '7px 14px',
                      borderRadius: 6,
                      border: 'none',
                      background: '#16a34a',
                      color: '#ffffff',
                      fontSize: 12.5,
                      fontWeight: 700,
                      cursor: submitting || !content.trim() ? 'not-allowed' : 'pointer',
                      opacity: submitting || !content.trim() ? 0.6 : 1,
                    }}
                  >
                    <Send size={13} />
                    <span>{submitting ? 'Publishing…' : 'Publish'}</span>
                  </button>
                </div>
              </div>
            </form>
          </div>
        )}

        {/* Mode B: Report A Problem Entry Point */}
        {composerMode === 'report' && (
          <div style={{ padding: '4px 0' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
              <AlertTriangle size={18} style={{ color: '#d97706', flexShrink: 0, marginTop: 2 }} />
              <div>
                <h3 style={{ fontSize: 14, fontWeight: 800, color: '#0f172a', margin: '0 0 4px' }}>
                  Official Waste Problem Report
                </h3>
                <p style={{ fontSize: 12.5, color: '#475569', lineHeight: 1.5, margin: '0 0 12px' }}>
                  This option creates an authoritative waste report for illegal dumpsites, overflowing collection points,
                  or hazardous waste. Reports are reviewed by Barangay Officials and CENRO Lucena for municipal collection dispatch.
                </p>

                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <button
                    type="button"
                    onClick={handleReportProblemTrigger}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 5,
                      padding: '7px 14px',
                      borderRadius: 6,
                      border: 'none',
                      background: '#16a34a',
                      color: '#ffffff',
                      fontSize: 12.5,
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    <FileText size={14} />
                    <span>Open Official Report Form</span>
                    <ArrowRight size={13} />
                  </button>

                  <button
                    type="button"
                    onClick={() => setComposerMode('discussion')}
                    style={{
                      padding: '7px 12px',
                      borderRadius: 6,
                      border: '1px solid #cbd5e1',
                      background: '#ffffff',
                      color: '#475569',
                      fontSize: 12.5,
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    Back to Discussion
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
