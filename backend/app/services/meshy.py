import asyncio
import base64
import logging
import httpx
import json
from pathlib import Path
from typing import Optional

from app.config import MESHY_API_KEY, MESHY_API_URL, OUTPUTS_DIR, JobStage
from app.workers.task_queue import jobs, update_job, update_job_stage, get_job
from app.services.mesh_renderer import render_views_from_glb

logger = logging.getLogger(__name__)

class MeshyService:
    def __init__(self):
        if not MESHY_API_KEY:
            raise RuntimeError("Meshy service cannot start: API key not configured. Please set MESHY_API_KEY environment variable.")
        self.api_key = MESHY_API_KEY
        self.base_url = MESHY_API_URL
        self.polling_task: Optional[asyncio.Task] = None
        self.is_running = False
        
    def start_polling(self):
        if self.is_running:
            return
        self.is_running = True
        self.polling_task = asyncio.create_task(self._poll_loop())
        logger.info("✓ Meshy AI polling service started")

    def stop_polling(self):
        self.is_running = False
        if self.polling_task:
            self.polling_task.cancel()
            
    async def _image_to_data_uri(self, image_path: str) -> str:
        try:
            with open(image_path, "rb") as img_file:
                encoded_string = base64.b64encode(img_file.read()).decode('utf-8')
                # Determine mime type based on extension
                ext = Path(image_path).suffix.lower()
                mime = "image/png" if ext == ".png" else "image/jpeg"
                return f"data:{mime};base64,{encoded_string}"
        except Exception as e:
            logger.error(f"Failed to encode image: {e}")
            raise

    async def submit_job(self, job_id: str):
        """Submit a job to Meshy AI."""
        job = get_job(job_id)
        if not job:
            raise ValueError(f"Job {job_id} not found")

        # Get settings from job
        settings = job.get("settings", {})
        ai_model = settings.get("ai_model", "meshy-6")
        should_texture = settings.get("should_texture", True)
        enable_pbr = settings.get("enable_pbr", False)

        # Resolve all image paths (multi-image or single)
        all_paths = job.get("all_image_paths", [])
        if not all_paths:
            # Fallback for old jobs: use processed or original image
            image_path = job.get("processed_image_path") or job.get("image_path")
            if not image_path or not Path(image_path).exists():
                image_path = job.get("image_path")
            if not image_path:
                raise ValueError("No image path found for job")
            all_paths = [image_path]

        is_multi = len(all_paths) > 1

        logger.info(f"Submitting job {job_id} to Meshy AI (model={ai_model}, images={len(all_paths)}, multi={is_multi})...")

        try:
            # Convert all images to data URIs
            image_data_uris = [await self._image_to_data_uri(p) for p in all_paths]

            headers = {
                "Authorization": f"Bearer {self.api_key}"
            }

            payload = {
                "ai_model": ai_model,
                "should_texture": should_texture,
                "symmetry_mode": settings.get("symmetry_mode", "auto"),
            }

            if should_texture:
                payload["enable_pbr"] = enable_pbr

            model_type = settings.get("model_type", "standard")
            if model_type == "lowpoly":
                payload["model_type"] = "lowpoly"

            if is_multi:
                payload["image_urls"] = image_data_uris
                endpoint = f"{self.base_url}/multi-image-to-3d"
            else:
                payload["image_url"] = image_data_uris[0]
                endpoint = f"{self.base_url}/image-to-3d"

            endpoint_type = "multi-image-to-3d" if is_multi else "image-to-3d"

            async with httpx.AsyncClient() as client:
                response = await client.post(
                    endpoint,
                    json=payload,
                    headers=headers,
                    timeout=30.0
                )

                if response.status_code != 202:
                    error_msg = f"Meshy API Error: {response.status_code} - {response.text}"
                    logger.error(error_msg)
                    update_job(job_id, status="failed", error=error_msg)
                    return

                data = response.json()
                meshy_task_id = data.get("result")

                update_job(
                    job_id,
                    status="processing",
                    stage=JobStage.GEOMETRY.value,
                    progress=10,
                    meshy_task_id=meshy_task_id,
                    meshy_endpoint_type=endpoint_type
                )
                logger.info(f"Job {job_id} submitted to Meshy ({endpoint_type}). Task ID: {meshy_task_id}")

        except Exception as e:
            logger.error(f"Failed to submit job to Meshy: {e}")
            update_job(job_id, status="failed", error=str(e))

    async def _poll_loop(self):
        """Background loop to check job status."""
        while self.is_running:
            try:
                # Find active jobs that have a Meshy Task ID
                active_meshy_jobs = []
                # Iterate over a copy of items to avoid modification issues
                current_jobs = list(jobs.values())
                
                for job in current_jobs:
                    if (job.get("status") == "processing" and 
                        job.get("meshy_task_id") and 
                        job.get("stage") != JobStage.COMPLETED.value):
                        active_meshy_jobs.append(job)

                if not active_meshy_jobs:
                    await asyncio.sleep(2) # Short sleep if empty
                    continue

                async with httpx.AsyncClient() as client:
                    for job in active_meshy_jobs:
                        await self._check_job_status(client, job)

                # Also check for active retexture jobs
                active_retexture_jobs = []
                for job in current_jobs:
                    if job.get("retexture_task_id"):
                        # Import to check status
                        from app.routers.jobs import _retexture_status
                        retex_status = _retexture_status.get(job["job_id"], {}).get("status")
                        if retex_status == "processing":
                            active_retexture_jobs.append(job)

                async with httpx.AsyncClient() as client:
                    for job in active_retexture_jobs:
                        await self._check_retexture_status(client, job)

                await asyncio.sleep(2) # Poll interval
                
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Error in polling loop: {e}")
                await asyncio.sleep(5)

    async def _check_job_status(self, client: httpx.AsyncClient, job: dict):
        job_id = job["job_id"]
        task_id = job["meshy_task_id"]
        
        try:
            headers = {"Authorization": f"Bearer {self.api_key}"}
            endpoint_type = job.get("meshy_endpoint_type", "image-to-3d")
            response = await client.get(
                f"{self.base_url}/{endpoint_type}/{task_id}",
                headers=headers
            )

            if response.status_code != 200:
                logger.warning(f"Failed to poll task {task_id}: {response.status_code}")
                return

            data = response.json()
            status = data.get("status")
            progress = data.get("progress", 0)

            # Map Meshy progress to our stages
            # Note: Meshy generates both geometry and texture together in one process
            # Our "geometry" stage encompasses the entire Meshy generation (geometry + texture)

            current_progress = job.get("progress", 0)

            if status == "PENDING":
                # Job accepted, queued
                update_job_stage(job_id, JobStage.GEOMETRY, 5)

            elif status == "IN_PROGRESS":
                # Map Meshy's 0-100 progress to our 10-95% range (geometry stage)
                # Ensure progress strictly increases
                new_progress = max(current_progress, 10 + int(progress * 0.85))
                update_job_stage(job_id, JobStage.GEOMETRY, new_progress)

            elif status == "SUCCEEDED":
                logger.info(f"Meshy task {task_id} succeeded. Downloading model...")
                model_urls = data.get("model_urls", {})
                glb_url = model_urls.get("glb")
                
                if glb_url:
                    await self._download_and_finalize(client, job_id, glb_url)
                else:
                    update_job(job_id, status="failed", error="No GLB URL in response")
                    
            elif status == "FAILED":
                error_msg = data.get("task_error", {}).get("message", "Unknown error")
                update_job(job_id, status="failed", error=f"Meshy Failed: {error_msg}")
                
        except Exception as e:
            logger.error(f"Error checking job {job_id}: {e}")

    async def _download_and_finalize(self, client: httpx.AsyncClient, job_id: str, url: str):
        try:
            update_job_stage(job_id, JobStage.POSTPROCESS, 95)
            
            # Download
            response = await client.get(url)
            if response.status_code != 200:
                raise Exception(f"Failed to download GLB: {response.status_code}")
            
            job_output_dir = OUTPUTS_DIR / job_id
            job_output_dir.mkdir(parents=True, exist_ok=True)
            output_path = job_output_dir / "model.glb"
            
            with open(output_path, "wb") as f:
                f.write(response.content)
                
            logger.info(f"Model saved to {output_path}")
            
            # Render thumbnails
            # Run in thread to avoid blocking loop
            loop = asyncio.get_running_loop()
            views = await loop.run_in_executor(None, render_views_from_glb, str(output_path), str(job_output_dir))
            
            # Finalize
            update_job(
                job_id,
                status="completed",
                stage=JobStage.COMPLETED.value,
                progress=100,
                model_path=str(output_path),
                multi_angle_paths=views
            )
            logger.info(f"Job {job_id} fully completed.")
            
        except Exception as e:
            logger.error(f"Finalization failed for {job_id}: {e}")
            update_job(job_id, status="failed", error=f"Download/Render failed: {str(e)}")

    async def submit_retexture_job(self, job_id: str, settings: dict):
        """Submit a retexture job to Meshy AI text-to-texture API."""
        job = get_job(job_id)
        if not job:
            raise ValueError(f"Job {job_id} not found")

        model_path = job.get("model_path")
        if not model_path:
            raise ValueError("No model path found for job")

        logger.info(f"Submitting retexture job {job_id} to Meshy AI...")

        try:
            # Read the GLB file and convert to base64
            with open(model_path, "rb") as f:
                model_data = base64.b64encode(f.read()).decode('utf-8')
                model_url = f"data:model/gltf-binary;base64,{model_data}"

            headers = {
                "Authorization": f"Bearer {self.api_key}"
            }

            payload = {
                "model_url": model_url,
                "enable_pbr": settings.get("enable_pbr", True),
                "resolution": settings.get("resolution", 2048),
            }

            # Add optional parameters if provided
            if settings.get("object_prompt"):
                payload["object_prompt"] = settings["object_prompt"]
            if settings.get("style_prompt"):
                payload["style_prompt"] = settings["style_prompt"]
            if settings.get("negative_prompt"):
                payload["negative_prompt"] = settings["negative_prompt"]
            if settings.get("art_style"):
                payload["art_style"] = settings["art_style"]
            if settings.get("ai_model"):
                payload["ai_model"] = settings["ai_model"]

            async with httpx.AsyncClient() as client:
                response = await client.post(
                    f"{self.base_url}/text-to-texture",
                    json=payload,
                    headers=headers,
                    timeout=30.0
                )

                if response.status_code != 202:
                    error_msg = f"Meshy API Error: {response.status_code} - {response.text}"
                    logger.error(error_msg)
                    update_job(job_id, retexture_error=error_msg)
                    return

                data = response.json()
                retexture_task_id = data.get("result")

                # Store retexture task ID in job
                update_job(job_id, retexture_task_id=retexture_task_id)
                logger.info(f"Retexture job {job_id} submitted. Task ID: {retexture_task_id}")

        except Exception as e:
            logger.error(f"Failed to submit retexture job: {e}")
            update_job(job_id, retexture_error=str(e))
            raise

    async def _check_retexture_status(self, client: httpx.AsyncClient, job: dict):
        """Check retexture job status."""
        job_id = job["job_id"]
        task_id = job.get("retexture_task_id")

        if not task_id:
            return

        try:
            headers = {"Authorization": f"Bearer {self.api_key}"}
            response = await client.get(
                f"{self.base_url}/text-to-texture/{task_id}",
                headers=headers
            )

            if response.status_code != 200:
                logger.warning(f"Failed to poll retexture task {task_id}: {response.status_code}")
                return

            data = response.json()
            status = data.get("status")
            progress = data.get("progress", 0)

            # Import retexture status tracking from jobs.py
            from app.routers.jobs import _retexture_status

            if status == "PENDING":
                _retexture_status[job_id] = {"status": "processing", "progress": 5, "error": None}

            elif status == "IN_PROGRESS":
                current_progress = max(10, 10 + int(progress * 0.8))
                _retexture_status[job_id] = {"status": "processing", "progress": current_progress, "error": None}

            elif status == "SUCCEEDED":
                logger.info(f"Retexture task {task_id} succeeded. Downloading model...")
                texture_urls = data.get("texture_urls", [])

                if texture_urls:
                    # Download the first textured model
                    await self._download_retextured_model(client, job_id, texture_urls[0].get("glb_url"))
                else:
                    error = "No texture URLs in response"
                    _retexture_status[job_id] = {"status": "failed", "progress": 0, "error": error}

            elif status == "FAILED":
                error_msg = data.get("task_error", {}).get("message", "Unknown error")
                _retexture_status[job_id] = {"status": "failed", "progress": 0, "error": f"Meshy Failed: {error_msg}"}

        except Exception as e:
            logger.error(f"Error checking retexture job {job_id}: {e}")

    async def _download_retextured_model(self, client: httpx.AsyncClient, job_id: str, url: str):
        """Download retextured model and replace the original."""
        try:
            from app.routers.jobs import _retexture_status

            _retexture_status[job_id] = {"status": "processing", "progress": 95, "error": None}

            # Download
            response = await client.get(url)
            if response.status_code != 200:
                raise Exception(f"Failed to download retextured GLB: {response.status_code}")

            job_output_dir = OUTPUTS_DIR / job_id
            output_path = job_output_dir / "model.glb"

            # Backup original model
            backup_path = job_output_dir / "model_original.glb"
            if output_path.exists() and not backup_path.exists():
                import shutil
                shutil.copy2(output_path, backup_path)

            # Save retextured model
            with open(output_path, "wb") as f:
                f.write(response.content)

            logger.info(f"Retextured model saved to {output_path}")

            # Update job
            update_job(job_id, model_path=str(output_path))

            # Mark retexture as completed
            _retexture_status[job_id] = {"status": "completed", "progress": 100, "error": None}
            logger.info(f"Retexture job {job_id} completed.")

        except Exception as e:
            logger.error(f"Retexture download failed for {job_id}: {e}")
            from app.routers.jobs import _retexture_status
            _retexture_status[job_id] = {"status": "failed", "progress": 0, "error": f"Download failed: {str(e)}"}

# Global instance
meshy_service = MeshyService()
