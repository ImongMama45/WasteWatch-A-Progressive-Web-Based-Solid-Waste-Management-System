/**
 * CommunityPreviewSection.jsx
 * ----------------------------
 * Reciprocal preview section displayed on the Announcements page (/announcements).
 * Heading: "This is what your community has to say."
 * Displays up to 3 real community discussion posts fetched from /api/community/posts/preview/
 * No emojis. Lucide icons only.
 */

import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import {
  Users,
  MessageSquare,
  ArrowRight,
  Heart,
  MapPin,
  Clock,
} from 'lucide-react'
import api from '../../../api/client'
import { FeedCardSkeleton } from '../../../components/ui/Skeleton'

function formatShortDate(dateString) {
  if (!dateString) return ''
  try {
    const d = new Date(dateString)
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  } catch {
    return ''
  }
}

export default function CommunityPreviewSection() {
  const [posts, setPosts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let active = true
    setError(null)
    api.get('/api/community/posts/preview/')
      .then(res => {
        if (active && Array.isArray(res.data)) {
          setPosts(res.data)
        }
      })
      .catch(err => {
        if (active) {
          console.error('Failed to load community preview:', err)
          setError(err)
        }
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => { active = false }
  }, [])

  return (
    <section
      aria-label="Community voices and discussions preview"
      style={{
        background: '#ffffff',
        borderRadius: 14,
        padding: '24px 26px',
        marginBottom: 28,
        border: '1px solid #e2e8f0',
        boxShadow: '0 1px 3px rgba(0, 0, 0, 0.03)',
      }}
    >
      {/* Section Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 16,
          flexWrap: 'wrap',
          gap: 12,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div
            style={{
              width: 34,
              height: 34,
              borderRadius: 8,
              background: '#f0fdf4',
              color: '#16a34a',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Users size={18} strokeWidth={2.2} />
          </div>
          <div>
            <span
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: '#16a34a',
                textTransform: 'uppercase',
                letterSpacing: 0.5,
              }}
            >
              Citizen Discussions
            </span>
            <h2 style={{ fontSize: 18, fontWeight: 800, color: '#0f172a', margin: 0 }}>
              This is what your community has to say.
            </h2>
          </div>
        </div>

        <Link
          to="/community"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 13,
            fontWeight: 700,
            color: '#16a34a',
            textDecoration: 'none',
            padding: '6px 12px',
            borderRadius: 8,
            background: '#f0fdf4',
            border: '1px solid #bbf7d0',
            transition: 'background 0.15s',
          }}
        >
          <span>Join the Conversation</span>
          <ArrowRight size={14} />
        </Link>
      </div>

      <p style={{ fontSize: 13, color: '#64748b', margin: '0 0 18px', lineHeight: 1.5 }}>
        Recent neighborhood feedback, collection inquiries, and environmental initiatives submitted by Lucena residents in the civic Community Forum.
      </p>

      {/* Content */}
      {loading ? (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            gap: 14,
          }}
        >
          {[1, 2, 3].map(n => (
            <FeedCardSkeleton key={n} count={1} compact />
          ))}
        </div>
      ) : error && posts.length === 0 ? (
        <div
          style={{
            background: '#f8fafc',
            border: '1px solid #e2e8f0',
            borderRadius: 10,
            padding: '24px 20px',
            textAlign: 'center',
          }}
        >
          <div style={{ fontSize: 14, fontWeight: 600, color: '#334155', marginBottom: 4 }}>
            Community discussions temporarily unavailable.
          </div>
          <div style={{ fontSize: 12.5, color: '#64748b', marginBottom: 14 }}>
            Please check back shortly or visit the Community Forum directly.
          </div>
          <Link
            to="/community"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              background: '#16a34a',
              color: '#ffffff',
              padding: '7px 16px',
              borderRadius: 8,
              fontSize: 12.5,
              fontWeight: 700,
              textDecoration: 'none',
            }}
          >
            <span>Visit Community</span>
            <ArrowRight size={13} />
          </Link>
        </div>
      ) : posts.length === 0 ? (
        <div
          style={{
            background: '#f8fafc',
            border: '1px solid #e2e8f0',
            borderRadius: 10,
            padding: '24px 20px',
            textAlign: 'center',
          }}
        >
          <div style={{ fontSize: 14, fontWeight: 600, color: '#334155', marginBottom: 4 }}>
            No community posts yet.
          </div>
          <div style={{ fontSize: 12.5, color: '#64748b', marginBottom: 14 }}>
            Be the first resident to start a neighborhood cleanliness conversation.
          </div>
          <Link
            to="/community"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              background: '#16a34a',
              color: '#ffffff',
              padding: '7px 16px',
              borderRadius: 8,
              fontSize: 12.5,
              fontWeight: 700,
              textDecoration: 'none',
            }}
          >
            <span>Start a Discussion</span>
            <ArrowRight size={13} />
          </Link>
        </div>
      ) : (
        <div
          className="ww-stagger"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            gap: 14,
          }}
        >
          {posts.map(post => (
            <Link
              key={post.id}
              to={`/community?post=${post.id}`}
              style={{
                textDecoration: 'none',
                background: '#f8fafc',
                border: '1px solid #e2e8f0',
                borderRadius: 10,
                padding: '14px 16px',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                transition: 'border-color 0.15s, box-shadow 0.15s',
              }}
            >
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: '#0f172a' }}>
                      {post.author_name}
                    </span>
                    {post.barangay_name && (
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 600,
                          color: '#15803d',
                          background: '#dcfce7',
                          padding: '1px 6px',
                          borderRadius: 4,
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 2,
                        }}
                      >
                        <MapPin size={10} />
                        {post.barangay_name}
                      </span>
                    )}
                  </div>
                  <span style={{ fontSize: 11, color: '#94a3b8' }}>
                    {formatShortDate(post.created_at)}
                  </span>
                </div>

                <p
                  style={{
                    fontSize: 13,
                    color: '#334155',
                    lineHeight: 1.5,
                    margin: '0 0 12px',
                    display: '-webkit-box',
                    WebkitLineClamp: 3,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                  }}
                >
                  {post.content}
                </p>
              </div>

              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  borderTop: '1px solid #edf2f7',
                  paddingTop: 8,
                  fontSize: 12,
                  color: '#64748b',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <Heart size={13} style={{ color: post.like_count > 0 ? '#e11d48' : '#94a3b8' }} />
                    {post.like_count || 0}
                  </span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <MessageSquare size={13} />
                    {post.comment_count || 0}
                  </span>
                </div>
                <span style={{ color: '#16a34a', fontWeight: 600, fontSize: 11, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <span>View Discussion</span>
                  <ArrowRight size={11} strokeWidth={2.5} />
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </section>
  )
}
