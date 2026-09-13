import re
import os

file_path = r"d:\Coding\Waste Watch\wastewatch\frontend\src\pages\driver\components\EndShiftModule.jsx"
with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

content = re.sub(r'function RouteCompletionMiniMap.*?return\s+\(\s+<div.*?</div>\s+\)\s+}', '', content, flags=re.DOTALL)

import_str = "import RouteCompletionMiniMap from './RouteCompletionMiniMap'\n"
content = content.replace("import CalibrationCelebrationModule from './CalibrationCelebrationModule'\n", "import CalibrationCelebrationModule from './CalibrationCelebrationModule'\n" + import_str)

with open(file_path, 'w', encoding='utf-8') as f:
    f.write(content)

print("EndShiftModule.jsx cleaned.")
