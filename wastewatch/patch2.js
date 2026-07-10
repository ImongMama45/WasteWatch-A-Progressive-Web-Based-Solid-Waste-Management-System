const fs = require('fs');
const path = 'd:/Coding/Waste Watch/wastewatch/frontend/src/pages/driver/DriverAnalytics.jsx';
let content = fs.readFileSync(path, 'utf8');

// 1. Add state to LineChart
content = content.replace(/function LineChart\(\{ data, color = '#3b82f6', label = 'm' \}\) \{/, 
`function LineChart({ data, color = '#3b82f6', label = 'm' }) {
    const [hoverNode, setHoverNode] = useState(null)`);

// 2. Wrap SVG in relative div
content = content.replace(/    return \(\r?\n        <svg viewBox=\{\`0 0 \$\{W\} \$\{H\}\`\} style=\{\{ width: '100%', height: 'auto', overflow: 'visible' \}\}>/, 
`    return (
        <div style={{ position: 'relative', width: '100%' }}>
            <svg viewBox={\`0 0 \${W} \${H}\`} style={{ width: '100%', height: 'auto', overflow: 'visible', display: 'block' }}>`);

// 3. Replace circles and add tooltip div
content = content.replace(/            \{pts\.map\(\(\[x, y\], i\) => \([\s\S]*?            \}\)\)\r?\n        <\/svg>\r?\n    \)/,
`            {pts.map(([x, y], i) => (
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
                    left: \`\${(hoverNode.x / W) * 100}%\`,
                    top: \`\${(hoverNode.y / H) * 100}%\`,
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

fs.writeFileSync(path, content, 'utf8');
console.log('File successfully updated via Node.js regex replacement.');
