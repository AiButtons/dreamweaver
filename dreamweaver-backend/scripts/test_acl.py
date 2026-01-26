import requests
import os
import io

UPLOAD_API_ENDPOINT = os.getenv("UPLOAD_API_ENDPOINT", "https://wzcz9axnlj.execute-api.eu-north-1.amazonaws.com/prod/upload")
UPLOAD_API_KEY = os.getenv("UPLOAD_API_KEY", "G8sCSLZumv4sUHc6NqqWC18MwHEdlB1D4GhGavM5")

def test_acl_upload():
    print("Requesting presigned URL...")
    payload = {"fileName": "acl_test.txt", "contentType": "text/plain"}
    headers = {"x-api-key": UPLOAD_API_KEY}
    
    resp = requests.post(UPLOAD_API_ENDPOINT, json=payload, headers=headers)
    resp.raise_for_status()
    data = resp.json()
    upload_url = data['uploadUrl']
    public_url = f"https://{data['bucket']}.s3.eu-north-1.amazonaws.com/{data['key']}"
    
    print(f"Uploading to: {upload_url[:50]}...")
    
    # Try with ACL header
    put_headers = {
        "Content-Type": "text/plain",
        # "x-amz-acl": "public-read"  <-- Uncomment to test
    }
    
    # First try without header to confirm failure
    print("1. Uploading WITHOUT ACL header...")
    requests.put(upload_url, data=b"private content", headers=put_headers)
    
    print("Checking access...")
    r = requests.get(public_url)
    print(f"Status without ACL: {r.status_code}")
    
    # Now get new URL and try WITH header
    resp = requests.post(UPLOAD_API_ENDPOINT, json=payload, headers=headers)
    data = resp.json()
    upload_url = data['uploadUrl']
    public_url = f"https://{data['bucket']}.s3.eu-north-1.amazonaws.com/{data['key']}"
    
    print("\n2. Uploading WITH 'public-read' ACL header...")
    put_headers["x-amz-acl"] = "public-read"
    try:
        r_put = requests.put(upload_url, data=b"public content", headers=put_headers)
        print(f"PUT Status: {r_put.status_code}")
        
        print("Checking access...")
        r = requests.get(public_url)
        print(f"Status WITH ACL: {r.status_code}")
        if r.status_code == 200:
            print("✅ SUCCEEDED! ACL header works.")
        else:
            print("❌ File is still not public.")
            
    except Exception as e:
        print(f"❌ PUT failed (likely signature mismatch): {e}")

if __name__ == "__main__":
    test_acl_upload()
