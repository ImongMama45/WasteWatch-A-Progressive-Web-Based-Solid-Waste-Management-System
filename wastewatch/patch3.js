const fs = require('fs');
const path = 'd:/Coding/Waste Watch/wastewatch/frontend/src/pages/driver/DriverAnalytics.jsx';
let content = fs.readFileSync(path, 'utf8');

// Step 1: Add hoverNode state
if (!content.includes('const [hoverNode, setHoverNode]')) {
    content = content.replace(
        "function LineChart({ data, color = '#3b82f6', label = 'm' }) {",
        "function LineChart({ data, color = '#3b82f6', label = 'm' }) {\\n    const [hoverNode, setHoverNode] = useState(null)"
    );
}

// Step 2: Extract everything before SVG, and everything after SVG
const svgStartMarker = "        <svg viewBox={`0 0 ${W} ${H}`}";
const svgEndMarker = "        </svg>\\n    )";

const beforeSvgIndex = content.indexOf(svgStartMarker);
const afterSvgIndex = content.indexOf(svgEndMarker) + svgEndMarker.length;

if (beforeSvgIndex > -1 && afterSvgIndex > -1) {
    const beforeStr = content.substring(0, beforeSvgIndex);
    const afterStr = content.substring(afterSvgIndex);

    // Build the new HTML Tooltip SVG container
    const newSvgContent = 
`        <div style={{ position: 'relative', width: '100%' }}>
            <svg viewBox={\`0 0 \${W} \${H}\`} style={{ width: '100%', height: 'auto', overflow: 'visible', display: 'block' }}>
                <defs>
                    <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={color} stopOpacity="0.25" />
                        <stop offset="100%" stopColor={color} stopOpacity="0.02" />
                    </linearGradient>
                </defs>
                {[0, 0.5, 1].map((t, i) => {
                    const y = PAD + t * (H - PAD * 2)
                    const v = Math.round(max - t * range)
                    return (
                        <g key={i}>
                            <line x1={PAD} y1={y} x2={W - PAD} y2={y}
                                stroke="var(--border)" strokeWidth="1" strokeDasharray="4,4" />
                            <text x={PAD - 3} y={y + 3} fontSize="8" fill="var(--text-muted)" textAnchor="end">
                                {v}{label}
                            </text>
                        </g>
                    )
                })}
                <path d={areaD} fill="url(#areaGrad)" />
                <polyline points={polyline} fill="none" stroke={color}
                    strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                {pts.map(([x, y], i) => (
                    <g key={i} 
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
    )`;

    content = beforeStr + newSvgContent + afterStr;
}

fs.writeFileSync(path, content, 'utf8');
console.log('File successfully updated via Node.js script.');
