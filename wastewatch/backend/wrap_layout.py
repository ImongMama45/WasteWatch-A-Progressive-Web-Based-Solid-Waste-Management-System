import os

def wrap_file(path):
    with open(path, 'r', encoding='utf-8') as f:
        content = f.read()

    if "<DashboardLayout>" not in content:
        # Add import if missing
        if "DashboardLayout" not in content:
            content = content.replace("import api from '../../api/client'", "import api from '../../api/client'\nimport DashboardLayout from '../../components/DashboardLayout'")
        
        # Replace the first return (
        content = content.replace("  return (\n    <div", "  return (\n    <DashboardLayout>\n      <div")
        
        # Replace the last </div>\n  )
        content = content.replace("    </div>\n  )\n}", "    </div>\n    </DashboardLayout>\n  )\n}")
        
        # Replace the last </div>\n  )\n\n// UI Components (in Management)
        content = content.replace("    </div>\n  )\n}\n\n// UI Components", "    </div>\n    </DashboardLayout>\n  )\n}\n\n// UI Components")
        
        with open(path, 'w', encoding='utf-8') as f:
            f.write(content)

wrap_file(r"d:\Coding\Waste Watch\wastewatch\frontend\src\pages\admin\BarangayManagement.jsx")
wrap_file(r"d:\Coding\Waste Watch\wastewatch\frontend\src\pages\admin\BarangayDetail.jsx")
print("Wrapped in DashboardLayout.")
