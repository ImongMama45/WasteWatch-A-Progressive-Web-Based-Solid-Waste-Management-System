/**
 * PreparednessSection.jsx
 * ------------------------
 * Storm, typhoon, flooding, and service disruption preparedness guide.
 * General solid waste management preparedness suggestions for Lucena City.
 * Zero emojis.
 */

import { CloudRain, ShieldCheck, CheckCircle2, ArrowRight } from 'lucide-react'

export default function PreparednessSection({ onSelectCategory }) {
  return (
    <section
      aria-label="Environmental and weather preparedness guidelines"
      style={{
        background: '#ffffff',
        border: '1px solid #e2e8f0',
        borderRadius: 14,
        padding: '22px 24px',
        marginBottom: 24,
        boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 16,
          flexWrap: 'wrap',
          marginBottom: 16,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: 10,
              background: '#ecfdf5',
              border: '1px solid #a7f3d0',
              color: '#059669',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <CloudRain size={22} strokeWidth={2} />
          </div>
          <div>
            <div
              style={{
                fontSize: 10,
                fontWeight: 800,
                letterSpacing: '.08em',
                textTransform: 'uppercase',
                color: '#059669',
                marginBottom: 2,
              }}
            >
              Preparedness Suggestions
            </div>
            <h3 style={{ fontSize: 16, fontWeight: 800, color: '#0f172a', margin: 0 }}>
              Storm &amp; Heavy Rain Waste Preparedness
            </h3>
          </div>
        </div>

        <button
          type="button"
          onClick={() => onSelectCategory?.('Advisories')}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '7px 14px',
            borderRadius: 8,
            background: '#f8fafc',
            border: '1px solid #cbd5e1',
            color: '#334155',
            fontSize: 12,
            fontWeight: 700,
            cursor: 'pointer',
            fontFamily: 'inherit',
            transition: 'background .15s',
          }}
        >
          View Collection Advisories
          <ArrowRight size={14} strokeWidth={2.2} />
        </button>
      </div>

      <p style={{ fontSize: 13, color: '#475569', lineHeight: 1.6, margin: '0 0 16px 0' }}>
        During severe weather disturbances and heavy rainfall in Lucena City,
        consider these general solid waste tips to help keep drainage clear and protect neighborhood safety:
      </p>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
          gap: 14,
        }}
      >
        <div
          style={{
            background: '#f8fafc',
            border: '1px solid #e2e8f0',
            borderRadius: 10,
            padding: '14px 16px',
            display: 'flex',
            gap: 10,
          }}
        >
          <CheckCircle2 size={18} strokeWidth={2.2} style={{ color: '#16a34a', flexShrink: 0, marginTop: 2 }} />
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#0f172a', marginBottom: 3 }}>
              Secure Waste Bins
            </div>
            <div style={{ fontSize: 12, color: '#64748b', lineHeight: 1.5 }}>
              Ensure outdoor bins have tied lids to prevent winds from scattering refuse across roadways.
            </div>
          </div>
        </div>

        <div
          style={{
            background: '#f8fafc',
            border: '1px solid #e2e8f0',
            borderRadius: 10,
            padding: '14px 16px',
            display: 'flex',
            gap: 10,
          }}
        >
          <CheckCircle2 size={18} strokeWidth={2.2} style={{ color: '#16a34a', flexShrink: 0, marginTop: 2 }} />
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#0f172a', marginBottom: 3 }}>
              Hold Waste Indoors During Signals
            </div>
            <div style={{ fontSize: 12, color: '#64748b', lineHeight: 1.5 }}>
              Do not place garbage bags on curbs during active flood warnings to prevent clogging drainage canals.
            </div>
          </div>
        </div>

        <div
          style={{
            background: '#f8fafc',
            border: '1px solid #e2e8f0',
            borderRadius: 10,
            padding: '14px 16px',
            display: 'flex',
            gap: 10,
          }}
        >
          <ShieldCheck size={18} strokeWidth={2.2} style={{ color: '#16a34a', flexShrink: 0, marginTop: 2 }} />
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#0f172a', marginBottom: 3 }}>
              Service Resumption
            </div>
            <div style={{ fontSize: 12, color: '#64748b', lineHeight: 1.5 }}>
              Collection schedules may be adjusted during storms. Check active city advisories for official updates on route resumption.
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
