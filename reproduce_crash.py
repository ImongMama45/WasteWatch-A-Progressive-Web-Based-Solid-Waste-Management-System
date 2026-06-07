
import requests
import io

BASE_URL = 'http://localhost:8000'

def reproduce_crash():
    # Use a real file-like object for the image
    image_data = b'fake-image-content'
    image_file = io.BytesIO(image_data)
    image_file.name = 'download.jpg'

    data = {
        'latitude': '13.932954',
        'longitude': '121.634816',
        'address': 'John 15 Street, Mayao Crossing, Lucena, 2nd District, Calabarzon, 4301, Philippines',
        'issue_type': 'overflow',
        'severity': 'medium',
        'description': 'dsadsad',
        'tags': 'Near market',
    }
    
    files = {
        'image': ('download.jpg', image_file, 'image/jpeg')
    }
    
    print(f"Submitting to {BASE_URL}/api/watcher/reports/...")
    response = requests.post(f'{BASE_URL}/api/watcher/reports/', data=data, files=files)
    
    print(f'Status Code: {response.status_code}')
    try:
        json_res = response.json()
        if 'detail' in json_res:
            print("\n--- STACK TRACE FROM BACKEND ---")
            print(json_res['detail'])
            print("--------------------------------\n")
        else:
            print(f'Response: {json_res}')
    except:
        print(f'Raw Response: {response.text}')

if __name__ == '__main__':
    reproduce_crash()
