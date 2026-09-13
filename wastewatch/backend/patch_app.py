import os

file_path = r"d:\Coding\Waste Watch\wastewatch\frontend\src\App.jsx"

with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

imports = """
import BarangayManagement from './pages/admin/BarangayManagement'
import BarangayDetail from './pages/admin/BarangayDetail'
"""

route1 = """
          <Route path="/admin/barangays" element={
            <PrivateRoute><BarangayManagement /></PrivateRoute>
          } />

          <Route path="/admin/barangays/:barangayId" element={
            <PrivateRoute><BarangayDetail /></PrivateRoute>
          } />
"""

if "import BarangayManagement" not in content:
    content = content.replace("import AdminReports from './pages/admin/AdminReports'", "import AdminReports from './pages/admin/AdminReports'" + imports)
    content = content.replace("{/* ADMIN PAGE */}", "{/* ADMIN PAGE */}" + route1)

    with open(file_path, 'w', encoding='utf-8') as f:
        f.write(content)
    print("App.jsx updated.")
else:
    print("App.jsx already updated.")
