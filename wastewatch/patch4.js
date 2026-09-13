const fs = require('fs');
const path = 'd:/Coding/Waste Watch/wastewatch/frontend/src/pages/driver/DriverAnalytics.jsx';
let lines = fs.readFileSync(path, 'utf8').split(/\r?\n/);

// Find the start of the return in LineChart
const startIndex = lines.findIndex((line, i) => i > 140 && i < 160 && line.includes('return (') && lines[i+1].includes('<svg viewBox='));

if (startIndex > -1) {
    lines[startIndex + 1] = "        <div style={{ position: 'relative', width: '100%' }}>\\n            <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', overflow: 'visible', display: 'block' }}>";
}

const ptsMapIndex = lines.findIndex((line, i) => i > 165 && line.includes('{pts.map(([x, y], i) => ('));

if (ptsMapIndex > -1) {
    // Replace the circle line and following lines
    lines.splice(ptsMapIndex + 1, 4,
`                <g key={i} 
                   onMouseEnter={() => setHoverNode({ i, x, y, val: data[i] })}
                   onMouseLeave={() => setHoverNode(null)}
                   style={{ cursor: 'pointer' }}>
                    <circle cx={x} cy={y} r={hoverNode?.i === i ? "5" : "3.5"} fill={color} stroke="var(--surface)" strokeWidth="2" style={{ transition: 'r .2s ease' }} />
                    <circle cx={x} cy={y} r="16" fill="transparent" />
                </g>
            ))}
        </svg>

            {/* CUSTOM HTML TOOLTIP */}
            {hoverNode && (
                <div style={{
                    position: 'absolute',
                    left: \`calc(\${(hoverNode.x / W) * 100}%)\`,
                    top: \`calc(\${(hoverNode.y / H) * 100}%)\`,
                    transform: 'translate(-50%, -100%)',
                    marginTop: -10,
                    background: 'var(--surface)',
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                    padding: '8px 12px',
                    boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
                    pointerEvents: 'none',
                    textAlign: 'center',
                    minWidth: 80,
                    zIndex: 10,
                    animation: 'fadeUp 0.15s ease-out'
                }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 2 }}>
                        Route {hoverNode.i + 1}
                    </div>
                    <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text)' }}>
                        {hoverNode.val} <span style={{ fontSize: 11, fontWeight: 600 }}>{label === 'm' ? 'mins' : label}</span>
                    </div>
                    {/* Tooltip Tail */}
                    <div style={{
                        position: 'absolute',
                        bottom: -5,
                        left: '50%',
                        transform: 'translateX(-50%) rotate(45deg)',
                        width: 10,
                        height: 10,
                        background: 'var(--surface)',
                        borderRight: '1px solid var(--border)',
                        borderBottom: '1px solid var(--border)',
                    }} />
                </div>
            )}
        </div>
    )`);
}

fs.writeFileSync(path, lines.join('\\n'), 'utf8');
console.log('File successfully updated via Node.js script line splicing.');
