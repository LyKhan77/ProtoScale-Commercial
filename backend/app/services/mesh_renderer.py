import logging
import trimesh
import numpy as np
from pathlib import Path
import matplotlib
# Use Agg backend for headless rendering
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from mpl_toolkits.mplot3d.art3d import Poly3DCollection
from PIL import Image

logger = logging.getLogger(__name__)

def render_views_from_glb(glb_path: str, output_dir: str) -> list[str]:
    """
    Load a GLB file and render 4 views using matplotlib.
    """
    try:
        # Load mesh
        loaded = trimesh.load(glb_path)
        if hasattr(loaded, "geometry"):
            # If it's a Scene, concatenate all meshes or take the first one
            # Concatenating is safer for multi-part meshes
            if len(loaded.geometry) > 0:
                mesh = trimesh.util.concatenate(list(loaded.geometry.values()))
            else:
                mesh = list(loaded.geometry.values())[0] if loaded.geometry else loaded
        else:
            mesh = loaded
            
        return render_views_from_mesh(mesh, output_dir)
    except Exception as e:
        logger.error(f"Failed to load GLB for rendering: {e}")
        return []

def render_views_from_mesh(mesh, output_dir: str) -> list[str]:
    """Render 4 views from a trimesh mesh using matplotlib (headless)."""
    
    views = []
    # Camera angles: (elevation, azimuth)
    camera_angles = [(20, -60), (20, 30), (20, 120), (20, 210)]
    
    try:
        if not hasattr(mesh, 'vertices') or not hasattr(mesh, 'faces'):
            logger.warning("Invalid mesh object for rendering")
            return []

        vertices = mesh.vertices
        faces = mesh.faces
        
        # Center and normalize vertices to fit in unit cube
        if vertices.shape[0] > 0:
            center = (vertices.max(axis=0) + vertices.min(axis=0)) / 2
            scale = (vertices.max(axis=0) - vertices.min(axis=0)).max()
            if scale == 0: scale = 1.0
            verts_norm = (vertices - center) / scale
        else:
            verts_norm = vertices

        for i, (elev, azim) in enumerate(camera_angles):
            path = str(Path(output_dir) / f"view_{i}.png")
            try:
                fig = plt.figure(figsize=(5, 5), dpi=102)
                ax = fig.add_subplot(111, projection='3d')

                if faces.shape[0] > 0:
                    polygons = verts_norm[faces]
                    collection = Poly3DCollection(
                        polygons, alpha=0.95,
                        facecolors='#8CBEB2', edgecolors='#5A7D7C', linewidths=0.1
                    )
                    ax.add_collection3d(collection)

                ax.set_xlim(-0.6, 0.6)
                ax.set_ylim(-0.6, 0.6)
                ax.set_zlim(-0.6, 0.6)

                ax.view_init(elev=elev, azim=azim)
                ax.set_axis_off()
                ax.set_facecolor('#F3F4F6')
                fig.patch.set_facecolor('#F3F4F6')

                fig.savefig(path, bbox_inches='tight', pad_inches=0.05, dpi=102)
                plt.close(fig)
                views.append(path)
                
            except Exception as e:
                logger.warning(f"View {i} render failed: {e}")
                plt.close('all')
                # Create placeholder
                img = Image.new("RGB", (512, 512), (200, 200, 200))
                img.save(path)
                views.append(path)

        return views
        
    except Exception as e:
        logger.error(f"Render views failed: {e}")
        return []
