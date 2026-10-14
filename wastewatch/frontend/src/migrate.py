import os
import shutil

base = r"d:\Coding\Waste Watch\wastewatch\frontend\src\pages"
dest = os.path.join(base, "brgy_official")

os.makedirs(dest, exist_ok=True)

# 1. ValidateReports.jsx
vr_src = os.path.join(base, "ValidateReports.jsx")
vr_dst = os.path.join(dest, "ValidateReports.jsx")
if os.path.exists(vr_src):
    with open(vr_src, 'r', encoding='utf-8') as f:
        content = f.read()
    content = content.replace("from '../components/DashboardLayout'", "from '../../components/DashboardLayout'")
    content = content.replace("from '../context/AuthContext'", "from '../../context/AuthContext'")
    content = content.replace("from '../api/client'", "from '../../api/client'")
    content = content.replace("from '../api/navConfig'", "from '../../api/navConfig'")
    with open(vr_dst, 'w', encoding='utf-8') as f:
        f.write(content)
    os.remove(vr_src)

# 2. EscalateToAdmin.jsx
ea_src = os.path.join(base, "EscalateToAdmin.jsx")
ea_dst = os.path.join(dest, "EscalateToAdmin.jsx")
if os.path.exists(ea_src):
    with open(ea_src, 'r', encoding='utf-8') as f:
        content = f.read()
    content = content.replace("from '../context/AuthContext'", "from '../../context/AuthContext'")
    content = content.replace("from '../api/client'", "from '../../api/client'")
    content = content.replace("from '../components/DashboardLayout'", "from '../../components/DashboardLayout'")
    with open(ea_dst, 'w', encoding='utf-8') as f:
        f.write(content)
    os.remove(ea_src)

# 3. BrgyDashboard.jsx
bd_src = os.path.join(base, "dashboard", "BrgyDashboard.jsx")
bd_dst = os.path.join(dest, "BrgyDashboard.jsx")
if os.path.exists(bd_src):
    shutil.move(bd_src, bd_dst)

# 4. App.jsx
app_src = r"d:\Coding\Waste Watch\wastewatch\frontend\src\App.jsx"
if os.path.exists(app_src):
    with open(app_src, 'r', encoding='utf-8') as f:
        content = f.read()
    content = content.replace("import EscalateToAdmin from './pages/EscalateToAdmin'", "import EscalateToAdmin from './pages/brgy_official/EscalateToAdmin'")
    content = content.replace("import ValidateReports from './pages/ValidateReports'", "import ValidateReports from './pages/brgy_official/ValidateReports'")
    with open(app_src, 'w', encoding='utf-8') as f:
        f.write(content)

# 5. DashboardRouter.jsx
dr_src = os.path.join(base, "dashboard", "DashboardRouter.jsx")
if os.path.exists(dr_src):
    with open(dr_src, 'r', encoding='utf-8') as f:
        content = f.read()
    content = content.replace("import BrgyDashboard from \"./BrgyDashboard\";", "import BrgyDashboard from \"../brgy_official/BrgyDashboard\";")
    with open(dr_src, 'w', encoding='utf-8') as f:
        f.write(content)

print("Migration completed.")
