"""
File Upload Utility for Dreamweaver Backend

Handles file uploads via API Gateway presigned URLs for use in:
- Video generation workflows
- Image-to-image generation
- Image editing workflows
"""

import os
import requests
import base64
import tempfile
from typing import Union, Optional
from pathlib import Path


class FileUploadError(Exception):
    """Custom exception for file upload errors."""
    pass


class FileUploader:
    """Handles file uploads to S3 via API Gateway presigned URLs."""
    
    def __init__(self):
        self.api_endpoint = os.getenv(
            "UPLOAD_API_ENDPOINT",
            "https://wzcz9axnlj.execute-api.eu-north-1.amazonaws.com/prod/upload"
        )
        self.api_key = os.getenv(
            "UPLOAD_API_KEY",
            "G8sCSLZumv4sUHc6NqqWC18MwHEdlB1D4GhGavM5"
        )
    
    def upload_file(
        self,
        file_path: Union[str, Path],
        filename: Optional[str] = None,
        content_type: Optional[str] = None
    ) -> str:
        """
        Upload a file and return its public S3 URL.
        
        Args:
            file_path: Path to the file to upload
            filename: Custom filename (defaults to original filename)
            content_type: MIME type (auto-detected if not provided)
            
        Returns:
            Public S3 URL of the uploaded file
            
        Raises:
            FileUploadError: If upload fails
        """
        file_path = Path(file_path)
        
        if not file_path.exists():
            raise FileUploadError(f"File not found: {file_path}")
        
        # Determine filename and content type
        if filename is None:
            filename = file_path.name
        
        if content_type is None:
            content_type = self._detect_content_type(filename)
        
        # Get presigned URL from API
        upload_url, download_url = self._get_presigned_url(filename, content_type)
        
        # Upload file to S3
        self._upload_to_s3(file_path, upload_url, content_type)
        
        # Return public/presigned URL
        return download_url
    
    def upload_base64(
        self,
        b64_data: str,
        filename: str = "image.jpg",
        content_type: Optional[str] = None
    ) -> str:
        """
        Upload base64-encoded data.
        
        Args:
            b64_data: Base64-encoded file data (with or without data URI prefix)
            filename: Filename for the upload
            content_type: MIME type (auto-detected if not provided)
            
        Returns:
            Public S3 URL of the uploaded file
            
        Raises:
            FileUploadError: If upload fails
        """
        # Remove data URI prefix if present
        if b64_data.startswith('data:'):
            # Extract actual base64 data
            import re
            match = re.search(r'base64,(.+)', b64_data)
            if match:
                b64_data = match.group(1)
            else:
                raise FileUploadError("Invalid data URI format")
        
        # Decode base64 to bytes
        try:
            file_bytes = base64.b64decode(b64_data)
        except Exception as e:
            raise FileUploadError(f"Failed to decode base64: {e}")
        
        # Write to temp file and upload
        with tempfile.NamedTemporaryFile(delete=False, suffix=Path(filename).suffix) as tmp:
            tmp.write(file_bytes)
            tmp_path = tmp.name
        
        try:
            url = self.upload_file(tmp_path, filename, content_type)
            return url
        finally:
            # Clean up temp file
            try:
                os.unlink(tmp_path)
            except:
                pass
    
    def upload_bytes(
        self,
        file_bytes: bytes,
        filename: str,
        content_type: Optional[str] = None
    ) -> str:
        """
        Upload raw bytes.
        
        Args:
            file_bytes: File content as bytes
            filename: Filename for the upload
            content_type: MIME type (auto-detected if not provided)
            
        Returns:
            Public S3 URL of the uploaded file
            
        Raises:
            FileUploadError: If upload fails
        """
        # Write to temp file and upload
        with tempfile.NamedTemporaryFile(delete=False, suffix=Path(filename).suffix) as tmp:
            tmp.write(file_bytes)
            tmp_path = tmp.name
        
        try:
            url = self.upload_file(tmp_path, filename, content_type)
            return url
        finally:
            # Clean up temp file
            try:
                os.unlink(tmp_path)
            except:
                pass
    
    def _get_presigned_url(self, filename: str, content_type: str) -> tuple[str, str, str]:
        """
        Get presigned URL from API Gateway.
        
        Returns:
            Tuple of (upload_url, bucket, key)
        """
        payload = {
            "fileName": filename,
            "contentType": content_type
        }
        headers = {
            "x-api-key": self.api_key,
            "Content-Type": "application/json"
        }
        
        try:
            response = requests.post(
                self.api_endpoint,
                json=payload,
                headers=headers,
                timeout=30
            )
            response.raise_for_status()
            data = response.json()
            
            upload_url = data.get("uploadUrl")
            download_url = data.get("downloadUrl")
            bucket = data.get("bucket")
            key = data.get("key")
            
            # If downloadUrl is present, prefer it. Otherwise construct S3 URL if bucket/key exist.
            # But the API seems to return all.
            
            if not upload_url:
                 raise FileUploadError("Invalid API response: missing uploadUrl")

            # Fallback for download_url if missing (though we expect it now)
            if not download_url and bucket and key:
                 download_url = f"https://{bucket}.s3.eu-north-1.amazonaws.com/{key}"
            
            if not download_url:
                 raise FileUploadError("Invalid API response: could not determine download URL")
            
            return upload_url, download_url
            
        except requests.RequestException as e:
            raise FileUploadError(f"Failed to get presigned URL: {e}")
    
    def _upload_to_s3(self, file_path: Path, upload_url: str, content_type: str):
        """Upload file to S3 using presigned URL."""
        try:
            with open(file_path, 'rb') as f:
                response = requests.put(
                    upload_url,
                    data=f,
                    headers={"Content-Type": content_type},
                    timeout=300  # 5 minutes for large files
                )
                response.raise_for_status()
        except requests.RequestException as e:
            raise FileUploadError(f"Failed to upload to S3: {e}")
    
    def _detect_content_type(self, filename: str) -> str:
        """Detect content type from filename extension."""
        ext = Path(filename).suffix.lower()
        content_types = {
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.png': 'image/png',
            '.webp': 'image/webp',
            '.gif': 'image/gif',
            '.mp4': 'video/mp4',
            '.webm': 'video/webm',
            '.mov': 'video/quicktime',
            '.avi': 'video/x-msvideo',
        }
        return content_types.get(ext, 'application/octet-stream')


# Global instance
_uploader = None


def get_uploader() -> FileUploader:
    """Get or create global FileUploader instance."""
    global _uploader
    if _uploader is None:
        _uploader = FileUploader()
    return _uploader


# Convenience functions
def upload_file(file_path: Union[str, Path], filename: Optional[str] = None) -> str:
    """Upload a file and return its public URL."""
    return get_uploader().upload_file(file_path, filename)


def upload_base64(b64_data: str, filename: str = "image.jpg") -> str:
    """Upload base64-encoded data and return its public URL."""
    return get_uploader().upload_base64(b64_data, filename)


def upload_bytes(file_bytes: bytes, filename: str) -> str:
    """Upload raw bytes and return its public URL."""
    return get_uploader().upload_bytes(file_bytes, filename)
