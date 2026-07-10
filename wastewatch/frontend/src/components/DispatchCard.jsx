import React, { useState, useEffect } from 'react';
import { X } from 'lucide-react';

export default function DispatchCard({ dispatchData, userBarangay }) {
    const [visible, setVisible] = useState(true);

    // Reset visibility if a new dispatch happens
    useEffect(() => {
        if (dispatchData) {
            setVisible(true);
        }
    }, [dispatchData?.id]);

    if (!dispatchData || !visible) return null;

    // Calculate naively
    const started = new Date(dispatchData.started_at);
    const now = new Date();
    const diffMins = Math.floor((now - started) / 60000);
    
    // Create a mock distance based on time (just for the "Approx" feel)
    // Decreases as time goes on, bottoms out at 50m
    const mockDistance = Math.max(50, 2000 - (diffMins * 50)); 
    const distanceStr = mockDistance >= 1000 ? `${(mockDistance/1000).toFixed(1)}km` : `${mockDistance}m`;

    return (
        <div style={{
            position: 'fixed',
            top: 70, // Below header
            right: 20,
            zIndex: 9999,
            background: 'var(--accent, #2ecc71)',
            color: '#fff',
            padding: '12px 16px',
            borderRadius: 16,
            display: 'flex',
            alignItems: 'center',
            gap: 16,
            boxShadow: '0 8px 24px rgba(46, 204, 113, 0.4)',
            animation: 'slideIn 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275)'
        }}>
            <div>
                <div style={{ fontSize: 16, fontWeight: 700, margin: 0, lineHeight: 1.2 }}>Truck Nearby</div>
                <div style={{ fontSize: 11, fontWeight: 500, opacity: 0.9 }}>Approximately {distanceStr}</div>
            </div>
            
            <button 
                onClick={() => setVisible(false)}
                style={{ 
                    background: 'none', border: 'none', color: '#fff', 
                    cursor: 'pointer', padding: 4, display: 'flex', alignItems: 'center', 
                    opacity: 0.8, transition: 'opacity 0.2s' 
                }}
                onMouseOver={e => e.currentTarget.style.opacity = '1'}
                onMouseOut={e => e.currentTarget.style.opacity = '0.8'}
            >
                <X size={24} strokeWidth={2.5} />
            </button>

            <style>{`
                @keyframes slideIn {
                    from { transform: translateX(120%); opacity: 0; }
                    to { transform: translateX(0); opacity: 1; }
                }
            `}</style>
        </div>
    );
}
