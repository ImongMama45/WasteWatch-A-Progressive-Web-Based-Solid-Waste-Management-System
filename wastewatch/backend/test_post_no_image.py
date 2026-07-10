import requests

url = "http://127.0.0.1:8000/api/watcher/reports/"

data = {
    "issue_type": "overflow",
    "severity": "medium",
    "description": "",
    "address": "",
}

response = requests.post(url, data=data)
print("Status Code:", response.status_code)
print("Response JSON:", response.text)
