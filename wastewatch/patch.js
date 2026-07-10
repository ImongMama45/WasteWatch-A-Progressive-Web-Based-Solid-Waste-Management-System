const fs = require('fs');
const path = 'd:/Coding/Waste Watch/wastewatch/frontend/src/pages/driver/DriverAnalytics.jsx';
let content = fs.readFileSync(path, 'utf8');

// 1. Remove mock data
content = content.replace(/\/\/ ─── MOCK DATA ──[\s\S]*?\/\/ ─── HELPERS ──/, '// ─── MOCK DATA REMOVED ────────────────────────────────────────────────────────\n\n// ─── HELPERS ──');

// 2. Add loading and error states
content = content.replace(/const \[period, setPeriod\] = useState\('week'\)[\s\S]*?const \[trend, setTrend\] = useState\(\[MOCK_TREND\]\)/, 
`    const [period, setPeriod] = useState('week')
    const [summary, setSummary] = useState({ routesCompleted: 0, stopsCompleted: 0, totalWorkingHours: 0, avgCompletionMins: 0 })
    const [weekly, setWeekly] = useState([])
    const [trend, setTrend] = useState([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState(null)`);

// wait, the original state was:
content = content.replace(/const \[period, setPeriod\] = useState\('week'\)[\s\S]*?const \[trend, setTrend\] = useState\(MOCK_TREND\)/, 
`    const [period, setPeriod] = useState('week')
    const [summary, setSummary] = useState({ routesCompleted: 0, stopsCompleted: 0, totalWorkingHours: 0, avgCompletionMins: 0 })
    const [weekly, setWeekly] = useState([])
    const [trend, setTrend] = useState([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState(null)`);

// 3. Update useEffect
content = content.replace(/useEffect\(\(\) => \{[\s\S]*?\}, \[\]\)/,
`    const fetchAnalytics = () => {
        setLoading(true)
        setError(null)
        api.get(\`/api/driver/shift/analytics/?period=\${period}\`)
            .then(res => {
                if (!res.data) throw new Error('No data returned')
                if (res.data.summary) setSummary(res.data.summary)
                if (res.data.weekly)  setWeekly(res.data.weekly)
                if (res.data.trend)   setTrend(res.data.trend)
            })
            .catch(err => {
                console.error('Failed to load analytics:', err)
                setError('Failed to load performance data. Please check your connection.')
            })
            .finally(() => setLoading(false))
    }

    useEffect(() => {
        fetchAnalytics()
    }, [period])`);

// 4. Inject Loading/Error UI and wrap stats
content = content.replace(/\{\/\* ── STAT CARDS 2×2 ── \*\/\}/,
`{/* ── ERROR & LOADING STATES ── */}
                {loading && (
                    <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--text-muted)' }}>
                        <div className="spinner" style={{ margin: '0 auto 12px', width: 24, height: 24, border: '3px solid var(--border)', borderTopColor: 'var(--accent)', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
                        <div style={{ fontSize: 13, fontWeight: 600 }}>Loading analytics...</div>
                        <style>{\`@keyframes spin { to { transform: rotate(360deg); } }\`}</style>
                    </div>
                )}

                {error && !loading && (
                    <div style={{ padding: '24px 16px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 12, marginBottom: 24, textAlign: 'center' }}>
                        <span className="material-symbols-rounded" style={{ color: '#ef4444', fontSize: 28, marginBottom: 8 }}>wifi_off</span>
                        <div style={{ color: '#ef4444', fontSize: 14, fontWeight: 600, marginBottom: 12 }}>{error}</div>
                        <button onClick={fetchAnalytics} className="btn" style={{ padding: '6px 16px', fontSize: 13 }}>Try Again</button>
                    </div>
                )}

                {/* ── STAT CARDS 2×2 ── */}
                {!loading && !error && (
                    <>`);

// 5. Change "this month" to "this period"
content = content.replace(/sub="this month"/g, 'sub={`this ${period}`}');

// 6. Close the fragment at the end
// Let's replace the last 3 closing divs
content = content.replace(/                    <\/div>\r?\n                <\/div>\r?\n\r?\n            <\/div>\r?\n        <\/>/,
`                    </div>
                </div>
                </>
                )}

            </div>
        </>`);

fs.writeFileSync(path, content, 'utf8');
console.log('File successfully updated via Node.js regex replacement.');
