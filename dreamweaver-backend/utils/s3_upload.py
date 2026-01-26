"""
S3 Upload Utility for Dreamweaver Backend

Handles uploading images to S3 for use with Modal multi-view endpoint.
"""

import boto3
import os
import uuid
from datetime import datetime
from pathlib import Path
from botocore.config import Config
from typing import Union

# S3 Configuration
S3_BUCKET = os.getenv("S3_BUCKET", "temp-cache-57623")
S3_REGION = os.getenv("S3_REGION", "eu-north-1")
S3_PREFIX = "dreamweaver_images"


def upload_to_s3(
    file_path_or_bytes: Union[str, Path, bytes],
    filename: str,
    content_type: str = "image/jpeg"
) -> str:
    """
    Upload a file or bytes to S3 and return the public URL.
    
    Args:
        file_path_or_bytes: Either a file path or bytes to upload
        filename: Desired filename (will be prefixed with timestamp and UUID)
        content_type: MIME type of the file
        
    Returns:
        Public S3 URL of the uploaded file
    """
    config = Config(
        region_name=S3_REGION,
        retries={'max_attempts': 3, 'mode': 'adaptive'}
    )
    client = boto3.client('s3', config=config)
    
    # Generate unique key
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    unique_id = str(uuid.uuid4())[:8]
    key = f"{S3_PREFIX}/{timestamp}/{unique_id}_{filename}"
    
    # Get file bytes
    if isinstance(file_path_or_bytes, (str, Path)):
        with open(file_path_or_bytes, 'rb') as f:
            body = f.read()
    else:
        body = file_path_or_bytes
    
    # Upload to S3
    client.put_object(
        Bucket=S3_BUCKET,
        Key=key,
        Body=body,
        ContentType=content_type,
        ACL='public-read'
    )
    
    # Return public URL
    url = f"https://{S3_BUCKET}.s3.{S3_REGION}.amazonaws.com/{key}"
    return url


def upload_base64_to_s3(b64_string: str, filename: str = "image.jpg") -> str:
    """
    Upload a base64-encoded image to S3.
    
    Args:
        b64_string: Base64-encoded image data
        filename: Desired filename
        
    Returns:
        Public S3 URL of the uploaded image
    """
    import base64
    
    # Decode base64
    image_bytes = base64.b64decode(b64_string)
    
    # Determine content type from filename
    ext = Path(filename).suffix.lower()
    content_type_map = {
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.webp': 'image/webp',
    }
    content_type = content_type_map.get(ext, 'image/jpeg')
    
    return upload_to_s3(image_bytes, filename, content_type)
