import React, { useState, useEffect } from 'react'
import { compressImage } from '../utils/imageCompressor'
import GlobalCameraModal from './GlobalCameraModal'
import { Camera, Plus, X } from 'lucide-react'

const MAX_PHOTOS = 4

export default function MultiPhotoPicker({ photos, onChange, error }) {
    const [isCameraOpen, setIsCameraOpen] = useState(false)
    const [previews, setPreviews] = useState([])

    // Automatically generate previews when `photos` changes
    useEffect(() => {
        const newUrls = photos.map(photo => {
            if (typeof photo === 'string') return photo // Already a URL or Base64
            if (photo instanceof Blob || photo instanceof File) return URL.createObjectURL(photo)
            return null
        }).filter(Boolean)
        setPreviews(newUrls)

        return () => {
            // Clean up Blob URLs if they are not base64
            newUrls.forEach(url => {
                if (url.startsWith('blob:')) URL.revokeObjectURL(url)
            })
        }
    }, [photos])

    async function handleCapture(capturedData) {
        if (!capturedData) return
        const files = Array.isArray(capturedData) ? capturedData : [capturedData]

        const compressedFiles = []
        for (const file of files) {
            const compressedFile = await compressImage(file)
            compressedFiles.push(compressedFile)
        }

        const next = [...photos, ...compressedFiles].slice(0, MAX_PHOTOS)
        onChange(next)
        setIsCameraOpen(false)
    }

    function removePhoto(idx) {
        onChange(photos.filter((_, i) => i !== idx))
    }

    const hasError = Boolean(error)

    return (
        <div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                {previews.map((previewUrl, idx) => (
                    <div key={idx} style={{ position: 'relative', width: 76, height: 76 }}>
                        <img
                            src={previewUrl}
                            alt={`Report evidence ${idx + 1}`}
                            style={{
                                width: 76,
                                height: 76,
                                objectFit: 'cover',
                                borderRadius: 12,
                                border: '2px solid #2e7d32',
                                boxShadow: '0 2px 8px rgba(46, 125, 50, 0.15)',
                            }}
                        />
                        <button
                            onClick={() => removePhoto(idx)}
                            type="button"
                            aria-label="Remove photo"
                            style={{
                                position: 'absolute', top: -6, right: -6,
                                width: 22, height: 22, borderRadius: '50%',
                                background: '#dc2626', color: '#fff', border: '2px solid #fff',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                cursor: 'pointer',
                                boxShadow: '0 2px 6px rgba(0,0,0,.25)',
                                padding: 0,
                                transition: 'transform 0.15s ease',
                            }}
                        >
                            <X size={12} strokeWidth={3} />
                        </button>
                    </div>
                ))}

                {photos.length < MAX_PHOTOS && (
                    <button
                        type="button"
                        onClick={() => setIsCameraOpen(true)}
                        style={{
                            width: 76,
                            height: 76,
                            borderRadius: 12,
                            border: `2px dashed ${hasError ? '#dc2626' : photos.length === 0 ? '#2e7d32' : '#cbd5e1'}`,
                            background: hasError ? 'rgba(239, 68, 68, 0.05)' : photos.length === 0 ? '#f0f7ec' : '#f8faf5',
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            justifyContent: 'center',
                            cursor: 'pointer',
                            gap: 4,
                            padding: 0,
                            transition: 'all 0.2s ease',
                        }}
                    >
                        {photos.length === 0 ? (
                            <Camera size={22} color={hasError ? '#dc2626' : '#2e7d32'} />
                        ) : (
                            <Plus size={22} color="#4a6741" />
                        )}
                        <span style={{
                            fontSize: 9,
                            fontWeight: 800,
                            letterSpacing: '0.04em',
                            color: hasError ? '#dc2626' : photos.length === 0 ? '#2e7d32' : '#4a6741',
                        }}>
                            {photos.length === 0 ? 'CAPTURE' : 'ADD'}
                        </span>
                    </button>
                )}
            </div>

            {error && (
                <p style={{ fontSize: 12, color: '#dc2626', marginTop: 8, fontWeight: 600 }}>
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
