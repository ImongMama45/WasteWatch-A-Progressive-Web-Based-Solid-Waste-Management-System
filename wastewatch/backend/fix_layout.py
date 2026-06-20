import os
import re

def fix_file(filepath):
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()

    # Clean up duplicate imports
    content = content.replace("import DashboardLayout from '../../components/DashboardLayout'\nimport DashboardLayout from '../../components/DashboardLayout'", "import DashboardLayout from '../../components/DashboardLayout'")
    
    if "import DashboardLayout" not in content:
        content = content.replace("import api from '../../api/client'", "import api from '../../api/client'\nimport DashboardLayout from '../../components/DashboardLayout'")

    # Ensure DashboardLayout is wrapping the return
    if "<DashboardLayout>" not in content:
        # For BarangayManagement
        if "export default function BarangayManagement() {" in content:
            content = content.replace("  return (\n    <div style={{ padding: '32px 40px', maxWidth: 1400, margin: '0 auto', fontFamily: 'var(--font-sans, system-ui)' }}>", "  return (\n    <DashboardLayout>\n    <div style={{ padding: '32px 40px', maxWidth: 1400, margin: '0 auto', fontFamily: 'var(--font-sans, system-ui)' }}>")
            content = content.replace("    </div>\n  )\n}\n\n// UI Components", "    </div>\n    </DashboardLayout>\n  )\n}\n\n// UI Components")
        
        # For BarangayDetail
        if "export default function BarangayDetail() {" in content:
            content = content.replace("  return (\n    <div style={{ padding: 24, maxWidth: 1200, margin: '0 auto' }}>", "  return (\n    <DashboardLayout>\n    <div style={{ padding: 24, maxWidth: 1200, margin: '0 auto' }}>")
            content = content.replace("    </div>\n  )\n}", "    </div>\n    </DashboardLayout>\n  )\n}")

    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(content)

fix_file(r"d:\Coding\Waste Watch\wastewatch\frontend\src\pages\admin\BarangayManagement.jsx")
fix_file(r"d:\Coding\Waste Watch\wastewatch\frontend\src\pages\admin\BarangayDetail.jsx")
print("Files fixed.")
