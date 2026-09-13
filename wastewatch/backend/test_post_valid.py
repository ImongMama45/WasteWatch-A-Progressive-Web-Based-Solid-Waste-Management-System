import requests
import io
from PIL import Image

# Create a small valid JPEG
img = Image.new('RGB', (100, 100), color = 'red')
img_byte_arr = io.BytesIO()
img.save(img_byte_arr, format='JPEG')
img_bytes = img_byte_arr.getvalue()

url = "http://127.0.0.1:8000/api/watcher/reports/"

data = {
    "issue_type": "overflow",
    "severity": "medium",
    "description": "",
    "address": "",
}

files = {
    'image': ('test.jpg', img_bytes, 'image/jpeg')
}

response = requests.post(url, data=data, files=files)
print("Status Code:", response.status_code)
print("Response JSON:", response.text)
