import boto3
import os
from botocore.exceptions import ClientError

# Configuration from product_ad_pipeline.py
S3_BUCKET = os.getenv("S3_BUCKET", "temp-cache-57623")
S3_REGION = os.getenv("S3_REGION", "eu-north-1")

def test_boto3():
    print(f"Testing direct boto3 upload to bucket: {S3_BUCKET}")
    
    try:
        s3 = boto3.client('s3', region_name=S3_REGION)
        
        filename = "boto3_test.txt"
        key = f"backend_test/{filename}"
        content = b"Direct upload test content"
        
        print("Uploading...")
        s3.put_object(
            Bucket=S3_BUCKET,
            Key=key,
            Body=content,
            ContentType="text/plain",
            ACL="public-read"
        )
        
        url = f"https://{S3_BUCKET}.s3.{S3_REGION}.amazonaws.com/{key}"
        print(f"✅ Upload successful!")
        print(f"URL: {url}")
        
        # Verify access
        import requests
        resp = requests.get(url)
        print(f"Access Status: {resp.status_code}")
        
        if resp.status_code == 200:
            print("✅ Public access confirmed!")
        else:
            print("❌ File is not public.")
            
    except Exception as e:
        print(f"❌ Boto3 Error: {e}")
        # Check for credentials
        sts = boto3.client('sts')
        try:
            id = sts.get_caller_identity()
            print(f"Authenticated as: {id['Arn']}")
        except:
            print("❌ No valid AWS credentials found.")

if __name__ == "__main__":
    test_boto3()
