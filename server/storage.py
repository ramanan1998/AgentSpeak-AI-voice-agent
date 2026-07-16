"""
storage.py — MinIO bucket bootstrap + Vobiz recording ingestion.

Two responsibilities:
  1. ensure_recordings_bucket() — startup: create the public-read recordings bucket.
  2. ingest_vobiz_recording()   — pull a finished call's WAV from Vobiz (whose media host
     is auth-walled behind X-Auth-ID / X-Auth-Token) and re-host it in MinIO, so the
     browser <audio> tag can fetch it through our own app with no Vobiz auth.
"""

import asyncio
import io
import json
import logging
import os

import httpx
from minio import Minio
from minio.error import S3Error

logger = logging.getLogger(__name__)

MINIO_INTERNAL_ENDPOINT = os.getenv("MINIO_INTERNAL_ENDPOINT", "minio:9000")
MINIO_ACCESS_KEY = os.getenv("MINIO_ACCESS_KEY", "")
MINIO_SECRET_KEY = os.getenv("MINIO_SECRET_KEY", "")
MINIO_BUCKET = os.getenv("MINIO_BUCKET", "recordings")
MINIO_INTERNAL_SECURE = os.getenv("MINIO_INTERNAL_SECURE", "false").lower() == "true"

# Same account creds used to dial — Vobiz gates media.vobiz.ai behind them too.
VOBIZ_AUTH_ID = os.getenv("VOBIZ_AUTH_ID", "")
VOBIZ_AUTH_TOKEN = os.getenv("VOBIZ_AUTH_TOKEN", "")


def _client() -> Minio:
    return Minio(
        MINIO_INTERNAL_ENDPOINT,
        access_key=MINIO_ACCESS_KEY,
        secret_key=MINIO_SECRET_KEY,
        secure=MINIO_INTERNAL_SECURE,
    )


def _public_read_policy(bucket: str) -> str:
    """Anonymous read-only access to all objects in the bucket."""
    return json.dumps({
        "Version": "2012-10-17",
        "Statement": [{
            "Effect": "Allow",
            "Principal": {"AWS": ["*"]},
            "Action": ["s3:GetObject"],
            "Resource": [f"arn:aws:s3:::{bucket}/*"],
        }],
    })


def ensure_recordings_bucket() -> None:
    """Create the recordings bucket if absent and set a public-read policy. Idempotent."""
    if not (MINIO_ACCESS_KEY and MINIO_SECRET_KEY):
        logger.warning("MinIO credentials missing — skipping bucket bootstrap.")
        return
    try:
        client = _client()
        if not client.bucket_exists(MINIO_BUCKET):
            client.make_bucket(MINIO_BUCKET)
            logger.info("Created MinIO bucket %r", MINIO_BUCKET)
        else:
            logger.info("MinIO bucket %r already exists", MINIO_BUCKET)
        client.set_bucket_policy(MINIO_BUCKET, _public_read_policy(MINIO_BUCKET))
        logger.info("MinIO bucket %r set to public-read", MINIO_BUCKET)
    except Exception:
        logger.warning("MinIO bucket bootstrap failed — recordings may not upload/serve",
                       exc_info=True)


def _put_object(object_name: str, data: bytes, content_type: str) -> None:
    client = _client()
    client.put_object(
        MINIO_BUCKET, object_name, io.BytesIO(data),
        length=len(data), content_type=content_type,
    )


def _get_object_bytes(object_name: str) -> bytes | None:
    client = _client()
    resp = None
    try:
        resp = client.get_object(MINIO_BUCKET, object_name)
        return resp.read()
    except S3Error as e:
        if e.code in ("NoSuchKey", "NoSuchBucket"):
            return None
        raise
    finally:
        if resp is not None:
            resp.close()
            resp.release_conn()


async def ingest_vobiz_recording(vobiz_url: str, ccid: str) -> bool:
    """Download the Vobiz recording (auth headers) and store it as {ccid}.wav in MinIO.
    Returns True on success. Network/upload is kept off the event loop (httpx async +
    minio put in a worker thread)."""
    if not (MINIO_ACCESS_KEY and MINIO_SECRET_KEY):
        logger.warning("MinIO creds missing — cannot ingest recording for %s", ccid)
        return False
    if not (VOBIZ_AUTH_ID and VOBIZ_AUTH_TOKEN):
        logger.warning("Vobiz creds missing — cannot download recording for %s", ccid)
        return False
    headers = {"X-Auth-ID": VOBIZ_AUTH_ID, "X-Auth-Token": VOBIZ_AUTH_TOKEN}
    try:
        async with httpx.AsyncClient(timeout=120, follow_redirects=True) as client:
            r = await client.get(vobiz_url, headers=headers)
            r.raise_for_status()
            data = r.content
        if not data:
            logger.warning("Vobiz recording %s came back empty", vobiz_url)
            return False
        await asyncio.to_thread(_put_object, f"{ccid}.wav", data, "audio/wav")
        logger.info("Re-hosted recording %s -> %s.wav (%d bytes)", vobiz_url, ccid, len(data))
        return True
    except Exception:
        logger.warning("Vobiz recording ingest failed for %s", vobiz_url, exc_info=True)
        return False


async def get_recording_bytes(ccid: str) -> bytes | None:
    """Fetch a re-hosted recording from MinIO for the app's /recordings/{ccid} proxy."""
    return await asyncio.to_thread(_get_object_bytes, f"{ccid}.wav")