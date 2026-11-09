/**
 * CenroFacebookSection.jsx
 * -------------------------
 * Official Lucena City CENRO social media hub.
 * If VITE_CENRO_FB_PAGE_URL is configured, renders a responsive embed with fallback.
 * If no verified URL is configured, displays an informative official portal notice
 * with CENRO contact channels without blocking page load.
 * Zero emojis.
 */

import { useState, useMemo } from 'react'
import { Share2, ExternalLink, Building, Globe, CheckCircle2 } from 'lucide-react'
import { FeedCardSkeleton } from '../../../components/ui/Skeleton'

function getValidFacebookUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return null
  const trimmed = rawUrl.trim()
  if (!trimmed) return null
  try {
    const parsed = new URL(trimmed)
    if (parsed.protocol !== 'https:') return null
    const hostname = parsed.hostname.toLowerCase()
    const isApprovedHost =
      hostname === 'facebook.com' ||
      hostname.endsWith('.facebook.com') ||
      hostname === 'fb.com' ||
      hostname.endsWith('.fb.com')
    if (!isApprovedHost) return null
    return parsed.href
  } catch {
    return null
  }
}

export default function CenroFacebookSection() {
  const verifiedUrl = useMemo(
    () => getValidFacebookUrl(import.meta.env.VITE_CENRO_FB_PAGE_URL),
    []
  )
  const [embedFailed, setEmbedFailed] = useState(false)
  const [iframeLoaded, setIframeLoaded] = useState(false)

  // Encode URL for Facebook Page plugin iframe if verified URL exists
  const encodedUrl = verifiedUrl ? encodeURIComponent(verifiedUrl) : ''
  const iframeSrc = encodedUrl
    ? `https://www.facebook.com/plugins/page.php?href=${encodedUrl}&tabs=timeline&width=500&height=500&small_header=true&adapt_container_width=true&hide_cover=false&show_facepile=false`
    : ''

  return (
    <section
      aria-label="Official CENRO Facebook updates and communications"
      style={{
        background: '#ffffff',
        border: '1px solid #e2e8f0',
        borderRadius: 14,
        padding: '22px 24px',
        marginBottom: 24,
        boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 16,
          flexWrap: 'wrap',
          marginBottom: 16,
          paddingBottom: 14,
          borderBottom: '1px solid #f1f5f9',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: 10,
              background: '#eff6ff',
              border: '1px solid #bfdbfe',
              color: '#1d4ed8',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <Share2 size={20} strokeWidth={2.2} />
          </div>
          <div>
            <div
              style={{
                fontSize: 10,
                fontWeight: 800,
                letterSpacing: '.08em',
                textTransform: 'uppercase',
                color: '#1d4ed8',
                marginBottom: 2,
              }}
            >
              Official Public Communications
            </div>
            <h3 style={{ fontSize: 17, fontWeight: 800, color: '#0f172a', margin: 0 }}>
              Lucena City CENRO Social Media Hub
            </h3>
          </div>
        </div>

        {verifiedUrl && (
          <a
            href={verifiedUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 14px',
              borderRadius: 8,
              background: '#1d4ed8',
              color: '#ffffff',
              fontSize: 12,
              fontWeight: 700,
              textDecoration: 'none',
              transition: 'background .15s',
            }}
          >
            <span>Visit Facebook Page</span>
            <ExternalLink size={13} strokeWidth={2.5} />
          </a>
        )}
      </div>

      {/* Verified Embed or Informative Portal State */}
      {verifiedUrl && !embedFailed ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div
            style={{
              position: 'relative',
              width: '100%',
              maxWidth: 500,
              height: 420,
              margin: '0 auto',
              borderRadius: 10,
              overflow: 'hidden',
              border: '1px solid #e2e8f0',
              background: '#f8fafc',
            }}
          >
            {!iframeLoaded && (
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  zIndex: 2,
                  background: '#f8fafc',
                  padding: 12,
                }}
              >
                <FeedCardSkeleton count={1} showMedia />
              </div>
            )}
            <iframe
              title="Official Lucena City CENRO Facebook Page Feed"
              src={iframeSrc}
              width="100%"
              height="100%"
              style={{ border: 'none', overflow: 'hidden' }}
              scrolling="no"
              frameBorder="0"
              allowFullScreen={true}
              allow="autoplay; clipboard-write; encrypted-media; picture-in-picture; web-share"
              onLoad={() => setIframeLoaded(true)}
              onError={() => setEmbedFailed(true)}
            />
          </div>
          <p style={{ fontSize: 11, color: '#64748b', textAlign: 'center', margin: 0 }}>
            Updates loaded directly from the official City Environment and Natural Resources Office page.
          </p>
        </div>
      ) : (
        <div
          style={{
            background: '#f8fafc',
            border: '1px solid #e2e8f0',
            borderRadius: 10,
            padding: '20px 22px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, marginBottom: 16 }}>
            <Globe size={24} strokeWidth={1.8} style={{ color: '#2563eb', flexShrink: 0, marginTop: 2 }} />
            <div>
              <h4 style={{ fontSize: 14, fontWeight: 700, color: '#0f172a', margin: '0 0 4px 0' }}>
                Live Feed Embedding Ready for Official Configuration
              </h4>
              <p style={{ fontSize: 12, color: '#475569', margin: 0, lineHeight: 1.55 }}>
                Social feed embedding is fully integrated into WasteWatch. Once the verified CENRO Facebook page URL
                is provided in the deployment environment via <code>VITE_CENRO_FB_PAGE_URL</code>, public notices and
                community updates will render automatically in this panel.
              </p>
            </div>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              gap: 12,
              paddingTop: 14,
              borderTop: '1px solid #e2e8f0',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Building size={16} strokeWidth={2} style={{ color: '#0284c7', flexShrink: 0 }} />
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>
                  Inquiries &amp; Assistance
                </div>
                <div style={{ fontSize: 12, color: '#334155', fontWeight: 600 }}>
                  Lucena City Hall · CENRO Office
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Globe size={16} strokeWidth={2} style={{ color: '#16a34a', flexShrink: 0 }} />
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>
                  Official Updates
                </div>
                <div style={{ fontSize: 12, color: '#334155', fontWeight: 600 }}>
                  Public Information &amp; Advisories Hub
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <CheckCircle2 size={16} strokeWidth={2} style={{ color: '#059669', flexShrink: 0 }} />
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>
                  Service Scope
                </div>
                <div style={{ fontSize: 12, color: '#334155', fontWeight: 600 }}>
                  Solid Waste Management Services
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
