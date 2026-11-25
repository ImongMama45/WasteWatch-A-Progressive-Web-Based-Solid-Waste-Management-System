import requests

url = "http://127.0.0.1:8000/api/watcher/reports/"

data = {
    "issue_type": "overflow",
    "severity": "medium",
    "description": "",
    "address": "",
    "created_at": "2024-01-01T00:00:00Z"
}

files = {
    'image': ('test.jpg', b'fake image data', 'image/jpeg')
}

response = requests.post(url, data=data, files=files)
print("Status Code:", response.status_code)
print("Response JSON:", response.text)
