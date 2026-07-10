import React, { useState } from 'react'
import { compressImage } from '../utils/imageCompressor'
import GlobalCameraModal from './GlobalCameraModal'

const MAX_PHOTOS = 4

export default function MultiPhotoPicker({ photos, onChange, error }) {
    const [isCameraOpen, setIsCameraOpen] = useState(false)

    async function handleCapture(capturedData) {
        if (!capturedData) return
        const files = Array.isArray(capturedData) ? capturedData : [capturedData]
        
        const newPhotos = []
        for (const file of files) {
            const compressedFile = await compressImage(file)
            const base64Photo = await new Promise((resolve, reject) => {
              const reader = new FileReader()
              reader.onload = () => resolve(reader.result)
              reader.onerror = reject
              reader.readAsDataURL(compressedFile)
            })
            newPhotos.push(base64Photo)
        }

        const next = [...photos, ...newPhotos].slice(0, MAX_PHOTOS)
        onChange(next)
        setIsCameraOpen(false)
    }

    function removePhoto(idx) {
        onChange(photos.filter((_, i) => i !== idx))
    }

    return (
        <div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {photos.map((base64, idx) => (
                    <div key={idx} style={{ position: 'relative', width: 72, height: 72 }}>
                        <img
                            src={base64}
                            alt={`Photo ${idx + 1}`}
                            style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 10, border: '2px solid #e2e8f0' }}
                        />
                        <button
                            onClick={() => removePhoto(idx)}
                            type="button"
                            style={{
                                position: 'absolute', top: -6, right: -6,
                                width: 20, height: 20, borderRadius: '50%',
                                background: '#ef4444', color: '#fff', border: '2px solid #fff',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                fontSize: 10, fontWeight: 800, cursor: 'pointer',
                                boxShadow: '0 2px 6px rgba(0,0,0,.2)',
                                padding: 0,
                            }}
                        >×</button>
                    </div>
                ))}

                {photos.length < MAX_PHOTOS && (
                    <button
                        type="button"
                        onClick={() => setIsCameraOpen(true)}
                        style={{
                            width: 72, height: 72, borderRadius: 10,
                            border: `2px dashed ${photos.length === 0 ? '#ef4444' : '#cbd5e1'}`,
                            background: photos.length === 0 ? 'rgba(239,68,68,0.04)' : '#fafafa',
                            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                            cursor: 'pointer', gap: 4, padding: 0,
                        }}
                    >
                        <svg viewBox="0 0 24 24" fill="none" stroke={photos.length === 0 ? '#ef4444' : '#94a3b8'} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="22" height="22">
                            <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                            <circle cx="12" cy="13" r="4" />
                        </svg>
                        <span style={{ fontSize: 8, fontWeight: 700, color: photos.length === 0 ? '#ef4444' : '#94a3b8' }}>
                            {photos.length === 0 ? 'REQUIRED' : 'ADD'}
                        </span>
                    </button>
                )}
            </div>

            {error && (
                <p style={{ fontSize: 12, color: '#ef4444', marginTop: 8, fontWeight: 500 }}>
                    {error}
                </p>
            )}

            <GlobalCameraModal
                visible={isCameraOpen}
                onClose={() => setIsCameraOpen(false)}
                onCapture={handleCapture}
            />
        </div>
    )
}
