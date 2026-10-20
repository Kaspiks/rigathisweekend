# Solves a clip's camera path with COLMAP (pycolmap), run as its own low-priority process by src/tracking.js.
# Takes every `step`-th frame of the working copy (up to ~120), finds features, matches every frame with
# every other (so returning to a place joins up with where the camera was before), and reconstructs the
# cameras and a sparse cloud of scene points. Prints progress and the raw result as JSON lines; the
# conversion into a track happens in tracking.js, the same code that reads uploaded AR tracks.
import json, os, subprocess, sys

job = json.loads(sys.argv[1])
say = lambda **m: print(json.dumps(m), flush=True)
try:
    import pycolmap
except ImportError:
    say(error='pycolmap is not installed on this server, so camera tracks cannot be solved here')
    sys.exit(1)

images = os.path.join(job['dir'], 'images')
os.makedirs(images, exist_ok=True)
say(stage='frames')
# Frames numbered 0, 1, 2… in the order taken; frame i is clip frame i * step.
subprocess.run(['ffmpeg', '-v', 'error', '-nostdin', '-i', job['video'], '-vf', f"select=not(mod(n\\,{job['step']})),scale='if(gt(iw,ih),960,-2)':'if(gt(iw,ih),-2,960)'",
                '-fps_mode', 'passthrough', '-q:v', '3', '-start_number', '0', os.path.join(images, '%06d.jpg')], check=True)
database = os.path.join(job['dir'], 'db.db')
say(stage='features')
extraction = pycolmap.FeatureExtractionOptions()
extraction.max_image_size = 960
extraction.num_threads = job.get('threads', 2)
extraction.sift.max_num_features = 2048
pycolmap.extract_features(database, images, camera_mode=pycolmap.CameraMode.SINGLE, extraction_options=extraction, device=pycolmap.Device.cpu)
say(stage='matching')
pycolmap.match_exhaustive(database, device=pycolmap.Device.cpu)
say(stage='solving')
out = os.path.join(job['dir'], 'sparse')
os.makedirs(out, exist_ok=True)
maps = pycolmap.incremental_mapping(database, images, out)
if not maps:
    say(error='COLMAP could not reconstruct the camera from this clip')
    sys.exit(1)
rec = max(maps.values(), key=lambda r: r.num_reg_images())
count = len([f for f in os.listdir(images) if f.endswith('.jpg')])
frames, camera = [], None
for image_id in rec.reg_image_ids():
    image = rec.images[image_id]
    pose = image.cam_from_world() if callable(image.cam_from_world) else image.cam_from_world
    index = int(os.path.splitext(image.name)[0])
    frames.append({'frame': index * job['step'], 'quaternion': [float(v) for v in pose.rotation.quat], 'position': [float(v) for v in pose.translation]})
    camera = rec.cameras[image.camera_id]
params = [float(v) for v in camera.params]
f = params[0]
fx, fy = (params[0], params[1]) if camera.model.name in ('PINHOLE', 'OPENCV', 'FULL_OPENCV') else (f, f)
points = [[float(v) for v in p.xyz] for p in rec.points3D.values()]
if len(points) > 20000:
    points = points[:: max(1, len(points) // 20000)][:20000]
say(result={'images': count, 'registered': rec.num_reg_images(), 'error': round(float(rec.compute_mean_reprojection_error()), 4),
            'intrinsics': {'fx': fx, 'fy': fy, 'width': camera.width, 'height': camera.height}, 'frames': frames, 'points': points})
