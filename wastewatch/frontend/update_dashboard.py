import os
import re

path = r"D:\Coding\Waste Watch\wastewatch\frontend\src\pages\dashboard\BrgyDashboard.jsx"
with open(path, "r", encoding="utf-8") as f:
    text = f.read()

# 1. API Import
text = text.replace(
    "import { getApiErrorMessage } from '../../utils/notificationHelpers'",
    "import { getApiErrorMessage } from '../../utils/notificationHelpers'\nimport api from '../../api/client'"
)

# 2. State & effects
new_state = """  const [stats, setStats] = useState({ pending: 0, approved: 0, rejected: 0, resolved: 0 })
  const [loading, setLoading] = useState(true)
  const [allReports, setAllReports] = useState([])
  const [trucks, setTrucks] = useState([])
  const [schedules, setSchedules] = useState([])
  const [activeMainTab, setActiveMainTab] = useState('validation')
  const [reportFilter, setReportFilter] = useState('Pending')
  const [expandedReport, setExpandedReport] = useState(null)
  const [expandedTruck, setExpandedTruck] = useState(null)
  const [toast, setToast] = useState(null)

  useEffect(() => {
    fetchStats()
    fetchReports()
    fetchSchedules()
  }, [])

  function formatTime(timeStr) {
    if (!timeStr) return '';
    const [h, m] = timeStr.split(':');
    const hour = parseInt(h, 10);
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const formattedHour = hour % 12 || 12;
    return `${formattedHour}:${m} ${ampm}`;
  }

  async function fetchSchedules() {
    try {
      const res = await api.get('/api/driver/collection-schedules/')
      let brgySchedules = res.data
      if (user?.barangay_name) {
        brgySchedules = brgySchedules.filter(s => 
          s.barangay_names && s.barangay_names.includes(user.barangay_name)
        )
      }
      
      const mappedSchedules = brgySchedules.map(s => ({
        id: s.id,
        day: s.days || 'Daily',
        zone: s.area || 'Unknown',
        time: s.start_time ? `${formatTime(s.start_time)} - ${formatTime(s.end_time)}` : 'No Schedule',
        done: s.completed_stops >= s.total_stops && s.total_stops > 0
      }))
      setSchedules(mappedSchedules)

      const mappedTrucks = brgySchedules.filter(s => s.truck_plate).map(s => ({
        id: s.id,
        label: s.truck_plate || 'Unassigned',
        driver: s.driver_name || 'Unassigned',
        status: s.truck_status === 'on_route' ? 'collecting' : 
                s.truck_status === 'heading_to_start' ? 'en_route' : 
                s.truck_status === 'completed' ? 'done' : 'idle',
        scheduledTime: s.start_time ? formatTime(s.start_time) : 'N/A',
        actualTime: '—',
        stopsCompleted: s.completed_stops,
        totalStops: s.total_stops,
        missedYesterday: s.truck_status === 'returning_unfinished',
        capacity: 0,
        flagged: false,
      }))
      setTrucks(mappedTrucks)

    } catch (err) {
      console.error('Failed to fetch schedules', err)
    }
  }"""

text = re.sub(
    r"  const \[stats, setStats\].*?fetchReports\(\)\s*\}, \[\]\)",
    new_state.replace('\\', '\\\\'), # escape backslashes if any, not needed here but safe
    text,
    flags=re.DOTALL
)

# Template literal fixes just in case re.sub eats the backticks
new_state = new_state.replace("`${formattedHour}:${m} ${ampm}`", "`${formattedHour}:${m} ${ampm}`")

# apply manually again if regex failed
if "fetchSchedules" not in text:
    print("Regex failed to find state block")

text = text.replace("MOCK_SCHEDULE.map", "schedules.map")
text = text.replace("MOCK_SCHEDULE.length", "schedules.length")
text = text.replace("const MOCK_TRUCKS", "// const MOCK_TRUCKS")
text = text.replace("const MOCK_SCHEDULE", "// const MOCK_SCHEDULE")

with open(path, "w", encoding="utf-8") as f:
    f.write(text)

print("Updated BrgyDashboard.jsx!")
